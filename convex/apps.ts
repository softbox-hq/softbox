import { v } from "convex/values";
import { mutation, query } from "./server";

const defaultShellId = "main";

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

const boxStatus = v.union(
  v.literal("unknown"),
  v.literal("ready"),
  v.literal("running"),
  v.literal("error"),
);

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

async function getBoxByAppId(ctx: any, appId: string) {
  return await ctx.db
    .query("boxes")
    .withIndex("by_appId", (q: any) => q.eq("appId", appId))
    .first();
}

async function getBoxByBoxId(ctx: any, boxId: string) {
  return await ctx.db
    .query("boxes")
    .withIndex("by_boxId", (q: any) => q.eq("boxId", boxId))
    .first();
}

function serializeBox(box: any) {
  if (!box) {
    return null;
  }

  return {
    boxId: box.boxId,
    subjectId: box.subjectId ?? box.appId,
    subjectKind: box.subjectKind ?? "app",
    appId: box.appId ?? null,
    engine: box.engine ?? box.provider ?? "openclaw",
    agentId: box.agentId ?? null,
    targetPath: box.targetPath ?? box.workspacePath ?? null,
    workspacePath: box.workspacePath ?? box.targetPath ?? null,
    sessionId: box.sessionId ?? null,
    provider: box.provider ?? null,
    model: box.model ?? null,
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

  return nextDoc;
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
  args: { appId: v.string() },
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
    const box = await getBoxByAppId(ctx, args.appId);

    return {
      appId: app.appId,
      name: app.name,
      box: serializeBox(box),
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
    const submittedAt = Date.now();
    await ctx.db.patch(app._id, {
      lastBuildError: null,
      updatedAt: submittedAt,
    });
    const jobId = await ctx.db.insert("jobs", {
      appId: args.appId,
      prompt: args.prompt,
      status: "pending",
      submittedAt,
      baseVersionId: app.activeVersionId,
    });
    const pipelineRunId = await ctx.db.insert("pipelineRuns", {
      appId: args.appId,
      jobId,
      prompt: args.prompt,
      status: "pending",
      submittedAt,
      updatedAt: submittedAt,
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
        const box = await getBoxByAppId(ctx, app.appId);

        return {
          appId: app.appId,
          name: app.name,
          box: serializeBox(box),
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

    return appsWithVersions.sort((left, right) => left.appId.localeCompare(right.appId));
  },
});

export const listBoxes = query({
  args: {},
  handler: async (ctx) => {
    const boxes = await ctx.db.query("boxes").collect();
    return boxes
      .map((box: any) => serializeBox(box))
      .filter((box): box is NonNullable<ReturnType<typeof serializeBox>> => Boolean(box))
      .sort((left, right) => left.boxId.localeCompare(right.boxId));
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
      const shellSelection = await getShellSelectionById(ctx, defaultShellId);
      if (!shellSelection) {
        await upsertShellSelection(ctx, {
          shellId: defaultShellId,
          selectedAppId: args.appId,
        });
      }
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

    const shellSelection = await getShellSelectionById(ctx, defaultShellId);
    if (!shellSelection) {
      await upsertShellSelection(ctx, {
        shellId: defaultShellId,
        selectedAppId: args.appId,
      });
    }

    return appId;
  },
});

export const getAppConfig = query({
  args: { appId: v.string() },
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_appId", (q) => q.eq("appId", args.appId))
      .first();

    if (!app) {
      return null;
    }

    return {
      appId: app.appId,
      name: app.name,
      codexThreadId: app.codexThreadId ?? null,
      openClawSessionId: app.openClawSessionId ?? null,
    };
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

export const upsertBox = mutation({
  args: {
    boxId: v.string(),
    subjectId: v.string(),
    subjectKind: v.string(),
    appId: v.optional(v.union(v.string(), v.null())),
    engine: v.string(),
    agentId: v.optional(v.union(v.string(), v.null())),
    targetPath: v.optional(v.union(v.string(), v.null())),
    workspacePath: v.optional(v.union(v.string(), v.null())),
    sessionId: v.optional(v.union(v.string(), v.null())),
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

    const now = Date.now();
    const existing =
      (await getBoxByBoxId(ctx, args.boxId)) ??
      (normalizedAppId ? await getBoxByAppId(ctx, normalizedAppId) : null);
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
      agentId: args.agentId ?? null,
      targetPath,
      workspacePath: args.workspacePath ?? targetPath,
      sessionId: Object.prototype.hasOwnProperty.call(args, "sessionId")
        ? (args.sessionId ?? null)
        : null,
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
    agentResult: v.optional(agentResult),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job) {
      await ctx.db.patch(args.jobId, {
        status: "failed",
        buildError: args.buildLog,
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
