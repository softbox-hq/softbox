import { stdout as output } from "node:process";
import "./loadEnv";
import { basename } from "node:path";
import { manifestKeyForVersion } from "./artifacts";
import { ensureAppTooling } from "./appAgents";
import { loadWorkerConfig } from "./config";
import { LiveAppBundler } from "./build";
import { ConvexRuntimeClient } from "./convex";
import { readLiveAppFiles } from "./filesystem";
import { R2Uploader } from "./r2";
import {
  discoverWrappedApps,
  getWrappedAppLabel,
  resolveWrappedAppRoot,
} from "./templates";
import {
  chooseSeedTargetsWithInk,
  confirmResetWithInk,
  SeedPromptCancelledError,
} from "./seedInk";

function parseArgs(argv: string[]) {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const appIndex = argv.indexOf("--app");
  const appId = (appIndex >= 0 ? argv[appIndex + 1] : positional[0])?.trim() || null;
  const seedAll = argv.includes("--all");

  if (positional.length > 1) {
    throw new Error("Expected at most one app id. Use 'pnpm seed -- --app <app-id>'.");
  }
  if (seedAll && appId) {
    throw new Error("Choose either '--all' or '--app <app-id>', not both.");
  }

  return {
    force: argv.includes("--force"),
    help: argv.includes("--help") || argv.includes("-h"),
    appId,
    all: seedAll,
  };
}

function printHelp(): void {
  output.write(
    [
      "Usage:",
      "  pnpm seed",
      "  pnpm seed -- --app <app-id>",
      "  pnpm seed -- --all",
      "  APP_ID=<app-id> pnpm seed",
      "",
      "Behavior:",
      "  - interactive terminal: uses an Ink TUI picker for wrapped apps, including 'Seed all wrapped apps'",
      "  - non-interactive terminal: requires --app or APP_ID",
    ].join("\n") + "\n",
  );
}

async function resolveSeedTargets(args: {
  projectRoot: string;
  explicitAppId: string | null;
  envAppId: string | null;
  seedAll: boolean;
}): Promise<string[]> {
  const discovery = discoverWrappedApps(args.projectRoot);
  if (discovery.apps.length === 0) {
    throw new Error("No wrapped apps found under /apps.");
  }

  const findApp = (appId: string) => discovery.apps.find((app) => app.appId === appId) ?? null;
  const allAppIds = discovery.apps.map((app) => app.appId);

  if (args.seedAll) {
    return allAppIds;
  }

  if (args.explicitAppId) {
    if (!findApp(args.explicitAppId)) {
      throw new Error(
        `Unknown app id '${args.explicitAppId}'. Re-run with 'pnpm seed' to choose from wrapped apps.`,
      );
    }
    return [args.explicitAppId];
  }

  if (process.stdin.isTTY && output.isTTY) {
    return await chooseSeedTargetsWithInk(discovery.apps);
  }

  const envAppId = args.envAppId?.trim() || "";
  if (envAppId) {
    if (!findApp(envAppId)) {
      throw new Error(
        `APP_ID='${envAppId}' does not match any wrapped app. Re-run with 'pnpm seed -- --app <app-id>'.`,
      );
    }
    return [envAppId];
  }

  throw new Error(
    "No app selected. Re-run with 'pnpm seed -- --app <app-id>', 'pnpm seed -- --all', or set APP_ID for non-interactive use.",
  );
}

async function confirmReset(appId: string, details: string[]): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Found stale data for app '${appId}', but no interactive terminal is available. Re-run with --force to clear it automatically.`,
    );
  }
  return await confirmResetWithInk({ appId, details });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const baseConfig = loadWorkerConfig();
  const appIds = await resolveSeedTargets({
    projectRoot: baseConfig.projectRoot,
    explicitAppId: args.appId,
    envAppId: process.env.APP_ID?.trim() || null,
    seedAll: args.all,
  });
  const convex = new ConvexRuntimeClient(baseConfig);
  const bundler = new LiveAppBundler(baseConfig);
  const uploader = new R2Uploader(baseConfig);

  try {
    for (const appId of appIds) {
      const config = {
        ...baseConfig,
        appId,
      };
      const seedState = await convex.inspectSeedAppState(config.appId);
      const staleDetails = [
        seedState.purgeQueued ? "queued artifact purge task" : null,
        seedState.counts.jobs > 0 ? `${seedState.counts.jobs} old job(s)` : null,
        seedState.counts.activeJobs > 0 ? `${seedState.counts.activeJobs} pending/running job(s)` : null,
        seedState.counts.pipelineRuns > 0 ? `${seedState.counts.pipelineRuns} pipeline run(s)` : null,
        seedState.counts.pipelineStages > 0 ? `${seedState.counts.pipelineStages} pipeline stage row(s)` : null,
        seedState.counts.versions > 0 ? `${seedState.counts.versions} old version row(s)` : null,
        seedState.counts.appFiles > 0 ? `${seedState.counts.appFiles} old app file row(s)` : null,
        seedState.counts.runtimeErrors > 0 ? `${seedState.counts.runtimeErrors} runtime error row(s)` : null,
      ].filter((detail): detail is string => Boolean(detail));

      if (!seedState.existingApp && staleDetails.length > 0) {
        const shouldReset =
          args.force || (await confirmReset(config.appId, staleDetails));
        if (!shouldReset) {
          console.log(`[seed] cancelled for '${config.appId}'`);
          return;
        }

        const deletedArtifacts = await uploader.deleteAppArtifacts(config.appId);
        await convex.resetSeedAppState(config.appId);
        console.log(
          `[seed] cleared stale state for '${config.appId}' and deleted ${deletedArtifacts.deleted} artifact(s)`,
        );
      }

      const liveAppRoot = resolveWrappedAppRoot(config.projectRoot, config.appId);
      await ensureAppTooling({
        projectRoot: config.projectRoot,
        appRoot: liveAppRoot,
        appName: basename(liveAppRoot),
      });
      const files = await readLiveAppFiles(liveAppRoot);

      const buildResult = await bundler.buildVersion(config.appId, 1, liveAppRoot);
      await uploader.uploadArtifacts(buildResult.artifacts);

      await convex.seedApp({
        appId: config.appId,
        name: getWrappedAppLabel(config.appId, config.projectRoot),
        files,
        manifestUrl: `${config.publicDevelopmentUrl}/${manifestKeyForVersion(config.appId, 1)}`,
        buildLog: "Seeded from source app",
        stateJson: buildResult.stateJson,
      });

      console.log(
        `Seeded app '${config.appId}' from source '${getWrappedAppLabel(config.appId, config.projectRoot)}'`,
      );
    }
  } finally {
    await bundler.dispose();
  }
}

main().catch((error) => {
  if (error instanceof SeedPromptCancelledError) {
    console.log("[seed] cancelled");
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
});
