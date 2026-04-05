import { v } from "convex/values";
import { mutation, query } from "./server";

const agentResult = v.object({
  summary: v.string(),
  changed_files: v.array(v.string()),
  notes: v.optional(v.string()),
});

const pipelineStageStatus = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);

const failureClassification = v.union(
  v.literal("infra_transient"),
  v.literal("code_app"),
  v.literal("unknown"),
);

const recoveryMode = v.union(
  v.literal("stage_retry"),
  v.literal("repair_with_agent"),
);

const boxStatus = v.union(
  v.literal("unknown"),
  v.literal("ready"),
  v.literal("running"),
  v.literal("error"),
);

const engineProfileStatus = v.union(
  v.literal("ready"),
  v.literal("needs_setup"),
  v.literal("error"),
);

const providerProfileStatus = v.union(
  v.literal("ready"),
  v.literal("needs_auth"),
  v.literal("error"),
);

const engineProfileConfig = v.object({
  gatewayBaseUrl: v.optional(v.union(v.string(), v.null())),
  routingMode: v.optional(v.union(v.string(), v.null())),
  sessionKeyPrefix: v.optional(v.union(v.string(), v.null())),
  agentId: v.optional(v.union(v.string(), v.null())),
  agentIdPrefix: v.optional(v.union(v.string(), v.null())),
  tokenConfigured: v.optional(v.boolean()),
});

const providerProfileConfig = v.object({
  authMethod: v.optional(v.union(v.string(), v.null())),
  authTarget: v.optional(v.union(v.string(), v.null())),
});

const boxPolicy = v.object({
  transport: v.optional(v.string()),
  routingMode: v.optional(v.string()),
  workspaceIsolation: v.optional(v.string()),
  sessionKeyPrefix: v.optional(v.string()),
  role: v.optional(v.union(v.string(), v.null())),
  instructions: v.optional(v.union(v.string(), v.null())),
  readOnly: v.optional(v.boolean()),
  proposalOnly: v.optional(v.boolean()),
  canPromote: v.optional(v.boolean()),
});

const templateSourceStatus = v.union(
  v.literal("unknown"),
  v.literal("available"),
  v.literal("missing"),
);

const pipelineStageMeta: Record<string, { label: string; sortOrder: number }> = {
  queued: { label: "Queued", sortOrder: 10 },
  agent: { label: "Agent Rewrite", sortOrder: 20 },
  build: { label: "Bundle Build", sortOrder: 30 },
  upload: { label: "R2 Upload", sortOrder: 40 },
  publish: { label: "Convex Publish", sortOrder: 50 },
  preview: { label: "Preview Mount", sortOrder: 60 },
  activate: { label: "Activation", sortOrder: 70 },
};

function highestVersionNumber(versions: Array<{ versionNumber: number }>): number {
  return versions.reduce((max, version) => Math.max(max, version.versionNumber), 0);
}

async function upsertPipelineStage(
  ctx: any,
  args: {
    runId: any;
    appId: string;
    key: string;
    status: "running" | "completed" | "failed";
    detail?: string;
    startedAt?: number;
    endedAt?: number;
  },
) {
  const meta = pipelineStageMeta[args.key];
  if (!meta) {
    throw new Error(`Unknown pipeline stage '${args.key}'`);
  }

  const run = await ctx.db.get(args.runId);
  if (!run) {
    return;
  }

  const now = Date.now();
  const startedAt = args.startedAt ?? now;
  const existing = await ctx.db
    .query("pipelineStages")
    .withIndex("by_runId_and_key", (q: any) => q.eq("runId", args.runId).eq("key", args.key))
    .first();

  const endedAt =
    args.status === "running"
      ? undefined
      : (args.endedAt ?? now);

  if (existing) {
    const nextStartedAt = existing.startedAt ?? startedAt;
    await ctx.db.patch(existing._id, {
      status: args.status,
      detail: args.detail ?? existing.detail,
      startedAt: nextStartedAt,
      endedAt,
      durationMs: endedAt !== undefined ? Math.max(0, endedAt - nextStartedAt) : undefined,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.insert("pipelineStages", {
    appId: args.appId,
    runId: args.runId,
    key: args.key,
    label: meta.label,
    sortOrder: meta.sortOrder,
    status: args.status,
    startedAt,
    endedAt,
    durationMs: endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined,
    detail: args.detail,
    updatedAt: now,
  });
}

async function getPipelineRunsWithStages(ctx: any, appId: string, limit: number) {
  const runs = await ctx.db
    .query("pipelineRuns")
    .withIndex("by_appId_and_submittedAt", (q: any) => q.eq("appId", appId))
    .order("desc")
    .take(limit);

  return await Promise.all(
    runs.map(async (run: any) => {
      const stages = await ctx.db
        .query("pipelineStages")
        .withIndex("by_runId_and_sortOrder", (q: any) => q.eq("runId", run._id))
        .collect();
      return { ...run, stages };
    }),
  );
}

async function getAppById(ctx: any, appId: string) {
  return await ctx.db
    .query("apps")
    .withIndex("by_appId", (q: any) => q.eq("appId", appId))
    .first();
}

async function getAppByIdOrThrow(ctx: any, appId: string) {
  const app = await getAppById(ctx, appId);
  if (!app) {
    throw new Error(`App '${appId}' was not initialized`);
  }
  return app;
}

async function getShellSelectionById(ctx: any, shellId: string) {
  return await ctx.db
    .query("shellSelections")
    .withIndex("by_shellId", (q: any) => q.eq("shellId", shellId))
    .first();
}

async function getArtifactPurgeTaskByAppId(ctx: any, appId: string) {
  return await ctx.db
    .query("artifactPurgeTasks")
    .withIndex("by_appId", (q: any) => q.eq("appId", appId))
    .first();
}

function sortBoxesForApp(boxes: any[], appId: string) {
  return [...boxes].sort((left, right) => {
    const leftPrimary = left.boxId === `${left.engine ?? "openclaw"}:${appId}` ? 0 : 1;
    const rightPrimary = right.boxId === `${right.engine ?? "openclaw"}:${appId}` ? 0 : 1;
    if (leftPrimary !== rightPrimary) {
      return leftPrimary - rightPrimary;
    }
    if ((left.createdAt ?? 0) !== (right.createdAt ?? 0)) {
      return (left.createdAt ?? 0) - (right.createdAt ?? 0);
    }
    return String(left.boxId).localeCompare(String(right.boxId));
  });
}

async function getBoxesByAppId(ctx: any, appId: string) {
  const boxes = await ctx.db
    .query("boxes")
    .withIndex("by_appId", (q: any) => q.eq("appId", appId))
    .collect();
  return sortBoxesForApp(boxes, appId);
}

async function getBoxByAppId(ctx: any, appId: string) {
  const boxes = await getBoxesByAppId(ctx, appId);
  return boxes[0] ?? null;
}

async function getBoxByBoxId(ctx: any, boxId: string) {
  return await ctx.db
    .query("boxes")
    .withIndex("by_boxId", (q: any) => q.eq("boxId", boxId))
    .first();
}

async function createQueuedJobAndRun(
  ctx: any,
  args: {
    appId: string;
    boxId?: string | null;
    prompt: string;
    baseVersionId?: any;
    clearLastBuildError?: boolean;
    recoveryMode?: "stage_retry" | "repair_with_agent";
    recoveryParentJobId?: any;
    recoveryAttempt?: number;
    failureStage?: string;
    failureClassification?: "infra_transient" | "code_app" | "unknown";
  },
) {
  const submittedAt = Date.now();
  const app = await getAppByIdOrThrow(ctx, args.appId);
  if (args.clearLastBuildError !== false) {
    await ctx.db.patch(app._id, {
      lastBuildError: null,
      updatedAt: submittedAt,
    });
  } else {
    await ctx.db.patch(app._id, {
      updatedAt: submittedAt,
    });
  }

  const jobId = await ctx.db.insert("jobs", {
    appId: args.appId,
    boxId: args.boxId ?? null,
    prompt: args.prompt,
    status: "pending",
    submittedAt,
    baseVersionId: args.baseVersionId ?? app.activeVersionId,
    recoveryMode: args.recoveryMode,
    recoveryParentJobId: args.recoveryParentJobId,
    recoveryAttempt: args.recoveryAttempt,
    failureStage: args.failureStage,
    failureClassification: args.failureClassification,
  });
  const pipelineRunId = await ctx.db.insert("pipelineRuns", {
    appId: args.appId,
    boxId: args.boxId ?? null,
    jobId,
    prompt: args.prompt,
    status: "pending",
    submittedAt,
    updatedAt: submittedAt,
    recoveryMode: args.recoveryMode,
    recoveryParentJobId: args.recoveryParentJobId,
    recoveryAttempt: args.recoveryAttempt,
    failureStage: args.failureStage,
    failureClassification: args.failureClassification,
  });
  await ctx.db.patch(jobId, {
    pipelineRunId,
  });
  await upsertPipelineStage(ctx, {
    runId: pipelineRunId,
    appId: args.appId,
    key: "queued",
    status: "running",
    startedAt: submittedAt,
  });

  return jobId;
}

async function getEngineProfileById(ctx: any, engineProfileId: string) {
  return await ctx.db
    .query("engineProfiles")
    .withIndex("by_engineProfileId", (q: any) => q.eq("engineProfileId", engineProfileId))
    .first();
}

async function getProviderProfileById(ctx: any, providerProfileId: string) {
  return await ctx.db
    .query("providerProfiles")
    .withIndex("by_providerProfileId", (q: any) => q.eq("providerProfileId", providerProfileId))
    .first();
}

async function serializeBoxesWithProfiles(ctx: any, boxes: any[]) {
  const engineProfileIds = Array.from(
    new Set(
      boxes
        .map((box) => box?.engineProfileId ?? null)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );
  const providerProfileIds = Array.from(
    new Set(
      boxes
        .map((box) => box?.providerProfileId ?? null)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );

  const [engineProfiles, providerProfiles] = await Promise.all([
    Promise.all(engineProfileIds.map((engineProfileId) => getEngineProfileById(ctx, engineProfileId))),
    Promise.all(providerProfileIds.map((providerProfileId) => getProviderProfileById(ctx, providerProfileId))),
  ]);

  const engineProfilesById = new Map(
    engineProfiles
      .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
      .map((profile) => [profile.engineProfileId, profile]),
  );
  const providerProfilesById = new Map(
    providerProfiles
      .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
      .map((profile) => [profile.providerProfileId, profile]),
  );

  return boxes.map((box) =>
    serializeBox(box, {
      engineProfile:
        box?.engineProfileId ? engineProfilesById.get(box.engineProfileId) ?? null : null,
      providerProfile:
        box?.providerProfileId ? providerProfilesById.get(box.providerProfileId) ?? null : null,
    }),
  );
}

function selectBoxFromSerializedList(boxes: any[], boxId?: string | null) {
  if (!boxes.length) {
    return null;
  }
  if (!boxId) {
    return boxes[0] ?? null;
  }
  return boxes.find((box) => box?.boxId === boxId) ?? boxes[0] ?? null;
}

function serializeEngineProfile(profile: any) {
  if (!profile) {
    return null;
  }

  return {
    engineProfileId: profile.engineProfileId,
    engine: profile.engine,
    name: profile.name,
    description: profile.description ?? null,
    status: profile.status,
    isDefault: profile.isDefault === true,
    config: profile.config ?? {},
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function serializeProviderProfile(profile: any) {
  if (!profile) {
    return null;
  }

  return {
    providerProfileId: profile.providerProfileId,
    engineProfileId: profile.engineProfileId ?? null,
    provider: profile.provider,
    name: profile.name,
    description: profile.description ?? null,
    model: profile.model ?? null,
    status: profile.status,
    isDefault: profile.isDefault === true,
    config: profile.config ?? {},
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function serializeBox(box: any, related?: { engineProfile?: any; providerProfile?: any }) {
  if (!box) {
    return null;
  }

  return {
    boxId: box.boxId,
    subjectId: box.subjectId ?? box.appId,
    subjectKind: box.subjectKind ?? "app",
    appId: box.appId ?? null,
    engine: box.engine ?? box.provider ?? "openclaw",
    engineProfileId: box.engineProfileId ?? null,
    providerProfileId: box.providerProfileId ?? null,
    agentId: box.agentId ?? null,
    targetPath: box.targetPath ?? box.workspacePath ?? null,
    workspacePath: box.workspacePath ?? box.targetPath ?? null,
    sessionId: box.sessionId ?? null,
    sessionKeyGeneration:
      typeof box.sessionKeyGeneration === "number" && Number.isFinite(box.sessionKeyGeneration)
        ? Math.max(0, Math.trunc(box.sessionKeyGeneration))
        : 0,
    provider: box.provider ?? null,
    model: box.model ?? null,
    engineProfile: serializeEngineProfile(related?.engineProfile ?? null),
    providerProfile: serializeProviderProfile(related?.providerProfile ?? null),
    status: box.status,
    policy: box.policy ?? {},
    lastRunAt: box.lastRunAt ?? null,
    lastError: box.lastError ?? null,
    createdAt: box.createdAt,
    updatedAt: box.updatedAt,
  };
}

type LegacyAppIdMigrationCounts = {
  boxes: number;
  versions: number;
  appFiles: number;
  jobs: number;
  pipelineRuns: number;
  pipelineStages: number;
  runtimeErrors: number;
  artifactPurgeTasks: number;
  shellSelections: number;
};

type LegacyAppIdMigration = {
  fromAppId: string;
  toAppId: string;
  name: string;
  counts: LegacyAppIdMigrationCounts;
};

type LegacyAppIdMigrationConflict = {
  fromAppId: string;
  toAppId: string;
  reason: string;
};

type LegacyTemplateFieldCleanupSummary = {
  appDocs: number;
  pipelineRuns: number;
};

function readLegacyTemplateId(app: any): string | null {
  const templateId = typeof app?.templateId === "string" ? app.templateId.trim() : "";
  if (!templateId || templateId === app.appId) {
    return null;
  }
  return templateId;
}

async function collectLegacyAppIdMigrationCounts(
  ctx: any,
  appId: string,
): Promise<LegacyAppIdMigrationCounts> {
  const [boxes, versions, appFiles, jobs, pipelineRuns, pipelineStages, runtimeErrors, purgeTasks, shellSelections] =
    await Promise.all([
      ctx.db
        .query("boxes")
        .withIndex("by_appId", (q: any) => q.eq("appId", appId))
        .collect(),
      ctx.db
        .query("versions")
        .withIndex("by_appId_and_versionNumber", (q: any) => q.eq("appId", appId))
        .collect(),
      ctx.db
        .query("appFiles")
        .withIndex("by_appId", (q: any) => q.eq("appId", appId))
        .collect(),
      ctx.db
        .query("jobs")
        .withIndex("by_appId_and_submittedAt", (q: any) => q.eq("appId", appId))
        .collect(),
      ctx.db
        .query("pipelineRuns")
        .withIndex("by_appId_and_submittedAt", (q: any) => q.eq("appId", appId))
        .collect(),
      ctx.db
        .query("pipelineStages")
        .withIndex("by_appId_and_startedAt", (q: any) => q.eq("appId", appId))
        .collect(),
      ctx.db
        .query("runtimeErrors")
        .withIndex("by_appId_and_createdAt", (q: any) => q.eq("appId", appId))
        .collect(),
      ctx.db
        .query("artifactPurgeTasks")
        .withIndex("by_appId", (q: any) => q.eq("appId", appId))
        .collect(),
      ctx.db
        .query("shellSelections")
        .withIndex("by_selectedAppId", (q: any) => q.eq("selectedAppId", appId))
        .collect(),
    ]);

  return {
    boxes: boxes.length,
    versions: versions.length,
    appFiles: appFiles.length,
    jobs: jobs.length,
    pipelineRuns: pipelineRuns.length,
    pipelineStages: pipelineStages.length,
    runtimeErrors: runtimeErrors.length,
    artifactPurgeTasks: purgeTasks.length,
    shellSelections: shellSelections.length,
  };
}

async function buildLegacyAppIdMigrationPlan(ctx: any): Promise<{
  migrations: LegacyAppIdMigration[];
  conflicts: LegacyAppIdMigrationConflict[];
}> {
  const apps = await ctx.db.query("apps").collect();
  const reservedCanonicalIds = new Set<string>(apps.map((app: any) => app.appId));
  const claimedTargetIds = new Set<string>();
  const migrations: LegacyAppIdMigration[] = [];
  const conflicts: LegacyAppIdMigrationConflict[] = [];

  for (const app of apps) {
    const toAppId = readLegacyTemplateId(app);
    if (!toAppId) {
      continue;
    }

    if (reservedCanonicalIds.has(toAppId)) {
      conflicts.push({
        fromAppId: app.appId,
        toAppId,
        reason: `target app id '${toAppId}' already exists`,
      });
      continue;
    }

    if (claimedTargetIds.has(toAppId)) {
      conflicts.push({
        fromAppId: app.appId,
        toAppId,
        reason: `multiple legacy apps resolve to '${toAppId}'`,
      });
      continue;
    }

    claimedTargetIds.add(toAppId);
    migrations.push({
      fromAppId: app.appId,
      toAppId,
      name: app.name,
      counts: await collectLegacyAppIdMigrationCounts(ctx, app.appId),
    });
  }

  return { migrations, conflicts };
}

async function collectLegacyTemplateFieldCleanupSummary(
  ctx: any,
): Promise<LegacyTemplateFieldCleanupSummary> {
  const [apps, pipelineRuns] = await Promise.all([
    ctx.db.query("apps").collect(),
    ctx.db.query("pipelineRuns").collect(),
  ]);

  return {
    appDocs: apps.filter((app: any) => typeof app?.templateId === "string" && app.templateId.trim()).length,
    pipelineRuns: pipelineRuns.filter(
      (run: any) => typeof run?.templateId === "string" && run.templateId.trim(),
    ).length,
  };
}

function buildAppReplacementDoc(app: any, nextAppId: string, updatedAt: number) {
  const nextDoc: Record<string, unknown> = {
    appId: nextAppId,
    slug: app.slug ?? app.appId,
    name: app.name,
    codexThreadId: app.codexThreadId ?? null,
    openClawSessionId: app.openClawSessionId ?? null,
    templateSourceStatus: app.templateSourceStatus ?? "unknown",
    templateSourcePath: app.templateSourcePath ?? null,
    templateSourceMessage: app.templateSourceMessage ?? null,
    templateSourceCheckedAt: app.templateSourceCheckedAt ?? null,
    currentStateJson: app.currentStateJson ?? null,
    lastBuildError: app.lastBuildError ?? null,
    lastRuntimeError: app.lastRuntimeError ?? null,
    updatedAt,
  };

  if (app.activeVersionId !== undefined) {
    nextDoc.activeVersionId = app.activeVersionId;
  }
  if (app.previewCursorVersionNumber !== undefined) {
    nextDoc.previewCursorVersionNumber = app.previewCursorVersionNumber;
  }

  return nextDoc;
}

function buildPipelineRunReplacementDoc(run: any, nextAppId: string, updatedAt: number) {
  const nextDoc: Record<string, unknown> = {
    appId: nextAppId,
    jobId: run.jobId,
    prompt: run.prompt,
    status: run.status,
    submittedAt: run.submittedAt,
    updatedAt,
  };

  if (run.boxId !== undefined) {
    nextDoc.boxId = run.boxId;
  }
  if (run.templateId !== undefined) {
    nextDoc.templateId = run.templateId;
  }
  if (run.versionId !== undefined) {
    nextDoc.versionId = run.versionId;
  }
  if (run.claimedAt !== undefined) {
    nextDoc.claimedAt = run.claimedAt;
  }
  if (run.completedAt !== undefined) {
    nextDoc.completedAt = run.completedAt;
  }
  if (run.failedAt !== undefined) {
    nextDoc.failedAt = run.failedAt;
  }
  if (run.failureStage !== undefined) {
    nextDoc.failureStage = run.failureStage;
  }
  if (run.failureClassification !== undefined) {
    nextDoc.failureClassification = run.failureClassification;
  }
  if (run.recoveryMode !== undefined) {
    nextDoc.recoveryMode = run.recoveryMode;
  }
  if (run.recoveryParentJobId !== undefined) {
    nextDoc.recoveryParentJobId = run.recoveryParentJobId;
  }
  if (run.recoveryAttempt !== undefined) {
    nextDoc.recoveryAttempt = run.recoveryAttempt;
  }

  return nextDoc;
}

function buildJobReplacementDoc(job: any) {
  const nextDoc: Record<string, unknown> = {
    appId: job.appId,
    prompt: job.prompt,
    status: job.status,
    submittedAt: job.submittedAt,
  };

  if (job.boxId !== undefined) {
    nextDoc.boxId = job.boxId;
  }
  if (job.claimedAt !== undefined) {
    nextDoc.claimedAt = job.claimedAt;
  }
  if (job.baseVersionId !== undefined) {
    nextDoc.baseVersionId = job.baseVersionId;
  }
  if (job.buildError !== undefined) {
    nextDoc.buildError = job.buildError;
  }
  if (job.agentResult !== undefined) {
    nextDoc.agentResult = job.agentResult;
  }
  if (job.resultVersionId !== undefined) {
    nextDoc.resultVersionId = job.resultVersionId;
  }
  if (job.pipelineRunId !== undefined) {
    nextDoc.pipelineRunId = job.pipelineRunId;
  }
  if (job.failureStage !== undefined) {
    nextDoc.failureStage = job.failureStage;
  }
  if (job.failureClassification !== undefined) {
    nextDoc.failureClassification = job.failureClassification;
  }
  if (job.recoveryMode !== undefined) {
    nextDoc.recoveryMode = job.recoveryMode;
  }
  if (job.recoveryParentJobId !== undefined) {
    nextDoc.recoveryParentJobId = job.recoveryParentJobId;
  }
  if (job.recoveryAttempt !== undefined) {
    nextDoc.recoveryAttempt = job.recoveryAttempt;
  }
  if (job.autoRecoveryTriggered !== undefined) {
    nextDoc.autoRecoveryTriggered = job.autoRecoveryTriggered;
  }
  if (job.autoRecoveryJobId !== undefined) {
    nextDoc.autoRecoveryJobId = job.autoRecoveryJobId;
  }

  return nextDoc;
}

function buildRuntimeErrorReplacementDoc(runtimeError: any) {
  const nextDoc: Record<string, unknown> = {
    appId: runtimeError.appId,
    message: runtimeError.message,
    createdAt: runtimeError.createdAt,
  };

  if (runtimeError.versionId !== undefined) {
    nextDoc.versionId = runtimeError.versionId;
  }
  if (runtimeError.stack !== undefined) {
    nextDoc.stack = runtimeError.stack;
  }

  return nextDoc;
}

function getLatestFailedStage(stages: any[]) {
  const failedStages = stages
    .filter((stage) => stage?.status === "failed")
    .sort((left, right) => (right.sortOrder ?? 0) - (left.sortOrder ?? 0));
  return failedStages[0] ?? null;
}

function buildManualRepairPrompt(args: {
  originalPrompt: string;
  stageLabel: string;
  stageKey: string;
  detail: string | null;
}) {
  const failureLog = (args.detail ?? "").trim() || "No failure detail was recorded.";
  return [
    "Repair the current failed candidate in place instead of starting from the live version.",
    "Only make the minimum code or dependency changes needed so the pipeline can complete.",
    "",
    `Original request: ${args.originalPrompt.trim()}`,
    `Failed stage: ${args.stageLabel} (${args.stageKey})`,
    "",
    "Failure log:",
    failureLog.length > 4000 ? `${failureLog.slice(0, 3985)}\n...[truncated]` : failureLog,
  ].join("\n");
}

async function applyLegacyAppIdMigration(ctx: any, migration: LegacyAppIdMigration): Promise<void> {
  const app = await getAppById(ctx, migration.fromAppId);
  if (!app) {
    return;
  }

  const now = Date.now();
  const [boxes, versions, appFiles, jobs, pipelineRuns, pipelineStages, runtimeErrors, purgeTasks, shellSelections] =
    await Promise.all([
      ctx.db
        .query("boxes")
        .withIndex("by_appId", (q: any) => q.eq("appId", migration.fromAppId))
        .collect(),
      ctx.db
        .query("versions")
        .withIndex("by_appId_and_versionNumber", (q: any) => q.eq("appId", migration.fromAppId))
        .collect(),
      ctx.db
        .query("appFiles")
        .withIndex("by_appId", (q: any) => q.eq("appId", migration.fromAppId))
        .collect(),
      ctx.db
        .query("jobs")
        .withIndex("by_appId_and_submittedAt", (q: any) => q.eq("appId", migration.fromAppId))
        .collect(),
      ctx.db
        .query("pipelineRuns")
        .withIndex("by_appId_and_submittedAt", (q: any) => q.eq("appId", migration.fromAppId))
        .collect(),
      ctx.db
        .query("pipelineStages")
        .withIndex("by_appId_and_startedAt", (q: any) => q.eq("appId", migration.fromAppId))
        .collect(),
      ctx.db
        .query("runtimeErrors")
        .withIndex("by_appId_and_createdAt", (q: any) => q.eq("appId", migration.fromAppId))
        .collect(),
      ctx.db
        .query("artifactPurgeTasks")
        .withIndex("by_appId", (q: any) => q.eq("appId", migration.fromAppId))
        .collect(),
      ctx.db
        .query("shellSelections")
        .withIndex("by_selectedAppId", (q: any) => q.eq("selectedAppId", migration.fromAppId))
        .collect(),
    ]);

  await ctx.db.replace(app._id, buildAppReplacementDoc(app, migration.toAppId, now));

  for (const box of boxes) {
    await ctx.db.patch(box._id, { appId: migration.toAppId, updatedAt: now });
  }
  for (const version of versions) {
    await ctx.db.patch(version._id, { appId: migration.toAppId });
  }
  for (const file of appFiles) {
    await ctx.db.patch(file._id, { appId: migration.toAppId });
  }
  for (const job of jobs) {
    await ctx.db.patch(job._id, { appId: migration.toAppId });
  }
  for (const run of pipelineRuns) {
    await ctx.db.replace(run._id, buildPipelineRunReplacementDoc(run, migration.toAppId, now));
  }
  for (const stage of pipelineStages) {
    await ctx.db.patch(stage._id, { appId: migration.toAppId });
  }
  for (const runtimeError of runtimeErrors) {
    await ctx.db.patch(runtimeError._id, { appId: migration.toAppId });
  }
  for (const purgeTask of purgeTasks) {
    await ctx.db.patch(purgeTask._id, { appId: migration.toAppId, updatedAt: now });
  }
  for (const selection of shellSelections) {
    await ctx.db.patch(selection._id, {
      selectedAppId: migration.toAppId,
      updatedAt: now,
    });
  }
}

async function scrubLegacyTemplateIds(ctx: any): Promise<void> {
  const now = Date.now();
  const [apps, pipelineRuns] = await Promise.all([
    ctx.db.query("apps").collect(),
    ctx.db.query("pipelineRuns").collect(),
  ]);

  for (const app of apps) {
    if (typeof app?.templateId !== "string" || !app.templateId.trim()) {
      continue;
    }
    await ctx.db.replace(app._id, buildAppReplacementDoc(app, app.appId, now));
  }

  for (const run of pipelineRuns) {
    if (typeof run?.templateId !== "string" || !run.templateId.trim()) {
      continue;
    }
    await ctx.db.replace(run._id, buildPipelineRunReplacementDoc(run, run.appId, now));
  }
}

async function deleteAppDataRecords(ctx: any, appId: string) {
  const boxes = await ctx.db
    .query("boxes")
    .withIndex("by_appId", (q) => q.eq("appId", appId))
    .collect();
  for (const box of boxes) {
    await ctx.db.delete(box._id);
  }

  const pipelineStages = await ctx.db
    .query("pipelineStages")
    .withIndex("by_appId_and_startedAt", (q) => q.eq("appId", appId))
    .collect();
  for (const stage of pipelineStages) {
    await ctx.db.delete(stage._id);
  }

  const pipelineRuns = await ctx.db
    .query("pipelineRuns")
    .withIndex("by_appId_and_submittedAt", (q) => q.eq("appId", appId))
    .collect();
  for (const run of pipelineRuns) {
    await ctx.db.delete(run._id);
  }

  const runtimeErrors = await ctx.db
    .query("runtimeErrors")
    .withIndex("by_appId_and_createdAt", (q) => q.eq("appId", appId))
    .collect();
  for (const error of runtimeErrors) {
    await ctx.db.delete(error._id);
  }

  const versions = await ctx.db
    .query("versions")
    .withIndex("by_appId_and_versionNumber", (q) => q.eq("appId", appId))
    .collect();
  for (const version of versions) {
    await ctx.db.delete(version._id);
  }

  const appFiles = await ctx.db
    .query("appFiles")
    .withIndex("by_appId", (q) => q.eq("appId", appId))
    .collect();
  for (const file of appFiles) {
    await ctx.db.delete(file._id);
  }

  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_appId_and_submittedAt", (q) => q.eq("appId", appId))
    .collect();
  for (const job of jobs) {
    await ctx.db.delete(job._id);
  }
}

async function upsertShellSelection(
  ctx: any,
  args: { shellId: string; selectedAppId: string | null },
) {
  const existing = await getShellSelectionById(ctx, args.shellId);
  if (existing) {
    await ctx.db.patch(existing._id, {
      selectedAppId: args.selectedAppId,
      updatedAt: Date.now(),
    });
    return existing._id;
  }

  return await ctx.db.insert("shellSelections", {
    shellId: args.shellId,
    selectedAppId: args.selectedAppId,
    updatedAt: Date.now(),
  });
}

export const getShellState = query({
  args: {
    appId: v.string(),
    boxId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_appId", (q) => q.eq("appId", args.appId))
      .first();

    if (!app) {
      return null;
    }

    const activeVersion = app.activeVersionId
      ? await ctx.db.get(app.activeVersionId)
      : null;

    const readyVersions = await ctx.db
      .query("versions")
      .withIndex("by_appId_and_status", (q) =>
        q.eq("appId", args.appId).eq("status", "ready"),
      )
      .collect();
    const allVersions = await ctx.db
      .query("versions")
      .withIndex("by_appId_and_versionNumber", (q) => q.eq("appId", args.appId))
      .collect();
    const latestVersionNumber = highestVersionNumber(allVersions);
    const previewCursorVersionNumber =
      app.previewCursorVersionNumber ?? activeVersion?.versionNumber ?? latestVersionNumber;

    const nextReadyVersion =
      readyVersions
        .filter(
          (version) =>
            version.versionNumber > previewCursorVersionNumber,
        )
        .sort((left, right) => right.versionNumber - left.versionNumber)[0] ?? null;

    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_appId_and_submittedAt", (q) => q.eq("appId", args.appId))
      .order("desc")
      .collect();

    const latestJob = jobs[0] ?? null;
    const latestCompletedJob =
      jobs.find((job) => job.status === "completed" || job.status === "failed") ?? null;
    const latestPipelineRuns = await getPipelineRunsWithStages(ctx, args.appId, 8);
    const latestRuntimeErrorRecord = await ctx.db
      .query("runtimeErrors")
      .withIndex("by_appId_and_createdAt", (q) => q.eq("appId", args.appId))
      .order("desc")
      .first();
    const serializedBoxes = await serializeBoxesWithProfiles(
      ctx,
      await getBoxesByAppId(ctx, args.appId),
    );
    const primaryBox = serializedBoxes[0] ?? null;
    const box = selectBoxFromSerializedList(serializedBoxes, args.boxId ?? null);
    const engineProfile = box?.engineProfile ?? null;
    const providerProfile = box?.providerProfile ?? null;

    return {
      appId: app.appId,
      slug: app.slug ?? app.appId,
      name: app.name,
      box,
      boxes: serializedBoxes,
      primaryBox,
      boxCount: serializedBoxes.length,
      engineProfile,
      providerProfile,
      templateSourceStatus: app.templateSourceStatus ?? "unknown",
      templateSourcePath: app.templateSourcePath ?? null,
      templateSourceMessage: app.templateSourceMessage ?? null,
      templateSourceCheckedAt: app.templateSourceCheckedAt ?? null,
      lastBuildError: app.lastBuildError ?? null,
      lastRuntimeError: app.lastRuntimeError ?? null,
      currentStateJson: app.currentStateJson ?? activeVersion?.stateJson ?? null,
      latestAgentResult:
        latestCompletedJob?.agentResult ??
        nextReadyVersion?.agentResult ??
        activeVersion?.agentResult ??
        null,
      latestVersionNumber,
      previewCursorVersionNumber,
      activeVersion,
      nextReadyVersion,
      latestJob,
      latestCompletedJob,
      latestRuntimeErrorRecord,
      latestPipelineRuns,
      latestPipelineRun: latestPipelineRuns[0] ?? null,
    };
  },
});

export const submitPrompt = mutation({
  args: {
    appId: v.string(),
    boxId: v.optional(v.union(v.string(), v.null())),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await getAppByIdOrThrow(ctx, args.appId);
    if (app.templateSourceStatus === "missing") {
      throw new Error(
        app.templateSourceMessage ??
          `App '${args.appId}' is still mountable from a previously built version, but its source app is missing locally. Restore it before submitting prompts.`,
      );
    }
    if (args.boxId) {
      const box = await getBoxByBoxId(ctx, args.boxId);
      if (!box || box.appId !== args.appId) {
        throw new Error(`Box '${args.boxId}' does not belong to app '${args.appId}'.`);
      }
    }
    return await createQueuedJobAndRun(ctx, {
      appId: args.appId,
      boxId: args.boxId ?? null,
      prompt: args.prompt,
      baseVersionId: app.activeVersionId,
      clearLastBuildError: true,
    });
  },
});

export const enqueueFailureRecoveryJob = mutation({
  args: {
    appId: v.string(),
    failedJobId: v.id("jobs"),
    prompt: v.string(),
    recoveryMode,
    sourceStage: v.string(),
    failureClassification,
  },
  handler: async (ctx, args) => {
    const failedJob = await ctx.db.get(args.failedJobId);
    if (!failedJob || failedJob.appId !== args.appId) {
      throw new Error("Failed job not found for app");
    }

    const app = await getAppByIdOrThrow(ctx, args.appId);
    const currentAttempt = Math.max(
      0,
      Math.trunc(failedJob.recoveryAttempt ?? 0),
    );
    const recoveryAttempt = currentAttempt + 1;

    const recoveryJobId = await createQueuedJobAndRun(ctx, {
      appId: args.appId,
      boxId: failedJob.boxId ?? null,
      prompt: args.prompt,
      baseVersionId: failedJob.baseVersionId ?? app.activeVersionId,
      clearLastBuildError: false,
      recoveryMode: args.recoveryMode,
      recoveryParentJobId: args.failedJobId,
      recoveryAttempt,
      failureStage: args.sourceStage,
      failureClassification: args.failureClassification,
    });

    await ctx.db.patch(args.failedJobId, {
      autoRecoveryTriggered: true,
      autoRecoveryJobId: recoveryJobId,
      failureStage: args.sourceStage,
      failureClassification: args.failureClassification,
    });

    if (failedJob.pipelineRunId) {
      const run = await ctx.db.get(failedJob.pipelineRunId);
      if (run) {
        await ctx.db.patch(failedJob.pipelineRunId, {
          failureStage: args.sourceStage,
          failureClassification: args.failureClassification,
          updatedAt: Date.now(),
        });
      }
    }

    return recoveryJobId;
  },
});

export const requestPipelineRepair = mutation({
  args: {
    appId: v.string(),
    runId: v.id("pipelineRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.appId !== args.appId) {
      throw new Error("Pipeline run not found for app");
    }
    if (run.status !== "failed") {
      throw new Error("Only failed pipeline runs can be repaired");
    }

    const failedJob = await ctx.db.get(run.jobId);
    if (!failedJob || failedJob.appId !== args.appId) {
      throw new Error("Failed job not found for pipeline run");
    }

    const stages = await ctx.db
      .query("pipelineStages")
      .withIndex("by_runId_and_sortOrder", (q: any) => q.eq("runId", args.runId))
      .collect();
    const failedStage = getLatestFailedStage(stages);
    const stageKey = failedStage?.key ?? run.failureStage ?? "unknown";
    const stageLabel = failedStage?.label ?? pipelineStageMeta[stageKey]?.label ?? "Failed Stage";
    const stageDetail =
      typeof failedStage?.detail === "string" && failedStage.detail.trim()
        ? failedStage.detail
        : (failedJob.buildError ?? null);
    const recoveryPrompt = buildManualRepairPrompt({
      originalPrompt: run.prompt,
      stageLabel,
      stageKey,
      detail: stageDetail,
    });

    const app = await getAppByIdOrThrow(ctx, args.appId);
    const currentAttempt = Math.max(0, Math.trunc(failedJob.recoveryAttempt ?? 0));
    const recoveryAttempt = currentAttempt + 1;
    const recoveryJobId = await createQueuedJobAndRun(ctx, {
      appId: args.appId,
      boxId: run.boxId ?? failedJob.boxId ?? null,
      prompt: recoveryPrompt,
      baseVersionId: failedJob.baseVersionId ?? app.activeVersionId,
      clearLastBuildError: false,
      recoveryMode: "repair_with_agent",
      recoveryParentJobId: failedJob._id,
      recoveryAttempt,
      failureStage: stageKey,
      failureClassification:
        run.failureClassification ?? failedJob.failureClassification ?? "code_app",
    });

    await ctx.db.patch(failedJob._id, {
      autoRecoveryTriggered: true,
      autoRecoveryJobId: recoveryJobId,
      failureStage: stageKey,
      failureClassification:
        run.failureClassification ?? failedJob.failureClassification ?? "code_app",
    });
    await ctx.db.patch(run._id, {
      failureStage: stageKey,
      failureClassification:
        run.failureClassification ?? failedJob.failureClassification ?? "code_app",
      updatedAt: Date.now(),
    });

    return recoveryJobId;
  },
});

export const getShellSelection = query({
  args: {
    shellId: v.string(),
  },
  handler: async (ctx, args) => {
    const selection = await getShellSelectionById(ctx, args.shellId);
    return {
      shellId: args.shellId,
      selectedAppId: selection?.selectedAppId ?? null,
      updatedAt: selection?.updatedAt ?? null,
    };
  },
});

export const setSelectedApp = mutation({
  args: {
    shellId: v.string(),
    appId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await upsertShellSelection(ctx, {
      shellId: args.shellId,
      selectedAppId: args.appId,
    });
  },
});

export const publishState = mutation({
  args: {
    appId: v.string(),
    stateJson: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    if (!app) {
      return;
    }
    await ctx.db.patch(app._id, {
      currentStateJson: args.stateJson,
      updatedAt: Date.now(),
    });
  },
});

export const activateVersion = mutation({
  args: {
    appId: v.string(),
    versionId: v.id("versions"),
    mode: v.optional(v.union(v.literal("automatic"), v.literal("manual"))),
  },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    if (!app) {
      return;
    }
    const nextVersion = await ctx.db.get(args.versionId);
    if (!nextVersion || nextVersion.appId !== args.appId) {
      throw new Error("Version not found for app");
    }
    if (nextVersion.status === "failed") {
      throw new Error("Cannot activate a failed version");
    }

    const versions = await ctx.db
      .query("versions")
      .withIndex("by_appId_and_versionNumber", (q) => q.eq("appId", args.appId))
      .collect();
    const latestVersionNumber = highestVersionNumber(versions);
    const nextPreviewCursorVersionNumber =
      args.mode === "manual"
        ? latestVersionNumber
        : Math.max(app.previewCursorVersionNumber ?? 0, nextVersion.versionNumber);
    const now = Date.now();

    const run = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_versionId", (q) => q.eq("versionId", args.versionId))
      .first();

    if (app.activeVersionId && app.activeVersionId !== args.versionId) {
      await ctx.db.patch(app.activeVersionId, { status: "ready" });
    }

    await ctx.db.patch(args.versionId, {
      status: "active",
      runtimeHealth: "healthy",
    });

    await ctx.db.patch(app._id, {
      activeVersionId: args.versionId,
      previewCursorVersionNumber: nextPreviewCursorVersionNumber,
      currentStateJson: nextVersion.stateJson,
      lastRuntimeError: null,
      lastBuildError: null,
      updatedAt: now,
    });

    if (run) {
      await upsertPipelineStage(ctx, {
        runId: run._id,
        appId: args.appId,
        key: "activate",
        status: "completed",
        endedAt: now,
      });
      await ctx.db.patch(run._id, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });
    }
  },
});

export const deleteVersion = mutation({
  args: {
    appId: v.string(),
    versionId: v.id("versions"),
  },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    if (!app) {
      return { deleted: false };
    }

    const version = await ctx.db.get(args.versionId);
    if (!version || version.appId !== args.appId) {
      throw new Error("Version not found for app");
    }
    if (app.activeVersionId === args.versionId || version.status === "active") {
      throw new Error("Cannot delete the active version");
    }

    const linkedRuns = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_versionId", (q) => q.eq("versionId", args.versionId))
      .collect();
    if (linkedRuns.some((run) => run.status === "pending" || run.status === "running")) {
      throw new Error("Cannot delete a version while its pipeline run is still active");
    }

    const now = Date.now();
    const allVersions = await ctx.db
      .query("versions")
      .withIndex("by_appId_and_versionNumber", (q) => q.eq("appId", args.appId))
      .collect();
    const remainingVersions = allVersions.filter((candidate) => candidate._id !== args.versionId);
    const highestRemainingVersionNumber = highestVersionNumber(remainingVersions);
    const activeVersion = app.activeVersionId ? await ctx.db.get(app.activeVersionId) : null;
    const previewCursorBase =
      app.previewCursorVersionNumber ??
      activeVersion?.versionNumber ??
      highestRemainingVersionNumber;
    const nextPreviewCursorVersionNumber = Math.max(
      0,
      Math.min(previewCursorBase, highestRemainingVersionNumber),
    );

    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_appId_and_submittedAt", (q) => q.eq("appId", args.appId))
      .collect();
    for (const job of jobs) {
      const nextJobDoc = buildJobReplacementDoc(job);
      let changed = false;

      if (job.baseVersionId === args.versionId) {
        delete nextJobDoc["baseVersionId"];
        changed = true;
      }
      if (job.resultVersionId === args.versionId) {
        delete nextJobDoc["resultVersionId"];
        changed = true;
      }

      if (changed) {
        await ctx.db.replace(job._id, nextJobDoc);
      }
    }

    for (const run of linkedRuns) {
      const nextRunDoc = buildPipelineRunReplacementDoc(run, run.appId, now);
      delete nextRunDoc["versionId"];
      await ctx.db.replace(run._id, nextRunDoc);
    }

    const runtimeErrors = await ctx.db
      .query("runtimeErrors")
      .withIndex("by_appId_and_createdAt", (q) => q.eq("appId", args.appId))
      .collect();
    for (const runtimeError of runtimeErrors) {
      if (runtimeError.versionId !== args.versionId) {
        continue;
      }
      const nextRuntimeErrorDoc = buildRuntimeErrorReplacementDoc(runtimeError);
      delete nextRuntimeErrorDoc["versionId"];
      await ctx.db.replace(runtimeError._id, nextRuntimeErrorDoc);
    }

    await ctx.db.patch(app._id, {
      previewCursorVersionNumber: nextPreviewCursorVersionNumber,
      updatedAt: now,
    });

    await ctx.db.delete(args.versionId);

    return {
      deleted: true,
      versionNumber: version.versionNumber,
    };
  },
});

export const reportRuntimeError = mutation({
  args: {
    appId: v.string(),
    versionId: v.optional(v.id("versions")),
    message: v.string(),
    stack: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    if (!app) {
      return;
    }
    await ctx.db.insert("runtimeErrors", {
      appId: args.appId,
      versionId: args.versionId,
      message: args.message,
      stack: args.stack,
      createdAt: Date.now(),
    });

    await ctx.db.patch(app._id, {
      lastRuntimeError: args.message,
      updatedAt: Date.now(),
    });

    if (args.versionId) {
      const version = await ctx.db.get(args.versionId);
      if (version && version.status === "ready") {
        await ctx.db.patch(args.versionId, {
          status: "failed",
          runtimeHealth: "failed",
        });
      }

      const run = await ctx.db
        .query("pipelineRuns")
        .withIndex("by_versionId", (q) => q.eq("versionId", args.versionId))
        .first();
      if (run) {
        const now = Date.now();
        await upsertPipelineStage(ctx, {
          runId: run._id,
          appId: args.appId,
          key: "preview",
          status: "failed",
          detail: args.message,
          endedAt: now,
        });
        await ctx.db.patch(run._id, {
          status: "failed",
          failedAt: now,
          updatedAt: now,
        });
      }
    }
  },
});

export const clearRuntimeError = mutation({
  args: {
    appId: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    if (!app) {
      return;
    }
    await ctx.db.patch(app._id, {
      lastRuntimeError: null,
      updatedAt: Date.now(),
    });
  },
});

export const listAppFiles = query({
  args: { appId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("appFiles")
      .withIndex("by_appId", (q) => q.eq("appId", args.appId))
      .collect();
  },
});

export const listApps = query({
  args: {},
  handler: async (ctx) => {
    const apps = await ctx.db.query("apps").collect();
    const appsWithVersions = await Promise.all(
      apps.map(async (app: any) => {
        const activeVersion = app.activeVersionId
          ? await ctx.db.get(app.activeVersionId)
          : null;
        const boxes = await serializeBoxesWithProfiles(
          ctx,
          await getBoxesByAppId(ctx, app.appId),
        );
        const primaryBox = boxes[0] ?? null;

        return {
          appId: app.appId,
          slug: app.slug ?? app.appId,
          name: app.name,
          box: primaryBox,
          boxes,
          primaryBox,
          boxCount: boxes.length,
          templateSourceStatus: app.templateSourceStatus ?? "unknown",
          templateSourcePath: app.templateSourcePath ?? null,
          templateSourceMessage: app.templateSourceMessage ?? null,
          templateSourceCheckedAt: app.templateSourceCheckedAt ?? null,
          updatedAt: app.updatedAt,
          lastBuildError: app.lastBuildError ?? null,
          lastRuntimeError: app.lastRuntimeError ?? null,
          activeVersion: activeVersion
            ? {
                _id: activeVersion._id,
                versionNumber: activeVersion.versionNumber,
                status: activeVersion.status,
                runtimeHealth: activeVersion.runtimeHealth,
                createdAt: activeVersion.createdAt,
              }
            : null,
        };
      }),
    );

    return appsWithVersions.sort((left, right) => {
      const nameOrder = left.name.localeCompare(right.name);
      if (nameOrder !== 0) {
        return nameOrder;
      }
      const slugOrder = (left.slug ?? left.appId).localeCompare(right.slug ?? right.appId);
      if (slugOrder !== 0) {
        return slugOrder;
      }
      return left.appId.localeCompare(right.appId);
    });
  },
});

export const listBoxes = query({
  args: {},
  handler: async (ctx) => {
    const boxes = await ctx.db.query("boxes").collect();
    const engineProfiles = await ctx.db.query("engineProfiles").collect();
    const providerProfiles = await ctx.db.query("providerProfiles").collect();
    const engineProfilesById = new Map(
      engineProfiles.map((profile: any) => [profile.engineProfileId, profile]),
    );
    const providerProfilesById = new Map(
      providerProfiles.map((profile: any) => [profile.providerProfileId, profile]),
    );
    return boxes
      .map((box: any) =>
        serializeBox(box, {
          engineProfile:
            box?.engineProfileId ? engineProfilesById.get(box.engineProfileId) ?? null : null,
          providerProfile:
            box?.providerProfileId ? providerProfilesById.get(box.providerProfileId) ?? null : null,
        }),
      )
      .filter((box): box is NonNullable<ReturnType<typeof serializeBox>> => Boolean(box))
      .sort((left, right) => left.boxId.localeCompare(right.boxId));
  },
});

export const listEngineProfiles = query({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query("engineProfiles").collect();
    return profiles
      .map((profile: any) => serializeEngineProfile(profile))
      .filter(
        (
          profile,
        ): profile is NonNullable<ReturnType<typeof serializeEngineProfile>> => Boolean(profile),
      )
      .sort((left, right) => left.engineProfileId.localeCompare(right.engineProfileId));
  },
});

export const listProviderProfiles = query({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query("providerProfiles").collect();
    return profiles
      .map((profile: any) => serializeProviderProfile(profile))
      .filter(
        (
          profile,
        ): profile is NonNullable<ReturnType<typeof serializeProviderProfile>> => Boolean(profile),
      )
      .sort((left, right) => left.providerProfileId.localeCompare(right.providerProfileId));
  },
});

export const deleteApp = mutation({
  args: { appId: v.string() },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    if (!app) {
      return { deleted: false, purgeQueued: Boolean(await getArtifactPurgeTaskByAppId(ctx, args.appId)) };
    }

    const now = Date.now();
    const existingPurgeTask = await getArtifactPurgeTaskByAppId(ctx, args.appId);
    if (existingPurgeTask) {
      await ctx.db.patch(existingPurgeTask._id, {
        updatedAt: now,
        lastError: null,
      });
    } else {
      await ctx.db.insert("artifactPurgeTasks", {
        appId: args.appId,
        requestedAt: now,
        updatedAt: now,
        lastError: null,
      });
    }

    const matchingSelections = await ctx.db
      .query("shellSelections")
      .withIndex("by_selectedAppId", (q) => q.eq("selectedAppId", args.appId))
      .collect();
    for (const selection of matchingSelections) {
      await ctx.db.patch(selection._id, {
        selectedAppId: null,
        updatedAt: now,
      });
    }

    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_appId_and_submittedAt", (q) => q.eq("appId", args.appId))
      .collect();
    for (const job of jobs) {
      if (job.status === "pending") {
        await ctx.db.patch(job._id, {
          status: "failed",
          buildError: "App deleted before processing started.",
        });
      }
      if (job.pipelineRunId) {
        const run = await ctx.db.get(job.pipelineRunId);
        if (run && run.status === "pending") {
          await ctx.db.patch(job.pipelineRunId, {
            status: "failed",
            failedAt: now,
            updatedAt: now,
          });
        }
      }
    }

    await ctx.db.delete(app._id);

    return { deleted: true, purgeQueued: true };
  },
});

export const inspectSeedAppState = query({
  args: { appId: v.string() },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    const purgeTask = await getArtifactPurgeTaskByAppId(ctx, args.appId);
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_appId_and_submittedAt", (q) => q.eq("appId", args.appId))
      .collect();
    const pipelineRuns = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_appId_and_submittedAt", (q) => q.eq("appId", args.appId))
      .collect();
    const pipelineStages = await ctx.db
      .query("pipelineStages")
      .withIndex("by_appId_and_startedAt", (q) => q.eq("appId", args.appId))
      .collect();
    const runtimeErrors = await ctx.db
      .query("runtimeErrors")
      .withIndex("by_appId_and_createdAt", (q) => q.eq("appId", args.appId))
      .collect();
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_appId_and_versionNumber", (q) => q.eq("appId", args.appId))
      .collect();
    const appFiles = await ctx.db
      .query("appFiles")
      .withIndex("by_appId", (q) => q.eq("appId", args.appId))
      .collect();

    return {
      existingApp: Boolean(app),
      purgeQueued: Boolean(purgeTask),
      counts: {
        jobs: jobs.length,
        activeJobs: jobs.filter((job) => job.status === "pending" || job.status === "running").length,
        pipelineRuns: pipelineRuns.length,
        pipelineStages: pipelineStages.length,
        runtimeErrors: runtimeErrors.length,
        versions: versions.length,
        appFiles: appFiles.length,
      },
    };
  },
});

export const resetSeedAppState = mutation({
  args: { appId: v.string() },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    if (app) {
      await ctx.db.delete(app._id);
    }

    const matchingSelections = await ctx.db
      .query("shellSelections")
      .withIndex("by_selectedAppId", (q) => q.eq("selectedAppId", args.appId))
      .collect();
    for (const selection of matchingSelections) {
      await ctx.db.patch(selection._id, {
        selectedAppId: null,
        updatedAt: Date.now(),
      });
    }

    await deleteAppDataRecords(ctx, args.appId);

    const purgeTask = await getArtifactPurgeTaskByAppId(ctx, args.appId);
    if (purgeTask) {
      await ctx.db.delete(purgeTask._id);
    }
  },
});

export const getNextArtifactPurgeTask = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("artifactPurgeTasks")
      .withIndex("by_requestedAt")
      .order("asc")
      .first();
  },
});

export const hasActiveJobsForApp = query({
  args: { appId: v.string() },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_appId_and_submittedAt", (q) => q.eq("appId", args.appId))
      .collect();

    return jobs.some((job) => job.status === "pending" || job.status === "running");
  },
});

export const completeArtifactPurgeTask = mutation({
  args: { taskId: v.id("artifactPurgeTasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      return;
    }
    await ctx.db.delete(args.taskId);
  },
});

export const recordArtifactPurgeFailure = mutation({
  args: {
    taskId: v.id("artifactPurgeTasks"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      return;
    }
    await ctx.db.patch(args.taskId, {
      updatedAt: Date.now(),
      lastError: args.error,
    });
  },
});

export const finalizeDeletedAppData = mutation({
  args: { appId: v.string() },
  handler: async (ctx, args) => {
    await deleteAppDataRecords(ctx, args.appId);
  },
});

export const deletePipelineRun = mutation({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      return { deleted: false };
    }

    const stages = await ctx.db
      .query("pipelineStages")
      .withIndex("by_runId_and_sortOrder", (q) => q.eq("runId", args.runId))
      .collect();
    for (const stage of stages) {
      await ctx.db.delete(stage._id);
    }

    const job = await ctx.db.get(run.jobId);
    if (job) {
      await ctx.db.delete(job._id);
    }

    await ctx.db.delete(args.runId);

    return { deleted: true };
  },
});

export const getPendingJob = query({
  args: { appId: v.string() },
  handler: async (ctx, args) => {
    const pendingJobs = await ctx.db
      .query("jobs")
      .withIndex("by_appId_and_submittedAt", (q) => q.eq("appId", args.appId))
      .collect();

    return pendingJobs
      .filter((job) => job.status === "pending")
      .sort((left, right) => left.submittedAt - right.submittedAt)[0] ?? null;
  },
});

export const getNextPendingJob = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_status_and_submittedAt", (q) => q.eq("status", "pending"))
      .order("asc")
      .first();
  },
});

export const listStaleRunningJobs = query({
  args: {
    staleBefore: v.number(),
  },
  handler: async (ctx, args) => {
    const runningJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();

    return runningJobs.filter(
      (job) => typeof job.claimedAt === "number" && job.claimedAt < args.staleBefore,
    );
  },
});

export const markJobRunning = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "pending") {
      return null;
    }
    const claimedAt = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "running",
      claimedAt,
    });
    if (job.pipelineRunId) {
      const run = await ctx.db.get(job.pipelineRunId);
      if (run) {
        await ctx.db.patch(job.pipelineRunId, {
          status: "running",
          claimedAt,
          updatedAt: claimedAt,
        });
      }
      await upsertPipelineStage(ctx, {
        runId: job.pipelineRunId,
        appId: job.appId,
        key: "queued",
        status: "completed",
        endedAt: claimedAt,
      });
    }
    return { ...job, status: "running" as const };
  },
});

export const seedApp = mutation({
  args: {
    appId: v.string(),
    name: v.string(),
    slug: v.string(),
    files: v.array(
      v.object({
        path: v.string(),
        content: v.string(),
      }),
    ),
    manifestUrl: v.string(),
    buildLog: v.string(),
    stateJson: v.string(),
  },
  handler: async (ctx, args) => {
    const existingApp = await ctx.db
      .query("apps")
      .withIndex("by_appId", (q) => q.eq("appId", args.appId))
      .first();

    if (existingApp) {
      await ctx.db.patch(existingApp._id, {
        name: args.name,
        slug: args.slug,
        updatedAt: Date.now(),
      });
      return existingApp._id;
    }

    const versionId = await ctx.db.insert("versions", {
      appId: args.appId,
      versionNumber: 1,
      status: "active",
      manifestUrl: args.manifestUrl,
      buildLog: args.buildLog,
      runtimeHealth: "healthy",
      stateJson: args.stateJson,
      createdAt: Date.now(),
    });

    const appId = await ctx.db.insert("apps", {
      appId: args.appId,
      slug: args.slug,
      name: args.name,
      codexThreadId: null,
      openClawSessionId: null,
      templateSourceStatus: "unknown",
      templateSourcePath: null,
      templateSourceMessage: null,
      templateSourceCheckedAt: null,
      activeVersionId: versionId,
      previewCursorVersionNumber: 1,
      currentStateJson: args.stateJson,
      lastBuildError: null,
      lastRuntimeError: null,
      updatedAt: Date.now(),
    });

    for (const file of args.files) {
      await ctx.db.insert("appFiles", {
        appId: args.appId,
        path: file.path,
        content: file.content,
        updatedAt: Date.now(),
      });
    }

    return appId;
  },
});

export const getAppConfig = query({
  args: {
    appId: v.string(),
    boxId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_appId", (q) => q.eq("appId", args.appId))
      .first();

    if (!app) {
      return null;
    }

    const serializedBoxes = await serializeBoxesWithProfiles(
      ctx,
      await getBoxesByAppId(ctx, args.appId),
    );
    const primaryBox = serializedBoxes[0] ?? null;
    const box = selectBoxFromSerializedList(serializedBoxes, args.boxId ?? null);
    const engineProfile = box?.engineProfile ?? null;
    const providerProfile = box?.providerProfile ?? null;

    return {
      appId: app.appId,
      slug: app.slug ?? app.appId,
      name: app.name,
      codexThreadId: app.codexThreadId ?? null,
      openClawSessionId: app.openClawSessionId ?? null,
      box,
      boxes: serializedBoxes,
      primaryBox,
      engineProfile: serializeEngineProfile(engineProfile),
      providerProfile: serializeProviderProfile(providerProfile),
    };
  },
});

export const updateAppMetadata = mutation({
  args: {
    appId: v.string(),
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await getAppByIdOrThrow(ctx, args.appId);
    const nextName = args.name.trim();
    const nextSlug = args.slug.trim();

    if (!nextName) {
      throw new Error("App name is required.");
    }
    if (!nextSlug) {
      throw new Error("App slug is required.");
    }

    const apps = await ctx.db.query("apps").collect();
    const conflictingApp = apps.find(
      (candidate: any) =>
        candidate._id !== app._id && (candidate.slug ?? candidate.appId) === nextSlug,
    );
    if (conflictingApp) {
      throw new Error(`App slug '${nextSlug}' is already in use.`);
    }

    await ctx.db.patch(app._id, {
      name: nextName,
      slug: nextSlug,
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});

export const listVersions = query({
  args: { appId: v.string() },
  handler: async (ctx, args) => {
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_appId_and_versionNumber", (q) => q.eq("appId", args.appId))
      .collect();

    return versions.sort((left, right) => right.versionNumber - left.versionNumber);
  },
});

export const setAppCodexThread = mutation({
  args: {
    appId: v.string(),
    threadId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    if (!app) {
      return;
    }
    await ctx.db.patch(app._id, {
      codexThreadId: args.threadId,
    });
  },
});

export const setAppOpenClawSession = mutation({
  args: {
    appId: v.string(),
    sessionId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    if (!app) {
      return;
    }
    await ctx.db.patch(app._id, {
      openClawSessionId: args.sessionId,
    });

    const box = await getBoxByAppId(ctx, args.appId);
    if (box) {
      await ctx.db.patch(box._id, {
        sessionId: args.sessionId,
        updatedAt: Date.now(),
      });
    }
  },
});

export const resetBoxSession = mutation({
  args: {
    appId: v.string(),
    boxId: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    if (!app) {
      return { reset: false };
    }

    const box = await getBoxByBoxId(ctx, args.boxId);
    if (!box || box.appId !== args.appId) {
      throw new Error(`Box '${args.boxId}' does not belong to app '${args.appId}'.`);
    }

    const now = Date.now();
    const currentGeneration =
      typeof box.sessionKeyGeneration === "number" && Number.isFinite(box.sessionKeyGeneration)
        ? Math.max(0, Math.trunc(box.sessionKeyGeneration))
        : 0;
    await ctx.db.patch(box._id, {
      sessionId: null,
      sessionKeyGeneration: currentGeneration + 1,
      updatedAt: now,
    });

    const primaryBox = await getBoxByAppId(ctx, args.appId);
    if (primaryBox && primaryBox.boxId === box.boxId) {
      await ctx.db.patch(app._id, {
        openClawSessionId: null,
        updatedAt: now,
      });
    }

    return { reset: true };
  },
});

export const upsertEngineProfile = mutation({
  args: {
    engineProfileId: v.string(),
    engine: v.string(),
    name: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
    status: engineProfileStatus,
    isDefault: v.boolean(),
    config: engineProfileConfig,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await getEngineProfileById(ctx, args.engineProfileId);
    const patch = {
      engineProfileId: args.engineProfileId,
      engine: args.engine,
      name: args.name,
      description: args.description ?? null,
      status: args.status,
      isDefault: args.isDefault,
      config: args.config,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("engineProfiles", {
      ...patch,
      createdAt: now,
    });
  },
});

export const upsertProviderProfile = mutation({
  args: {
    providerProfileId: v.string(),
    engineProfileId: v.optional(v.union(v.string(), v.null())),
    provider: v.string(),
    name: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
    model: v.union(v.string(), v.null()),
    status: providerProfileStatus,
    isDefault: v.boolean(),
    config: providerProfileConfig,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await getProviderProfileById(ctx, args.providerProfileId);
    const patch = {
      providerProfileId: args.providerProfileId,
      engineProfileId: args.engineProfileId ?? null,
      provider: args.provider,
      name: args.name,
      description: args.description ?? null,
      model: args.model,
      status: args.status,
      isDefault: args.isDefault,
      config: args.config,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("providerProfiles", {
      ...patch,
      createdAt: now,
    });
  },
});

export const upsertBox = mutation({
  args: {
    boxId: v.string(),
    subjectId: v.string(),
    subjectKind: v.string(),
    appId: v.optional(v.union(v.string(), v.null())),
    engine: v.string(),
    engineProfileId: v.optional(v.union(v.string(), v.null())),
    providerProfileId: v.optional(v.union(v.string(), v.null())),
    agentId: v.optional(v.union(v.string(), v.null())),
    targetPath: v.optional(v.union(v.string(), v.null())),
    workspacePath: v.optional(v.union(v.string(), v.null())),
    sessionId: v.optional(v.union(v.string(), v.null())),
    sessionKeyGeneration: v.optional(v.number()),
    provider: v.optional(v.union(v.string(), v.null())),
    model: v.union(v.string(), v.null()),
    status: boxStatus,
    policy: boxPolicy,
    lastRunAt: v.optional(v.union(v.number(), v.null())),
    lastError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const normalizedAppId = args.appId ?? null;
    if (normalizedAppId) {
      const app = await getAppById(ctx, normalizedAppId);
      if (!app) {
        throw new Error(`Cannot upsert box for unknown app '${normalizedAppId}'.`);
      }
    }
    const normalizedEngineProfileId = args.engineProfileId ?? null;
    const normalizedProviderProfileId = args.providerProfileId ?? null;

    if (normalizedEngineProfileId) {
      const engineProfile = await getEngineProfileById(ctx, normalizedEngineProfileId);
      if (!engineProfile) {
        throw new Error(`Cannot upsert box with unknown engine profile '${normalizedEngineProfileId}'.`);
      }
    }

    if (normalizedProviderProfileId) {
      const providerProfile = await getProviderProfileById(ctx, normalizedProviderProfileId);
      if (!providerProfile) {
        throw new Error(
          `Cannot upsert box with unknown provider profile '${normalizedProviderProfileId}'.`,
        );
      }
    }

    const now = Date.now();
    const existing = await getBoxByBoxId(ctx, args.boxId);
    const targetPath =
      args.targetPath ??
      args.workspacePath ??
      null;
    const patch: Record<string, unknown> = {
      boxId: args.boxId,
      subjectId: args.subjectId,
      subjectKind: args.subjectKind,
      appId: normalizedAppId,
      engine: args.engine,
      engineProfileId: normalizedEngineProfileId,
      providerProfileId: normalizedProviderProfileId,
      agentId: args.agentId ?? null,
      targetPath,
      workspacePath: args.workspacePath ?? targetPath,
      provider: args.provider ?? null,
      model: args.model,
      status: args.status,
      policy: args.policy,
      updatedAt: now,
    };

    if (Object.prototype.hasOwnProperty.call(args, "sessionId")) {
      patch.sessionId = args.sessionId ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(args, "sessionKeyGeneration")) {
      patch.sessionKeyGeneration =
        typeof args.sessionKeyGeneration === "number" && Number.isFinite(args.sessionKeyGeneration)
          ? Math.max(0, Math.trunc(args.sessionKeyGeneration))
          : 0;
    }
    if (Object.prototype.hasOwnProperty.call(args, "lastRunAt")) {
      patch.lastRunAt = args.lastRunAt ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(args, "lastError")) {
      patch.lastError = args.lastError ?? null;
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("boxes", {
      boxId: args.boxId,
      subjectId: args.subjectId,
      subjectKind: args.subjectKind,
      appId: normalizedAppId,
      engine: args.engine,
      engineProfileId: normalizedEngineProfileId,
      providerProfileId: normalizedProviderProfileId,
      agentId: args.agentId ?? null,
      targetPath,
      workspacePath: args.workspacePath ?? targetPath,
      sessionId: Object.prototype.hasOwnProperty.call(args, "sessionId")
        ? (args.sessionId ?? null)
        : null,
      sessionKeyGeneration: Object.prototype.hasOwnProperty.call(args, "sessionKeyGeneration")
        ? (
            typeof args.sessionKeyGeneration === "number" && Number.isFinite(args.sessionKeyGeneration)
              ? Math.max(0, Math.trunc(args.sessionKeyGeneration))
              : 0
          )
        : 0,
      provider: args.provider ?? null,
      model: args.model,
      status: args.status,
      policy: args.policy,
      lastRunAt: Object.prototype.hasOwnProperty.call(args, "lastRunAt")
        ? (args.lastRunAt ?? null)
        : null,
      lastError: Object.prototype.hasOwnProperty.call(args, "lastError")
        ? (args.lastError ?? null)
        : null,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateBoxPolicy = mutation({
  args: {
    boxId: v.string(),
    role: v.optional(v.union(v.string(), v.null())),
    instructions: v.optional(v.union(v.string(), v.null())),
    readOnly: v.optional(v.boolean()),
    proposalOnly: v.optional(v.boolean()),
    canPromote: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const box = await getBoxByBoxId(ctx, args.boxId);
    if (!box) {
      throw new Error(`Box '${args.boxId}' does not exist.`);
    }

    const policy = {
      ...(box.policy ?? {}),
    } as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(args, "role")) {
      policy.role = args.role ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(args, "instructions")) {
      policy.instructions = args.instructions ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(args, "readOnly")) {
      policy.readOnly = args.readOnly === true;
    }
    if (Object.prototype.hasOwnProperty.call(args, "proposalOnly")) {
      policy.proposalOnly = args.proposalOnly === true;
    }
    if (Object.prototype.hasOwnProperty.call(args, "canPromote")) {
      policy.canPromote = args.canPromote === true;
    }

    await ctx.db.patch(box._id, {
      policy,
      updatedAt: Date.now(),
    });
  },
});

function normalizeBoxScope(scope: string) {
  const normalized = scope
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    throw new Error("Box scope must contain at least one letter or number.");
  }

  return normalized;
}

function buildScopedBoxId(engine: string, appId: string, scope: string) {
  return `${engine}:${appId}:${scope}`;
}

export const createBox = mutation({
  args: {
    appId: v.string(),
    scope: v.string(),
    sourceBoxId: v.optional(v.union(v.string(), v.null())),
    role: v.optional(v.union(v.string(), v.null())),
    instructions: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const app = await getAppByIdOrThrow(ctx, args.appId);
    const scope = normalizeBoxScope(args.scope);
    const sourceBox =
      (args.sourceBoxId ? await getBoxByBoxId(ctx, args.sourceBoxId) : null) ??
      (await getBoxByAppId(ctx, args.appId));

    if (sourceBox && sourceBox.appId !== args.appId) {
      throw new Error(`Source box '${args.sourceBoxId}' does not belong to app '${args.appId}'.`);
    }

    const engine = sourceBox?.engine ?? "openclaw";
    const boxId = buildScopedBoxId(engine, args.appId, scope);
    const existing = await getBoxByBoxId(ctx, boxId);
    if (existing) {
      throw new Error(`Box '${boxId}' already exists.`);
    }

    const now = Date.now();
    const policy = {
      ...(sourceBox?.policy ?? {}),
      role:
        Object.prototype.hasOwnProperty.call(args, "role")
          ? (args.role ?? scope)
          : (sourceBox?.policy?.role ?? scope),
      instructions:
        Object.prototype.hasOwnProperty.call(args, "instructions")
          ? (args.instructions ?? null)
          : (sourceBox?.policy?.instructions ?? null),
    };

    return await ctx.db.insert("boxes", {
      boxId,
      subjectId: args.appId,
      subjectKind: sourceBox?.subjectKind ?? "app",
      appId: app.appId,
      engine,
      engineProfileId: sourceBox?.engineProfileId ?? null,
      providerProfileId: sourceBox?.providerProfileId ?? null,
      agentId: sourceBox?.agentId ?? null,
      targetPath: sourceBox?.targetPath ?? sourceBox?.workspacePath ?? null,
      workspacePath: sourceBox?.workspacePath ?? sourceBox?.targetPath ?? null,
      sessionId: null,
      sessionKeyGeneration: 0,
      provider: sourceBox?.provider ?? null,
      model: sourceBox?.model ?? null,
      status: "ready",
      policy,
      lastRunAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteBox = mutation({
  args: {
    boxId: v.string(),
  },
  handler: async (ctx, args) => {
    const box = await getBoxByBoxId(ctx, args.boxId);
    if (!box) {
      return;
    }
    if (!box.appId) {
      throw new Error(`Box '${args.boxId}' is not attached to an app.`);
    }

    const boxes = await getBoxesByAppId(ctx, box.appId);
    if (boxes.length <= 1) {
      throw new Error("Cannot delete the last box for an app.");
    }

    const primaryBox = boxes[0] ?? null;
    if (primaryBox?._id === box._id) {
      throw new Error("Cannot delete the primary box. Create another box and promote that behavior instead.");
    }

    await ctx.db.delete(box._id);
  },
});

export const setAppTemplateSourceStatus = mutation({
  args: {
    appId: v.string(),
    status: templateSourceStatus,
    path: v.union(v.string(), v.null()),
    message: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const app = await getAppById(ctx, args.appId);
    if (!app) {
      return;
    }
    await ctx.db.patch(app._id, {
      templateSourceStatus: args.status,
      templateSourcePath: args.path,
      templateSourceMessage: args.message,
      templateSourceCheckedAt: Date.now(),
    });
  },
});

export const inspectLegacyAppIdMigration = query({
  args: {},
  handler: async (ctx) => {
    const plan = await buildLegacyAppIdMigrationPlan(ctx);
    const cleanup = await collectLegacyTemplateFieldCleanupSummary(ctx);
    return {
      ...plan,
      cleanup,
    };
  },
});

export const migrateLegacyAppIds = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const plan = await buildLegacyAppIdMigrationPlan(ctx);
    const cleanup = await collectLegacyTemplateFieldCleanupSummary(ctx);
    const hasChanges =
      plan.migrations.length > 0 ||
      cleanup.appDocs > 0 ||
      cleanup.pipelineRuns > 0;

    if (dryRun || !hasChanges) {
      return {
        dryRun,
        migratedCount: 0,
        cleanup,
        ...plan,
      };
    }

    if (plan.conflicts.length > 0) {
      throw new Error(
        `Legacy app-id migration has conflicts: ${plan.conflicts
          .map((conflict) => `${conflict.fromAppId} -> ${conflict.toAppId} (${conflict.reason})`)
          .join("; ")}`,
      );
    }

    for (const migration of plan.migrations) {
      await applyLegacyAppIdMigration(ctx, migration);
    }
    await scrubLegacyTemplateIds(ctx);

    return {
      dryRun: false,
      migratedCount: plan.migrations.length,
      cleanup,
      ...plan,
    };
  },
});

export const getJob = query({
  args: {
    jobId: v.id("jobs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const recordReadyVersion = mutation({
  args: {
    appId: v.string(),
    jobId: v.id("jobs"),
    manifestUrl: v.string(),
    buildLog: v.string(),
    stateJson: v.string(),
    agentResult: v.optional(agentResult),
    files: v.array(
      v.object({
        path: v.string(),
        content: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return null;
    }
    const app = await getAppById(ctx, args.appId);
    if (!app) {
      await ctx.db.patch(args.jobId, {
        status: "failed",
        buildError: "App deleted during processing.",
      });
      if (job.pipelineRunId) {
        const run = await ctx.db.get(job.pipelineRunId);
        if (run) {
          await ctx.db.patch(job.pipelineRunId, {
            status: "failed",
            failedAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }
      return null;
    }
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_appId_and_versionNumber", (q) => q.eq("appId", args.appId))
      .collect();

    const versionNumber =
      versions.reduce((max, version) => Math.max(max, version.versionNumber), 0) + 1;

    const versionId = await ctx.db.insert("versions", {
      appId: args.appId,
      versionNumber,
      status: "ready",
      manifestUrl: args.manifestUrl,
      buildLog: args.buildLog,
      runtimeHealth: "pending",
      agentResult: args.agentResult,
      stateJson: args.stateJson,
      createdAt: Date.now(),
    });

    const existingFiles = await ctx.db
      .query("appFiles")
      .withIndex("by_appId", (q) => q.eq("appId", args.appId))
      .collect();

    const existingByPath = new Map(existingFiles.map((file) => [file.path, file]));
    const nextPaths = new Set(args.files.map((file) => file.path));
    for (const file of args.files) {
      const existing = existingByPath.get(file.path);
      if (existing) {
        await ctx.db.patch(existing._id, {
          content: file.content,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("appFiles", {
          appId: args.appId,
          path: file.path,
          content: file.content,
          updatedAt: Date.now(),
        });
      }
    }

    for (const existing of existingFiles) {
      if (!nextPaths.has(existing.path)) {
        await ctx.db.delete(existing._id);
      }
    }

    await ctx.db.patch(args.jobId, {
      status: "completed",
      agentResult: args.agentResult,
      resultVersionId: versionId,
    });
    if (job?.pipelineRunId) {
      const run = await ctx.db.get(job.pipelineRunId);
      if (run) {
        await ctx.db.patch(job.pipelineRunId, {
          versionId,
          updatedAt: Date.now(),
        });
      }
    }

    await ctx.db.patch(app._id, {
      lastBuildError: null,
      updatedAt: Date.now(),
    });

    return versionId;
  },
});

export const recordBuildFailure = mutation({
  args: {
    appId: v.string(),
    jobId: v.id("jobs"),
    buildLog: v.string(),
    failureStage: v.optional(v.string()),
    failureClassification: v.optional(failureClassification),
    agentResult: v.optional(agentResult),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job) {
      await ctx.db.patch(args.jobId, {
        status: "failed",
        buildError: args.buildLog,
        failureStage: args.failureStage,
        failureClassification: args.failureClassification,
        agentResult: args.agentResult,
      });
    }
    const app = await getAppById(ctx, args.appId);
    if (app) {
      await ctx.db.patch(app._id, {
        lastBuildError: args.buildLog,
        updatedAt: Date.now(),
      });
    }
    if (job?.pipelineRunId) {
      const run = await ctx.db.get(job.pipelineRunId);
      if (run) {
        await ctx.db.patch(job.pipelineRunId, {
          status: "failed",
          failedAt: Date.now(),
          failureStage: args.failureStage,
          failureClassification: args.failureClassification,
          updatedAt: Date.now(),
        });
      }
    }
  },
});

export const recordPipelineStage = mutation({
  args: {
    runId: v.id("pipelineRuns"),
    appId: v.string(),
    key: v.string(),
    status: pipelineStageStatus,
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await upsertPipelineStage(ctx, args);
  },
});

export const recordPipelineStageForVersion = mutation({
  args: {
    appId: v.string(),
    versionId: v.id("versions"),
    key: v.string(),
    status: pipelineStageStatus,
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_versionId", (q) => q.eq("versionId", args.versionId))
      .first();
    if (!run) {
      return;
    }
    await upsertPipelineStage(ctx, {
      runId: run._id,
      appId: args.appId,
      key: args.key,
      status: args.status,
      detail: args.detail,
    });
  },
});
