import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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

const templateSourceStatus = v.union(
  v.literal("unknown"),
  v.literal("available"),
  v.literal("missing"),
);

export default defineSchema({
  apps: defineTable({
    appId: v.string(),
    name: v.string(),
    templateId: v.optional(v.string()),
    codexThreadId: v.optional(v.union(v.string(), v.null())),
    openClawSessionId: v.optional(v.union(v.string(), v.null())),
    templateSourceStatus: v.optional(templateSourceStatus),
    templateSourcePath: v.optional(v.union(v.string(), v.null())),
    templateSourceMessage: v.optional(v.union(v.string(), v.null())),
    templateSourceCheckedAt: v.optional(v.union(v.number(), v.null())),
    activeVersionId: v.optional(v.id("versions")),
    previewCursorVersionNumber: v.optional(v.number()),
    currentStateJson: v.union(v.string(), v.null()),
    lastBuildError: v.union(v.string(), v.null()),
    lastRuntimeError: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  }).index("by_appId", ["appId"]),
  shellSelections: defineTable({
    shellId: v.string(),
    selectedAppId: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_shellId", ["shellId"])
    .index("by_selectedAppId", ["selectedAppId"]),
  appFiles: defineTable({
    appId: v.string(),
    path: v.string(),
    content: v.string(),
    updatedAt: v.number(),
  })
    .index("by_appId", ["appId"])
    .index("by_appId_and_path", ["appId", "path"]),
  jobs: defineTable({
    appId: v.string(),
    prompt: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("failed"),
      v.literal("completed"),
    ),
    submittedAt: v.number(),
    claimedAt: v.optional(v.number()),
    baseVersionId: v.optional(v.id("versions")),
    buildError: v.optional(v.string()),
    agentResult: v.optional(agentResult),
    resultVersionId: v.optional(v.id("versions")),
    pipelineRunId: v.optional(v.id("pipelineRuns")),
  })
    .index("by_status", ["status"])
    .index("by_status_and_submittedAt", ["status", "submittedAt"])
    .index("by_appId_and_submittedAt", ["appId", "submittedAt"]),
  versions: defineTable({
    appId: v.string(),
    versionNumber: v.number(),
    status: v.union(v.literal("ready"), v.literal("active"), v.literal("failed")),
    manifestUrl: v.string(),
    buildLog: v.string(),
    runtimeHealth: v.union(
      v.literal("pending"),
      v.literal("healthy"),
      v.literal("failed"),
    ),
    agentResult: v.optional(agentResult),
    stateJson: v.string(),
    createdAt: v.number(),
  })
    .index("by_appId_and_versionNumber", ["appId", "versionNumber"])
    .index("by_appId_and_status", ["appId", "status"]),
  runtimeErrors: defineTable({
    appId: v.string(),
    versionId: v.optional(v.id("versions")),
    message: v.string(),
    stack: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_appId_and_createdAt", ["appId", "createdAt"]),
  pipelineRuns: defineTable({
    appId: v.string(),
    jobId: v.id("jobs"),
    prompt: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("failed"),
      v.literal("completed"),
    ),
    templateId: v.optional(v.string()),
    versionId: v.optional(v.id("versions")),
    submittedAt: v.number(),
    claimedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_appId_and_submittedAt", ["appId", "submittedAt"])
    .index("by_jobId", ["jobId"])
    .index("by_versionId", ["versionId"]),
  pipelineStages: defineTable({
    appId: v.string(),
    runId: v.id("pipelineRuns"),
    key: v.string(),
    label: v.string(),
    sortOrder: v.number(),
    status: pipelineStageStatus,
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    detail: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_runId_and_sortOrder", ["runId", "sortOrder"])
    .index("by_runId_and_key", ["runId", "key"])
    .index("by_appId_and_startedAt", ["appId", "startedAt"]),
  artifactPurgeTasks: defineTable({
    appId: v.string(),
    requestedAt: v.number(),
    updatedAt: v.number(),
    lastError: v.union(v.string(), v.null()),
  })
    .index("by_appId", ["appId"])
    .index("by_requestedAt", ["requestedAt"]),
});
