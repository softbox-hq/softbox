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

export default defineSchema({
  engineProfiles: defineTable({
    engineProfileId: v.string(),
    engine: v.string(),
    name: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
    status: engineProfileStatus,
    isDefault: v.boolean(),
    config: engineProfileConfig,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_engineProfileId", ["engineProfileId"])
    .index("by_engine", ["engine"])
    .index("by_engine_and_isDefault", ["engine", "isDefault"]),
  providerProfiles: defineTable({
    providerProfileId: v.string(),
    engineProfileId: v.union(v.string(), v.null()),
    provider: v.string(),
    name: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
    model: v.union(v.string(), v.null()),
    status: providerProfileStatus,
    isDefault: v.boolean(),
    config: providerProfileConfig,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_providerProfileId", ["providerProfileId"])
    .index("by_engineProfileId", ["engineProfileId"])
    .index("by_provider", ["provider"])
    .index("by_provider_and_isDefault", ["provider", "isDefault"]),
  apps: defineTable({
    appId: v.string(),
    templateId: v.optional(v.string()),
    name: v.string(),
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
  boxes: defineTable({
    boxId: v.string(),
    subjectId: v.optional(v.string()),
    subjectKind: v.optional(v.string()),
    appId: v.union(v.string(), v.null()),
    engine: v.optional(v.string()),
    engineProfileId: v.optional(v.union(v.string(), v.null())),
    providerProfileId: v.optional(v.union(v.string(), v.null())),
    agentId: v.union(v.string(), v.null()),
    targetPath: v.optional(v.union(v.string(), v.null())),
    workspacePath: v.union(v.string(), v.null()),
    sessionId: v.union(v.string(), v.null()),
    sessionKeyGeneration: v.optional(v.number()),
    provider: v.union(v.string(), v.null()),
    model: v.union(v.string(), v.null()),
    status: boxStatus,
    policy: boxPolicy,
    lastRunAt: v.union(v.number(), v.null()),
    lastError: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_boxId", ["boxId"])
    .index("by_appId", ["appId"])
    .index("by_subjectId", ["subjectId"]),
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
    boxId: v.optional(v.union(v.string(), v.null())),
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
    failureStage: v.optional(v.string()),
    failureClassification: v.optional(failureClassification),
    agentResult: v.optional(agentResult),
    resultVersionId: v.optional(v.id("versions")),
    pipelineRunId: v.optional(v.id("pipelineRuns")),
    recoveryMode: v.optional(recoveryMode),
    recoveryParentJobId: v.optional(v.id("jobs")),
    recoveryAttempt: v.optional(v.number()),
    autoRecoveryTriggered: v.optional(v.boolean()),
    autoRecoveryJobId: v.optional(v.id("jobs")),
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
    boxId: v.optional(v.union(v.string(), v.null())),
    templateId: v.optional(v.string()),
    jobId: v.id("jobs"),
    prompt: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("failed"),
      v.literal("completed"),
    ),
    versionId: v.optional(v.id("versions")),
    submittedAt: v.number(),
    claimedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    failureStage: v.optional(v.string()),
    failureClassification: v.optional(failureClassification),
    recoveryMode: v.optional(recoveryMode),
    recoveryParentJobId: v.optional(v.id("jobs")),
    recoveryAttempt: v.optional(v.number()),
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
