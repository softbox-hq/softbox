import "../src/loadEnv";
import { loadWorkerConfig } from "../src/config";
import { ConvexRuntimeClient, type LegacyAppIdMigrationPlanRecord } from "../src/convex";

function formatCounts(plan: LegacyAppIdMigrationPlanRecord["migrations"][number]["counts"]): string {
  return [
    `${plan.boxes} box row(s)`,
    `${plan.versions} version(s)`,
    `${plan.appFiles} file row(s)`,
    `${plan.jobs} job(s)`,
    `${plan.pipelineRuns} pipeline run(s)`,
    `${plan.pipelineStages} pipeline stage(s)`,
    `${plan.runtimeErrors} runtime error(s)`,
    `${plan.artifactPurgeTasks} purge task(s)`,
    `${plan.shellSelections} shell selection(s)`,
  ].join(", ");
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const config = loadWorkerConfig();
  const convex = new ConvexRuntimeClient(config);
  const result = apply
    ? await convex.migrateLegacyAppIds(false)
    : await convex.inspectLegacyAppIdMigration();

  if (
    result.migrations.length === 0 &&
    result.conflicts.length === 0 &&
    result.cleanup.appDocs === 0 &&
    result.cleanup.pipelineRuns === 0
  ) {
    console.log("[migrate-app-ids] no legacy templateId-backed app ids found");
    return;
  }

  for (const migration of result.migrations) {
    console.log(
      `[migrate-app-ids] ${migration.fromAppId} -> ${migration.toAppId} (${migration.name}); ${formatCounts(migration.counts)}`,
    );
  }

  for (const conflict of result.conflicts) {
    console.error(
      `[migrate-app-ids] conflict: ${conflict.fromAppId} -> ${conflict.toAppId}; ${conflict.reason}`,
    );
  }

  if (result.cleanup.appDocs > 0 || result.cleanup.pipelineRuns > 0) {
    console.log(
      `[migrate-app-ids] cleanup: ${result.cleanup.appDocs} app doc(s), ${result.cleanup.pipelineRuns} pipeline run(s) still carry a legacy templateId field`,
    );
  }

  if (!apply) {
    console.log("[migrate-app-ids] dry run only. Re-run with --apply to persist the changes.");
    if (result.conflicts.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(`[migrate-app-ids] migrated ${result.migratedCount ?? 0} app record(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
