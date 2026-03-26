import "./loadEnv";
import { manifestKeyForVersion } from "./artifacts";
import { loadWorkerConfig } from "./config";
import { LiveAppBundler } from "./build";
import { ConvexRuntimeClient } from "./convex";
import { readLiveAppFiles } from "./filesystem";
import { R2Uploader } from "./r2";
import { getTemplateLabel, resolveTemplateRoot } from "./templates";

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const convex = new ConvexRuntimeClient(config);
  const bundler = new LiveAppBundler(config);
  const uploader = new R2Uploader(config);
  const liveAppRoot = resolveTemplateRoot(config.projectRoot, config.seedTemplateId);
  const files = await readLiveAppFiles(liveAppRoot);

  const buildResult = await bundler.buildVersion(config.appId, 1, liveAppRoot);
  await uploader.uploadArtifacts(buildResult.artifacts);

  await convex.seedApp({
    appId: config.appId,
    name: "Softbox",
    templateId: config.seedTemplateId,
    files,
    manifestUrl: `${config.r2PublicBaseUrl}/${manifestKeyForVersion(config.appId, 1)}`,
    buildLog: "Seeded from template",
    stateJson: buildResult.stateJson,
  });

  await bundler.dispose();
  console.log(
    `Seeded app '${config.appId}' from template '${getTemplateLabel(config.seedTemplateId)}'`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
