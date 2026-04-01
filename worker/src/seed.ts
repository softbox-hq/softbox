import { select } from "@inquirer/prompts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
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

function parseArgs(argv: string[]) {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const appIndex = argv.indexOf("--app");
  const appId = (appIndex >= 0 ? argv[appIndex + 1] : positional[0])?.trim() || null;

  if (positional.length > 1) {
    throw new Error("Expected at most one app id. Use 'pnpm seed -- --app <app-id>'.");
  }

  return {
    force: argv.includes("--force"),
    help: argv.includes("--help") || argv.includes("-h"),
    appId,
  };
}

function printHelp(): void {
  output.write(
    [
      "Usage:",
      "  pnpm seed",
      "  pnpm seed -- --app <app-id>",
      "  APP_ID=<app-id> pnpm seed",
      "",
      "Behavior:",
      "  - interactive terminal: shows an arrow-key picker for wrapped apps",
      "  - non-interactive terminal: requires --app or APP_ID",
    ].join("\n") + "\n",
  );
}

async function resolveSeedAppId(args: {
  projectRoot: string;
  explicitAppId: string | null;
  envAppId: string | null;
}): Promise<string> {
  const discovery = discoverWrappedApps(args.projectRoot);
  if (discovery.apps.length === 0) {
    throw new Error("No wrapped apps found under /apps.");
  }

  const findApp = (appId: string) => discovery.apps.find((app) => app.appId === appId) ?? null;

  if (args.explicitAppId) {
    if (!findApp(args.explicitAppId)) {
      throw new Error(
        `Unknown app id '${args.explicitAppId}'. Re-run with 'pnpm seed' to choose from wrapped apps.`,
      );
    }
    return args.explicitAppId;
  }

  if (input.isTTY && output.isTTY) {
    const appId = await select({
      message: "Select a wrapped app to seed",
      choices: discovery.apps.map((app) => ({
        value: app.appId,
        name: `${app.label} (${app.appId})`,
        description: app.relativeRoot,
      })),
    });
    output.write(`[seed] selected '${appId}'\n`);
    return appId;
  }

  const envAppId = args.envAppId?.trim() || "";
  if (envAppId) {
    if (!findApp(envAppId)) {
      throw new Error(
        `APP_ID='${envAppId}' does not match any wrapped app. Re-run with 'pnpm seed -- --app <app-id>'.`,
      );
    }
    return envAppId;
  }

  throw new Error(
    "No app selected. Re-run with 'pnpm seed -- --app <app-id>' or set APP_ID for non-interactive use.",
  );
}

async function confirmReset(appId: string, details: string[]): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Found stale data for app '${appId}', but no interactive terminal is available. Re-run with --force to clear it automatically.`,
    );
  }

  const rl = createInterface({ input, output });
  try {
    output.write(`[seed] found stale state for '${appId}':\n`);
    for (const detail of details) {
      output.write(`[seed] - ${detail}\n`);
    }
    const answer = await rl.question(
      `[seed] clear the old data and reseed '${appId}'? This removes old jobs, versions, pipeline history, and queued purge state. [y/N] `,
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const baseConfig = loadWorkerConfig();
  const appId = await resolveSeedAppId({
    projectRoot: baseConfig.projectRoot,
    explicitAppId: args.appId,
    envAppId: process.env.APP_ID?.trim() || null,
  });
  const config = {
    ...baseConfig,
    appId,
  };
  const convex = new ConvexRuntimeClient(config);
  const bundler = new LiveAppBundler(config);
  const uploader = new R2Uploader(config);
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
      await bundler.dispose();
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

  await bundler.dispose();
  console.log(
    `Seeded app '${config.appId}' from source '${getWrappedAppLabel(config.appId, config.projectRoot)}'`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
