import type { LiveAppState } from "./shared/liveApp";
import { basename } from "node:path";
import type { WorkerConfig } from "./config";
import { ensureAppDependencies } from "./appDependencies";
import {
  type AgentCliConfig,
  countSourceBytes,
  extractAgentProgressMessages,
  formatAgentObservation,
  rewriteLiveAppFiles,
  selectLikelyTargetFiles,
} from "./agent";
import { manifestKeyForVersion } from "./artifacts";
import {
  buildFailedBoxRunUpdate,
  buildSuccessfulBoxRunUpdate,
  persistBoxRunUpdate,
  resolveBoxEngineContext,
} from "./boxEngines";
import { LiveAppBundler } from "./build";
import { ConvexRuntimeClient } from "./convex";
import { backfillOpenClawBoxProfiles, ensureDefaultOpenClawProfiles } from "./engineProfiles";
import {
  buildRepairPrompt,
  classifyFailure,
  type FailureStage,
} from "./failureRecovery";
import { readLiveAppFiles } from "./filesystem";
import { liveAppStateSchema } from "./shared/liveApp";
import { R2Uploader } from "./r2";
import {
  getWrappedAppLabel,
  inspectWrappedAppSource,
  resolveWrappedAppRoot,
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

function buildStageRetryDetail(stage: string): string {
  return `Reused the failed workspace candidate and skipped the agent before retrying from ${stage}.`;
}

function buildAgentTranscript(messages: string[]): string | undefined {
  if (messages.length === 0) {
    return undefined;
  }
  return messages.join("\n");
}

function normalizeAgentSummary(summary: string | null | undefined): string | undefined {
  const normalized = summary?.trim();
  return normalized ? normalized : undefined;
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

export function buildRewriteAgentConfig(args: {
  config: WorkerConfig;
  appId: string;
  selectedBoxId: string | null;
  liveAppRoot: string;
  liveAppLabel: string;
  boxEngineContext: ReturnType<typeof resolveBoxEngineContext>;
  usesOpenClawSession: boolean;
}): AgentCliConfig {
  const baseOpenClawConfig =
    args.usesOpenClawSession &&
    args.config.openClawGatewayBaseUrl &&
    args.config.openClawGatewayToken
      ? {
          openClaw: {
            baseUrl: args.config.openClawGatewayBaseUrl,
            token: args.config.openClawGatewayToken,
            agentId: args.config.openClawAgentId ?? null,
            agentIdPrefix: args.config.openClawAgentIdPrefix ?? null,
            sessionKeyPrefix: args.config.openClawSessionKeyPrefix,
            sessionKeyGeneration: 0,
          },
        }
      : {};

  return {
    appId: args.appId,
    boxId: args.boxEngineContext?.boxId ?? args.selectedBoxId,
    command: args.config.agentCommand,
    model: args.config.agentModel,
    timeoutMs: args.config.agentTimeoutMs,
    projectRoot: args.config.projectRoot,
    liveAppRoot: args.liveAppRoot,
    liveAppLabel: args.liveAppLabel,
    ...baseOpenClawConfig,
    ...args.boxEngineContext?.rewriteConfigPatch,
  };
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
    const nextStatus = await inspectWrappedAppSource(config.projectRoot, app.appId);
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
  const selectedBoxId = runningJob.boxId ?? null;
  const agentCommandName = basename(config.agentCommand).toLowerCase();
  const usesCodexThread = agentCommandName.startsWith("codex");
  const usesOpenClawSession = agentCommandName.startsWith("openclaw");
  const startedAt = Date.now();
  const assertAppStillExists = async () => {
    const appConfig = await convex.getAppConfig(appId, selectedBoxId);
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
  let boxEngineContext: ReturnType<typeof resolveBoxEngineContext> = null;
  const agentProgressMessages: string[] = [];
  let activeStage: FailureStage = "agent";
  let latestAgentStageDetail: string | null = null;
  let agentStageUpdateChain: Promise<void> = Promise.resolve();
  const recordAgentStageDetail = (status: "running" | "completed" | "failed", detail?: string) => {
    if (!runningJob.pipelineRunId || !detail) {
      return;
    }
    if (status === "running" && detail === latestAgentStageDetail) {
      return;
    }
    if (status === "running") {
      latestAgentStageDetail = detail;
    }
    agentStageUpdateChain = agentStageUpdateChain
      .catch(() => undefined)
      .then(async () => {
        await convex.recordPipelineStage({
          runId: runningJob.pipelineRunId!,
          appId,
          key: "agent",
          status,
          detail,
        });
      });
  };
  const flushAgentStageUpdates = async () => {
    await agentStageUpdateChain.catch(() => undefined);
  };
  const pushAgentProgress = (message: string) => {
    const normalized = message.replace(/\s+/g, " ").trim();
    if (!normalized || agentProgressMessages.includes(normalized)) {
      return;
    }
    if (agentProgressMessages.length >= 24) {
      agentProgressMessages.shift();
    }
    agentProgressMessages.push(normalized);
    logJob(runningJob._id, `agent progress ${normalized}`);
    recordAgentStageDetail("running", buildAgentTranscript(agentProgressMessages));
  };

  try {
    const shellState = await convex.getShellState(appId, selectedBoxId);
    if (config.openClawGatewayBaseUrl && config.openClawGatewayToken) {
      await ensureDefaultOpenClawProfiles(convex, config);
    }
    await backfillOpenClawBoxProfiles(convex, config);
    const appConfig = await assertAppStillExists();
    const selectedPrimaryBoxId = appConfig.primaryBox?.boxId ?? null;
    const shouldUseMirroredAppSession = !selectedBoxId || selectedBoxId === selectedPrimaryBoxId;
    const templateSource = await inspectWrappedAppSource(config.projectRoot, appConfig.appId);
    await convex.setAppTemplateSourceStatus({
      appId,
      status: templateSource.status,
      path: templateSource.path,
      message: templateSource.message,
    });
    if (templateSource.status === "missing") {
      throw new Error(
        templateSource.message ??
          `App '${appId}' is still mountable from a previously built version, but its source app is missing locally.`,
      );
    }
    const liveAppRoot = resolveWrappedAppRoot(config.projectRoot, appConfig.appId);
    const liveAppLabel = getWrappedAppLabel(appConfig.appId, config.projectRoot);
    const currentFiles = await readLiveAppFiles(liveAppRoot);
    const sourceBytes = countSourceBytes(currentFiles);
    boxEngineContext = resolveBoxEngineContext({
      config,
      appId,
      liveAppRoot,
      appConfig,
    });
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
    await persistBoxRunUpdate(convex, boxEngineContext, {
      status: "running",
      lastRunAt: Date.now(),
      lastError: null,
    });

    let nextFiles = currentFiles;
    if (runningJob.recoveryMode === "stage_retry") {
      if (runningJob.pipelineRunId) {
        await convex.recordPipelineStage({
          runId: runningJob.pipelineRunId,
          appId,
          key: "agent",
          status: "completed",
          detail: buildStageRetryDetail(runningJob.failureStage ?? "build"),
        });
        await convex.recordPipelineStage({
          runId: runningJob.pipelineRunId,
          appId,
          key: "build",
          status: "running",
        });
      }
      logJob(
        runningJob._id,
        `skipping agent and retrying from build using the current failed workspace candidate`,
      );
    } else {
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
        buildRewriteAgentConfig({
          config,
          appId,
          selectedBoxId,
          liveAppRoot,
          liveAppLabel,
          boxEngineContext,
          usesOpenClawSession,
        }),
        {
          prompt: runningJob.prompt,
          files: currentFiles,
          liveAppLabel,
          latestBuildError: shellState?.lastBuildError ?? null,
          latestRuntimeError: shellState?.lastRuntimeError ?? null,
          currentState: parseState(shellState?.currentStateJson ?? null),
          codexThreadId:
            usesCodexThread
              ? (
                  boxEngineContext?.sessionId ??
                  (shouldUseMirroredAppSession ? appConfig.codexThreadId ?? null : null)
                )
              : (appConfig.codexThreadId ?? null),
          openClawSessionId:
            usesOpenClawSession
              ? (
                  boxEngineContext?.sessionId ??
                  (shouldUseMirroredAppSession ? appConfig.openClawSessionId ?? null : null)
                )
              : (appConfig.openClawSessionId ?? null),
          boxContext: boxEngineContext
            ? {
                boxId: boxEngineContext.boxId,
                engine: boxEngineContext.engine,
                role: boxEngineContext.policy.role ?? null,
                instructions: boxEngineContext.policy.instructions ?? null,
                readOnly: boxEngineContext.policy.readOnly === true,
                proposalOnly: boxEngineContext.policy.proposalOnly === true,
                canPromote: boxEngineContext.policy.canPromote === true,
              }
            : null,
          primaryTargetFiles,
        },
        {
          onProgress: pushAgentProgress,
        },
      );
      for (const message of extractAgentProgressMessages(rewrite.details.notes ?? "")) {
        pushAgentProgress(message);
      }
      await flushAgentStageUpdates();
      logJob(
        runningJob._id,
        `agent returned ${rewrite.files.length} file write(s) and ${rewrite.deletedPaths.length} file deletion(s)`,
      );
      logJob(
        runningJob._id,
        `agent summary ${JSON.stringify(rewrite.details)}`,
      );
      logJob(
        runningJob._id,
        `agent observation\n${formatAgentObservation(rewrite.observation)}`,
      );
      agentResult = rewrite.details;
      const resolvedSessionId = usesOpenClawSession
        ? (rewrite.openClawSessionId ?? boxEngineContext?.sessionId ?? null)
        : usesCodexThread
          ? (rewrite.codexThreadId ?? boxEngineContext?.sessionId ?? null)
          : null;
      const isPrimaryBox = !boxEngineContext || boxEngineContext.boxId === selectedPrimaryBoxId;
      if (
        rewrite.codexThreadId !== null &&
        rewrite.codexThreadId !== (appConfig.codexThreadId ?? null) &&
        isPrimaryBox
      ) {
        await convex.setAppCodexThread({
          appId,
          threadId: rewrite.codexThreadId,
        });
      }
      if (
        rewrite.openClawSessionId !== null &&
        rewrite.openClawSessionId !== (appConfig.openClawSessionId ?? null) &&
        isPrimaryBox
      ) {
        await convex.setAppOpenClawSession({
          appId,
          sessionId: rewrite.openClawSessionId,
        });
      }
      if (boxEngineContext) {
        await persistBoxRunUpdate(
          convex,
          boxEngineContext,
          buildSuccessfulBoxRunUpdate({
            context: boxEngineContext,
            observation: rewrite.observation,
            sessionId: resolvedSessionId,
          }),
        );
      }
      if (runningJob.pipelineRunId) {
        const completedAgentDetail =
          buildAgentTranscript(agentProgressMessages) ??
          normalizeAgentSummary(rewrite.details.summary);
        await convex.recordPipelineStage({
          runId: runningJob.pipelineRunId,
          appId,
          key: "agent",
          status: "completed",
          detail: completedAgentDetail,
        });
        await convex.recordPipelineStage({
          runId: runningJob.pipelineRunId,
          appId,
          key: "build",
          status: "running",
        });
      }

      nextFiles = rewrite.allFiles;
      logJob(
        runningJob._id,
        `agent changed ${rewrite.files.length + rewrite.deletedPaths.length} file(s) in ${liveAppLabel}/src`,
      );
    }

    await assertAppStillExists();
    const nextVersionNumber = currentVersionNumber(shellState) + 1;
    logJob(runningJob._id, `building candidate version v${nextVersionNumber}`);
    activeStage = "build";
    const dependencyBootstrap = await ensureAppDependencies({
      projectRoot: config.projectRoot,
      appRoot: liveAppRoot,
      logger: (message) => logJob(runningJob._id, message),
    });
    if (dependencyBootstrap.installed) {
      logJob(
        runningJob._id,
        `dependency bootstrap completed for ${dependencyBootstrap.relativeAppRoot} via ${dependencyBootstrap.packageManager}`,
      );
    }
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
      `build produced ${buildResult.artifacts.length} artifact(s), uploading to ${config.artifactStorageLabel}`,
    );
    await assertAppStillExists();
    activeStage = "upload";
    const uploadSummary = await uploader.uploadArtifacts(buildResult.artifacts);
    const uploadedBytes = uploadSummary.uploaded.reduce((sum, artifact) => sum + artifact.bytes, 0);
    const skippedBytes = uploadSummary.skipped.reduce((sum, artifact) => sum + artifact.bytes, 0);
    logJob(
      runningJob._id,
      `${config.artifactStorageLabel} upload summary: uploaded ${uploadSummary.uploaded.length}/${buildResult.artifacts.length} artifact(s) (${formatBytes(uploadedBytes)}), skipped ${uploadSummary.skipped.length} existing artifact(s) (${formatBytes(skippedBytes)})`,
    );
    for (const artifact of uploadSummary.uploaded) {
      logJob(
        runningJob._id,
        `${config.artifactStorageLabel} uploaded ${artifact.key} (${formatBytes(artifact.bytes)}, ${artifact.contentType})`,
      );
    }
    for (const artifact of uploadSummary.skipped) {
      logJob(
        runningJob._id,
        `${config.artifactStorageLabel} skipped ${artifact.key} (${formatBytes(artifact.bytes)}, ${artifact.contentType})`,
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
    activeStage = "publish";
    await convex.recordReadyVersion({
      appId,
      jobId: runningJob._id,
      manifestUrl: `${config.publicDevelopmentUrl}/${manifestKeyForVersion(appId, nextVersionNumber)}`,
      buildLog: agentResult?.summary || buildResult.buildLog,
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
    await flushAgentStageUpdates().catch(() => undefined);
    logJob(runningJob._id, `failed after ${Date.now() - startedAt}ms`);
    console.error(message);
    const recoveryDecision = classifyFailure({
      stage: activeStage,
      message,
      recoveryAttempt: runningJob.recoveryAttempt ?? 0,
    });
    let autoRecoveryJobId: string | null = null;
    if (recoveryDecision.shouldAutoRecover && recoveryDecision.recoveryMode) {
      const recoveryPrompt =
        recoveryDecision.recoveryMode === "repair_with_agent"
          ? buildRepairPrompt({
              originalPrompt: runningJob.prompt,
              stage: activeStage,
              message,
            })
          : runningJob.prompt;
      autoRecoveryJobId = await convex
        .enqueueFailureRecoveryJob({
          appId,
          failedJobId: runningJob._id,
          prompt: recoveryPrompt,
          recoveryMode: recoveryDecision.recoveryMode,
          sourceStage: activeStage,
          failureClassification: recoveryDecision.classification,
        })
        .catch(() => null);
      if (autoRecoveryJobId) {
        logJob(
          runningJob._id,
          `scheduled automatic ${recoveryDecision.recoveryMode} recovery as job ${autoRecoveryJobId} (${recoveryDecision.reason})`,
        );
      }
    }
    if (boxEngineContext) {
      await persistBoxRunUpdate(
        convex,
        boxEngineContext,
        buildFailedBoxRunUpdate(boxEngineContext, message),
      ).catch(() => undefined);
    }
    if (runningJob.pipelineRunId) {
      const failedAgentDetail = buildAgentTranscript(agentProgressMessages);
      for (const key of ["agent", "build", "upload", "publish"] as const) {
        await convex
          .recordPipelineStage({
            runId: runningJob.pipelineRunId,
            appId,
            key,
            status: "failed",
            detail:
              key === "agent" && failedAgentDetail
                ? `${failedAgentDetail}\n\n${message}${
                    autoRecoveryJobId ? `\n\nAutomatic recovery queued: ${autoRecoveryJobId}` : ""
                  }`
                : `${message}${autoRecoveryJobId ? `\n\nAutomatic recovery queued: ${autoRecoveryJobId}` : ""}`,
          })
          .catch(() => undefined);
      }
    }
    await convex.recordBuildFailure({
      appId,
      jobId: runningJob._id,
      buildLog: message,
      failureStage: activeStage,
      failureClassification: recoveryDecision.classification,
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
