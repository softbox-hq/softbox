import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import type { BuildContext, BuildResult } from "esbuild";
import { parse as parseDotenv } from "dotenv";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import type { WorkerConfig } from "./config";
import { manifestKeyForVersion, sharedArtifactKey } from "./artifacts";
import { liveManifestSchema, type LiveManifest } from "./shared/manifest";
import { liveAppStateSchema, liveAppStateSchemaVersion } from "./shared/liveApp";

export type ArtifactFile = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type BuildVersionResult = {
  manifest: LiveManifest;
  artifacts: ArtifactFile[];
  buildLog: string;
  stateJson: string;
};

function contentTypeFor(fileName: string): string {
  const normalizedName = fileName.toLowerCase();
  if (normalizedName.endsWith(".json")) return "application/json";
  if (normalizedName.endsWith(".js")) return "application/javascript";
  if (normalizedName.endsWith(".css")) return "text/css";
  if (normalizedName.endsWith(".map")) return "application/json";
  if (normalizedName.endsWith(".svg")) return "image/svg+xml";
  if (normalizedName.endsWith(".png")) return "image/png";
  if (normalizedName.endsWith(".jpg") || normalizedName.endsWith(".jpeg")) return "image/jpeg";
  if (normalizedName.endsWith(".gif")) return "image/gif";
  if (normalizedName.endsWith(".webp")) return "image/webp";
  if (normalizedName.endsWith(".wasm")) return "application/wasm";
  if (normalizedName.endsWith(".sqlite")) return "application/x-sqlite3";
  if (normalizedName.endsWith(".wad")) return "application/octet-stream";
  return "application/octet-stream";
}

async function processTemplateCss(path: string): Promise<string> {
  const source = await readFile(path, "utf8");
  const result = await postcss([tailwindcss()]).process(source, {
    from: path,
  });
  return result.css;
}

async function readAppEnv(liveAppRoot: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  for (const fileName of [".env", ".env.local"]) {
    try {
      const source = await readFile(join(liveAppRoot, fileName), "utf8");
      Object.assign(env, parseDotenv(source));
    } catch {
      // optional
    }
  }

  return env;
}

function buildImportMetaEnvDefines(env: Record<string, string>): Record<string, string> {
  const clientEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => key.startsWith("VITE_")),
  );

  const defines: Record<string, string> = {
    "import.meta.env": JSON.stringify(clientEnv),
    __LIVE_APP_ENV__: JSON.stringify(clientEnv),
  };

  for (const [key, value] of Object.entries(clientEnv)) {
    defines[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return defines;
}

export class LiveAppBundler {
  private context: BuildContext | null = null;
  private contextRoot: string | null = null;
  private contextAppId: string | null = null;

  constructor(private readonly config: WorkerConfig) {}

  async prepareWorkspace(liveAppRoot: string): Promise<void> {
    await mkdir(join(liveAppRoot, "src"), { recursive: true });
  }

  private async ensureContext(liveAppRoot: string, appId: string): Promise<BuildContext> {
    if (this.context && this.contextRoot === liveAppRoot && this.contextAppId === appId) {
      return this.context;
    }

    if (this.context) {
      await this.context.dispose();
      this.context = null;
      this.contextRoot = null;
      this.contextAppId = null;
    }

    await this.prepareWorkspace(liveAppRoot);
    const env = await readAppEnv(liveAppRoot);
    const define = buildImportMetaEnvDefines(env);
    const sharedAssetBaseUrl = `${this.config.publicDevelopmentUrl}/apps/${appId}/shared`;
    this.context = await esbuild.context({
      absWorkingDir: liveAppRoot,
      entryPoints: ["src/entry.tsx"],
      bundle: true,
      splitting: true,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
      target: ["es2022"],
      sourcemap: false,
      minify: true,
      write: false,
      outdir: "out",
      entryNames: "[name]-[hash]",
      chunkNames: "chunk-[hash]",
      assetNames: "asset-[hash]",
      publicPath: sharedAssetBaseUrl,
      define,
      loader: {
        ".ts": "ts",
        ".tsx": "tsx",
        ".css": "css",
        ".svg": "file",
        ".png": "file",
        ".jpg": "file",
        ".jpeg": "file",
        ".gif": "file",
        ".webp": "file",
        ".wasm": "file",
        ".wad": "file",
        ".WAD": "file",
        ".sqlite": "file",
      },
      plugins: [
        {
          name: "live-app-tailwind",
          setup(build) {
            build.onLoad({ filter: /\.css$/ }, async (args) => ({
              contents: await processTemplateCss(args.path),
              loader: "css",
            }));
          },
        },
      ],
    });
    this.contextRoot = liveAppRoot;
    this.contextAppId = appId;
    return this.context;
  }

  private async evaluateState(liveAppRoot: string): Promise<string> {
    const env = await readAppEnv(liveAppRoot);
    const define = buildImportMetaEnvDefines(env);
    const result = await esbuild.build({
      absWorkingDir: liveAppRoot,
      entryPoints: ["src/defaultState.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      target: ["node24"],
      write: false,
      outfile: "state.mjs",
      define,
    });

    const output = result.outputFiles?.[0];
    if (!output) {
      throw new Error("Failed to evaluate live app state");
    }

    const runtimeTempRoot = join(this.config.projectRoot, ".tmp");
    await mkdir(runtimeTempRoot, { recursive: true });
    const tempDir = await mkdtemp(join(runtimeTempRoot, "live-runtime-state-"));
    const filePath = join(tempDir, "state.mjs");
    await writeFile(filePath, output.text, "utf8");
    try {
      const module = await import(`${pathToFileURL(filePath).href}?t=${Date.now()}`);
      const state = liveAppStateSchema.parse(module.initialLiveAppState);
      return JSON.stringify(state);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async buildVersion(appId: string, versionNumber: number, liveAppRoot: string): Promise<BuildVersionResult> {
    const context = await this.ensureContext(liveAppRoot, appId);
    const result = await context.rebuild();
    if (result.errors.length > 0) {
      throw new Error(await formatBuildLog(result));
    }

    const outputFiles = result.outputFiles ?? [];
    const artifacts: ArtifactFile[] = [];
    let entryUrl = "";
    const cssUrls: string[] = [];

    for (const file of outputFiles) {
      const relativeName = relative(join(liveAppRoot, "out"), file.path).replaceAll("\\", "/");
      const fileName = basename(relativeName);
      const key = sharedArtifactKey(appId, fileName);
      if (fileName.startsWith("entry-") && fileName.endsWith(".js")) {
        entryUrl = `${this.config.publicDevelopmentUrl}/${key}`;
      }
      if (fileName.endsWith(".css")) {
        cssUrls.push(`${this.config.publicDevelopmentUrl}/${key}`);
      }
      artifacts.push({
        key,
        body: file.contents,
        contentType: contentTypeFor(relativeName),
      });
    }

    try {
      const bundledWad = await readFile(join(liveAppRoot, "DOOM.WAD"));
      artifacts.push({
        key: sharedArtifactKey(appId, "DOOM.WAD"),
        body: bundledWad,
        contentType: contentTypeFor("DOOM.WAD"),
      });
    } catch {
      // Optional local IWAD for Doom-style apps.
    }

    if (!entryUrl) {
      throw new Error("Bundle output did not include entry.js");
    }

    const stateJson = await this.evaluateState(liveAppRoot);
    const manifest = liveManifestSchema.parse({
      version: versionNumber,
      entryUrl,
      cssUrls: cssUrls.sort(),
      chunkBaseUrl: `${this.config.publicDevelopmentUrl}/apps/${appId}/shared/`,
      createdAt: Date.now(),
      appId,
      stateSchemaVersion: liveAppStateSchemaVersion,
      stateJson,
    });

    artifacts.push({
      key: manifestKeyForVersion(appId, versionNumber),
      body: Buffer.from(JSON.stringify(manifest, null, 2)),
      contentType: "application/json",
    });

    return {
      manifest,
      artifacts,
      buildLog: await formatBuildLog(result),
      stateJson,
    };
  }

  async dispose(): Promise<void> {
    await this.context?.dispose();
    this.context = null;
    this.contextRoot = null;
    this.contextAppId = null;
  }
}

async function formatBuildLog(result: BuildResult): Promise<string> {
  const errors = await esbuild.formatMessages(result.errors, {
    kind: "error",
    color: false,
  });
  const warnings = await esbuild.formatMessages(result.warnings, {
    kind: "warning",
    color: false,
  });
  return [...errors, ...warnings].filter(Boolean).join("\n");
}
