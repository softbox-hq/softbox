import "../src/loadEnv";
import { loadWorkerConfig } from "../src/config";
import { ConvexRuntimeClient } from "../src/convex";
import { isTemplateId } from "../src/templates";

function parseArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const appId = parseArg("--app-id") ?? config.appId;
  const templateId = parseArg("--template-id");

  if (!templateId) {
    throw new Error("Missing required --template-id");
  }
  if (!isTemplateId(templateId, config.projectRoot)) {
    throw new Error(`Unknown template id '${templateId}'`);
  }

  const convex = new ConvexRuntimeClient(config);
  await convex.setAppTemplate({ appId, templateId });
  console.log(`[template] set app '${appId}' to template '${templateId}'`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
