import type { LiveAppState } from "./shared/liveApp";
import type { WorkerConfig } from "./config";
import {
  countSourceBytes,
  rewriteLiveAppFiles,
  selectLikelyTargetFiles,
} from "./agent";
import { manifestKeyForVersion } from "./artifacts";
import { LiveAppBundler } from "./build";
import { ConvexRuntimeClient } from "./convex";
import { readLiveAppFiles } from "./filesystem";
import { liveAppStateSchema } from "./shared/liveApp";
import { R2Uploader } from "./r2";
import {
  getTemplateLabel,
  inspectTemplateSource,
  resolveTemplateRoot,
} from "./templates";

function parseState(stateJson: string | null): LiveAppState | null {
  if (!stateJson) return null;
  try {
    return liveAppStateSchema.parse(JSON.parse(stateJson));
  } catch {
    return null;
  }
}

function currentVersionNumber(shellState: any): number {
  return (
    shellState?.latestVersionNumber ??
    shellState?.activeVersion?.versionNumber ??
    0
  );
}

function summarizePrompt(prompt: string): string {
  const singleLine = prompt.replace(/\s+/g, " ").trim();
  return singleLine.length > 80 ? `${singleLine.slice(0, 77)}...` : singleLine;
}

function logJob(jobId: string, message: string): void {
  console.log(`[worker][job ${jobId}] ${message}`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isStaleRunningJob(
  shellState: any,
  staleAfterMs: number,
): boolean {
  const latestJob = shellState?.latestJob;
  if (!latestJob || latestJob.status !== "running") {
    return false;
  }

  if (typeof latestJob.claimedAt !== "number") {
    return false;
  }

  return Date.now() - latestJob.claimedAt > staleAfterMs;
}

export async function reclaimStaleRunningJobs(
  config: WorkerConfig,
  convex: ConvexRuntimeClient,
): Promise<void> {
  const staleJobs = await convex.listStaleRunningJobs(Date.now() - config.staleJobTimeoutMs);
  for (const staleJob of staleJobs) {
    logJob(
      staleJob._id,
      `marking stale job for app '${staleJob.appId}' as failed after ${config.staleJobTimeoutMs}ms`,
    );
    await convex.recordBuildFailure({
      appId: staleJob.appId,
      jobId: staleJob._id,
      buildLog:
        `Job did not finish before stale threshold (${config.staleJobTimeoutMs}ms) and was reclaimed by worker.`,
    });
  }
}

export async function pollPendingJob(
  convex: ConvexRuntimeClient,
): Promise<string | null> {
  const pendingJob = await convex.getNextPendingJob();
  return pendingJob?._id ?? null;
}

export async function syncAppTemplateSourceStatuses(
  config: WorkerConfig,
  convex: ConvexRuntimeClient,
): Promise<void> {
  const apps = await convex.listApps();
  for (const app of apps) {
    const nextStatus = await inspectTemplateSource(config.projectRoot, app.templateId);
    if (
      (app.templateSourceStatus ?? "unknown") === nextStatus.status &&
      (app.templateSourcePath ?? null) === nextStatus.path &&
      (app.templateSourceMessage ?? null) === nextStatus.message
    ) {
      continue;
    }

    await convex.setAppTemplateSourceStatus({
      appId: app.appId,
      status: nextStatus.status,
      path: nextStatus.path,
      message: nextStatus.message,
    });
  }
}

export async function processPendingArtifactPurgeTask(
  convex: ConvexRuntimeClient,
  uploader: R2Uploader,
): Promise<boolean> {
  const task = await convex.getNextArtifactPurgeTask();
  if (!task) {
    return false;
  }

  try {
    const hasActiveJobs = await convex.hasActiveJobsForApp(task.appId);
    if (hasActiveJobs) {
      return false;
    }

    const summary = await uploader.deleteAppArtifacts(task.appId);
    await convex.finalizeDeletedAppData(task.appId);
    console.log(
      `[worker][purge ${task._id}] deleted ${summary.deleted} artifact(s) for app '${task.appId}'`,
    );
    await convex.completeArtifactPurgeTask(task._id);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[worker][purge ${task._id}] failed for app '${task.appId}'`, message);
    await convex.recordArtifactPurgeFailure({
      taskId: task._id,
      error: message,
    });
  }

  return true;
}

export async function processJobById(
  config: WorkerConfig,
  convex: ConvexRuntimeClient,
  bundler: LiveAppBundler,
  uploader: R2Uploader,
  jobId: string,
): Promise<boolean> {
  const runningJob = await convex.markJobRunning(jobId);
  if (!runningJob) {
    return false;
  }

  const appId = runningJob.appId;
  const startedAt = Date.now();
  const assertAppStillExists = async () => {
    const appConfig = await convex.getAppConfig(appId);
    if (!appConfig) {
      throw new Error(`App '${appId}' was deleted during processing.`);
    }
    return appConfig;
  };

  let agentResult:
    | {
        summary: string;
        changed_files: string[];
        notes?: string;
      }
    | undefined;

  try {
    const shellState = await convex.getShellState(appId);
    const appConfig = await assertAppStillExists();
    const templateSource = await inspectTemplateSource(config.projectRoot, appConfig.templateId);
    await convex.setAppTemplateSourceStatus({
      appId,
      status: templateSource.status,
      path: templateSource.path,
      message: templateSource.message,
    });
    if (templateSource.status === "missing") {
      throw new Error(
        templateSource.message ??
          `App '${appId}' is still mountable from a previously built version, but its source template is missing locally.`,
      );
    }
    const liveAppRoot = resolveTemplateRoot(config.projectRoot, appConfig.templateId);
    const liveAppLabel = getTemplateLabel(appConfig.templateId);
    const currentFiles = await readLiveAppFiles(liveAppRoot);
    const sourceBytes = countSourceBytes(currentFiles);
    const primaryTargetFiles = selectLikelyTargetFiles(
      runningJob.prompt,
      currentFiles,
      liveAppLabel,
    );

    logJob(
      runningJob._id,
      `claimed app '${appId}' prompt "${summarizePrompt(runningJob.prompt)}"`,
    );
    logJob(
      runningJob._id,
      `loaded ${currentFiles.length} source file(s) from ${liveAppRoot}`,
    );
    logJob(
      runningJob._id,
      `source snapshot: prompt=${runningJob.prompt.trim().length} chars, editable_files=${currentFiles.length}, source_bytes=${sourceBytes} (workspace files loaded locally for diffing/targeting; not inlined into the agent prompt)`,
    );
    logJob(
      runningJob._id,
      `agent targets: ${primaryTargetFiles.join(", ") || "none inferred"}`,
    );

    if (runningJob.pipelineRunId) {
      await convex.recordPipelineStage({
        runId: runningJob.pipelineRunId,
        appId,
        key: "agent",
        status: "running",
      });
    }
    logJob(
      runningJob._id,
      `calling agent command '${config.agentCommand}' from ${config.projectRoot} with ${config.agentTimeoutMs}ms timeout`,
    );
    const rewrite = await rewriteLiveAppFiles(
      {
        command: config.agentCommand,
        model: config.agentModel,
        timeoutMs: config.agentTimeoutMs,
        projectRoot: config.projectRoot,
        liveAppRoot,
        liveAppLabel,
      },
      {
        prompt: runningJob.prompt,
        files: currentFiles,
        liveAppLabel,
        latestBuildError: shellState?.lastBuildError ?? null,
        latestRuntimeError: shellState?.lastRuntimeError ?? null,
        currentState: parseState(shellState?.currentStateJson ?? null),
        primaryTargetFiles,
      },
    );
    logJob(
      runningJob._id,
      `Codex returned ${rewrite.files.length} file write(s) and ${rewrite.deletedPaths.length} file deletion(s)`,
    );
    logJob(
      runningJob._id,
      `Claude summary ${JSON.stringify(rewrite.details)}`,
    );
    agentResult = rewrite.details;
    if (runningJob.pipelineRunId) {
      await convex.recordPipelineStage({
        runId: runningJob.pipelineRunId,
        appId,
        key: "agent",
        status: "completed",
      });
      await convex.recordPipelineStage({
        runId: runningJob.pipelineRunId,
        appId,
        key: "build",
        status: "running",
      });
    }

    const nextFiles = rewrite.allFiles;
    logJob(
      runningJob._id,
      `Codex changed ${rewrite.files.length + rewrite.deletedPaths.length} file(s) in ${liveAppLabel}/src`,
    );

    await assertAppStillExists();
    const nextVersionNumber = currentVersionNumber(shellState) + 1;
    logJob(runningJob._id, `building candidate version v${nextVersionNumber}`);
    const buildResult = await bundler.buildVersion(appId, nextVersionNumber, liveAppRoot);
    if (runningJob.pipelineRunId) {
      await convex.recordPipelineStage({
        runId: runningJob.pipelineRunId,
        appId,
        key: "build",
        status: "completed",
      });
      await convex.recordPipelineStage({
        runId: runningJob.pipelineRunId,
        appId,
        key: "upload",
        status: "running",
      });
    }
    logJob(
      runningJob._id,
      `build produced ${buildResult.artifacts.length} artifact(s), uploading to R2`,
    );
    await assertAppStillExists();
    const uploadSummary = await uploader.uploadArtifacts(buildResult.artifacts);
    const uploadedBytes = uploadSummary.uploaded.reduce((sum, artifact) => sum + artifact.bytes, 0);
    const skippedBytes = uploadSummary.skipped.reduce((sum, artifact) => sum + artifact.bytes, 0);
    logJob(
      runningJob._id,
      `R2 upload summary: uploaded ${uploadSummary.uploaded.length}/${buildResult.artifacts.length} artifact(s) (${formatBytes(uploadedBytes)}), skipped ${uploadSummary.skipped.length} existing artifact(s) (${formatBytes(skippedBytes)})`,
    );
    for (const artifact of uploadSummary.uploaded) {
      logJob(
        runningJob._id,
        `R2 uploaded ${artifact.key} (${formatBytes(artifact.bytes)}, ${artifact.contentType})`,
      );
    }
    for (const artifact of uploadSummary.skipped) {
      logJob(
        runningJob._id,
        `R2 skipped ${artifact.key} (${formatBytes(artifact.bytes)}, ${artifact.contentType})`,
      );
    }
    if (runningJob.pipelineRunId) {
      await convex.recordPipelineStage({
        runId: runningJob.pipelineRunId,
        appId,
        key: "upload",
        status: "completed",
      });
      await convex.recordPipelineStage({
        runId: runningJob.pipelineRunId,
        appId,
        key: "publish",
        status: "running",
      });
    }
    logJob(runningJob._id, "upload complete, recording ready version");
    await assertAppStillExists();
    await convex.recordReadyVersion({
      appId,
      jobId: runningJob._id,
      manifestUrl: `${config.r2PublicBaseUrl}/${manifestKeyForVersion(appId, nextVersionNumber)}`,
      buildLog: rewrite.summary || buildResult.buildLog,
      stateJson: buildResult.stateJson,
      agentResult,
      files: nextFiles,
    });
    if (runningJob.pipelineRunId) {
      await convex.recordPipelineStage({
        runId: runningJob.pipelineRunId,
        appId,
        key: "publish",
        status: "completed",
      });
    }
    logJob(
      runningJob._id,
      `completed in ${Date.now() - startedAt}ms as v${nextVersionNumber}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    logJob(runningJob._id, `failed after ${Date.now() - startedAt}ms`);
    console.error(message);
    if (runningJob.pipelineRunId) {
      for (const key of ["agent", "build", "upload", "publish"] as const) {
        await convex
          .recordPipelineStage({
            runId: runningJob.pipelineRunId,
            appId,
            key,
            status: "failed",
            detail: message,
          })
          .catch(() => undefined);
      }
    }
    await convex.recordBuildFailure({
      appId,
      jobId: runningJob._id,
      buildLog: message,
      agentResult,
    });
  }

  return true;
}

export async function processNextJob(
  config: WorkerConfig,
  convex: ConvexRuntimeClient,
  bundler: LiveAppBundler,
  uploader: R2Uploader,
): Promise<boolean> {
  const pendingJobId = await pollPendingJob(convex);
  if (!pendingJobId) {
    return false;
  }

  return processJobById(config, convex, bundler, uploader, pendingJobId);
}
