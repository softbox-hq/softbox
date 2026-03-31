import { ConvexHttpClient } from "convex/browser";
import type { BoxPolicy, BoxStatus } from "./boxes";
import type { WorkerConfig } from "./config";
import type { SourceFile } from "./filesystem";
import { convexApi } from "./shared/convexApi";

export type JobRecord = {
  _id: string;
  appId: string;
  boxId?: string | null;
  prompt: string;
  status: "pending" | "running" | "failed" | "completed";
  submittedAt: number;
  claimedAt?: number;
  baseVersionId?: string;
  buildError?: string;
  failureStage?: string;
  failureClassification?: "infra_transient" | "code_app" | "unknown";
  pipelineRunId?: string;
  recoveryMode?: "stage_retry" | "repair_with_agent";
  recoveryParentJobId?: string;
  recoveryAttempt?: number;
  autoRecoveryTriggered?: boolean;
  autoRecoveryJobId?: string;
  agentResult?: {
    summary: string;
    changed_files: string[];
    notes?: string;
  };
};

export type AppConfigRecord = {
  appId: string;
  name: string;
  codexThreadId?: string | null;
  openClawSessionId?: string | null;
  box?: BoxRecord | null;
  boxes?: BoxRecord[];
  primaryBox?: BoxRecord | null;
  engineProfile?: EngineProfileRecord | null;
  providerProfile?: ProviderProfileRecord | null;
};

export type AppRecord = {
  appId: string;
  name: string;
  templateSourceStatus?: "unknown" | "available" | "missing";
  templateSourcePath?: string | null;
  templateSourceMessage?: string | null;
  box?: BoxRecord | null;
  boxes?: BoxRecord[];
  primaryBox?: BoxRecord | null;
  boxCount?: number;
};

export type BoxRecord = {
  boxId: string;
  subjectId: string;
  subjectKind: string;
  appId: string | null;
  engine: string;
  engineProfileId: string | null;
  providerProfileId: string | null;
  agentId: string | null;
  targetPath: string | null;
  workspacePath: string | null;
  sessionId: string | null;
  sessionKeyGeneration: number;
  provider: string | null;
  model: string | null;
  engineProfile?: EngineProfileRecord | null;
  providerProfile?: ProviderProfileRecord | null;
  status: BoxStatus;
  policy: BoxPolicy;
  lastRunAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type EngineProfileRecord = {
  engineProfileId: string;
  engine: string;
  name: string;
  description: string | null;
  status: "ready" | "needs_setup" | "error";
  isDefault: boolean;
  config: {
    gatewayBaseUrl?: string | null;
    routingMode?: string | null;
    sessionKeyPrefix?: string | null;
    agentId?: string | null;
    agentIdPrefix?: string | null;
    tokenConfigured?: boolean;
  };
  createdAt: number;
  updatedAt: number;
};

export type ProviderProfileRecord = {
  providerProfileId: string;
  engineProfileId: string | null;
  provider: string;
  name: string;
  description: string | null;
  model: string | null;
  status: "ready" | "needs_auth" | "error";
  isDefault: boolean;
  config: {
    authMethod?: string | null;
    authTarget?: string | null;
  };
  createdAt: number;
  updatedAt: number;
};

export type ArtifactPurgeTaskRecord = {
  _id: string;
  appId: string;
  requestedAt: number;
  updatedAt: number;
  lastError?: string | null;
};

export type SeedAppStateRecord = {
  existingApp: boolean;
  purgeQueued: boolean;
  counts: {
    jobs: number;
    activeJobs: number;
    pipelineRuns: number;
    pipelineStages: number;
    runtimeErrors: number;
    versions: number;
    appFiles: number;
  };
};

export type LegacyAppIdMigrationRecord = {
  fromAppId: string;
  toAppId: string;
  name: string;
  counts: {
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
};

export type LegacyAppIdMigrationConflictRecord = {
  fromAppId: string;
  toAppId: string;
  reason: string;
};

export type LegacyAppIdMigrationPlanRecord = {
  dryRun?: boolean;
  migratedCount?: number;
  migrations: LegacyAppIdMigrationRecord[];
  conflicts: LegacyAppIdMigrationConflictRecord[];
  cleanup: {
    appDocs: number;
    pipelineRuns: number;
  };
};

export class ConvexRuntimeClient {
  private readonly client: ConvexHttpClient;

  constructor(config: WorkerConfig) {
    this.client = new ConvexHttpClient(config.convexUrl);
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    return await this.client.query(convexApi.getJob as any, { jobId });
  }

  async getPendingJob(appId: string): Promise<JobRecord | null> {
    return await this.client.query(convexApi.getPendingJob as any, { appId });
  }

  async getNextPendingJob(): Promise<JobRecord | null> {
    return await this.client.query(convexApi.getNextPendingJob as any, {});
  }

  async listStaleRunningJobs(staleBefore: number): Promise<JobRecord[]> {
    return await this.client.query(convexApi.listStaleRunningJobs as any, { staleBefore });
  }

  async getAppConfig(appId: string, boxId?: string | null): Promise<AppConfigRecord | null> {
    return await this.client.query(convexApi.getAppConfig as any, {
      appId,
      boxId: boxId ?? null,
    });
  }

  async listApps(): Promise<AppRecord[]> {
    return await this.client.query(convexApi.listApps as any, {});
  }

  async listBoxes(): Promise<BoxRecord[]> {
    return await this.client.query(convexApi.listBoxes as any, {});
  }

  async listEngineProfiles(): Promise<EngineProfileRecord[]> {
    return await this.client.query(convexApi.listEngineProfiles as any, {});
  }

  async listProviderProfiles(): Promise<ProviderProfileRecord[]> {
    return await this.client.query(convexApi.listProviderProfiles as any, {});
  }

  async getNextArtifactPurgeTask(): Promise<ArtifactPurgeTaskRecord | null> {
    return await this.client.query(convexApi.getNextArtifactPurgeTask as any, {});
  }

  async inspectSeedAppState(appId: string): Promise<SeedAppStateRecord> {
    return await this.client.query(convexApi.inspectSeedAppState as any, { appId });
  }

  async inspectLegacyAppIdMigration(): Promise<LegacyAppIdMigrationPlanRecord> {
    return await this.client.query(convexApi.inspectLegacyAppIdMigration as any, {});
  }

  async migrateLegacyAppIds(dryRun = true): Promise<LegacyAppIdMigrationPlanRecord> {
    return await this.client.mutation(convexApi.migrateLegacyAppIds as any, { dryRun });
  }

  async resetSeedAppState(appId: string): Promise<void> {
    await this.client.mutation(convexApi.resetSeedAppState as any, { appId });
  }

  async hasActiveJobsForApp(appId: string): Promise<boolean> {
    return await this.client.query(convexApi.hasActiveJobsForApp as any, { appId });
  }

  async finalizeDeletedAppData(appId: string): Promise<void> {
    await this.client.mutation(convexApi.finalizeDeletedAppData as any, { appId });
  }

  async completeArtifactPurgeTask(taskId: string): Promise<void> {
    await this.client.mutation(convexApi.completeArtifactPurgeTask as any, { taskId });
  }

  async recordArtifactPurgeFailure(args: { taskId: string; error: string }): Promise<void> {
    await this.client.mutation(convexApi.recordArtifactPurgeFailure as any, args);
  }

  async setAppCodexThread(args: {
    appId: string;
    threadId: string | null;
  }): Promise<void> {
    await this.client.mutation(convexApi.setAppCodexThread as any, args);
  }

  async setAppOpenClawSession(args: {
    appId: string;
    sessionId: string | null;
  }): Promise<void> {
    await this.client.mutation(convexApi.setAppOpenClawSession as any, args);
  }

  async enqueueFailureRecoveryJob(args: {
    appId: string;
    failedJobId: string;
    prompt: string;
    recoveryMode: "stage_retry" | "repair_with_agent";
    sourceStage: string;
    failureClassification: "infra_transient" | "code_app" | "unknown";
  }): Promise<string | null> {
    return await this.client.mutation(convexApi.enqueueFailureRecoveryJob as any, args);
  }

  async upsertBox(args: {
    boxId: string;
    subjectId: string;
    subjectKind: string;
    appId?: string | null;
    engine: string;
    engineProfileId?: string | null;
    providerProfileId?: string | null;
    agentId?: string | null;
    targetPath?: string | null;
    workspacePath?: string | null;
    sessionId?: string | null;
    sessionKeyGeneration?: number;
    provider?: string | null;
    model: string | null;
    status: BoxStatus;
    policy: BoxPolicy;
    lastRunAt?: number | null;
    lastError?: string | null;
  }): Promise<void> {
    await this.client.mutation(convexApi.upsertBox as any, args);
  }

  async createBox(args: {
    appId: string;
    scope: string;
    sourceBoxId?: string | null;
    role?: string | null;
    instructions?: string | null;
  }): Promise<void> {
    await this.client.mutation(convexApi.createBox as any, args);
  }

  async deleteBox(args: { boxId: string }): Promise<void> {
    await this.client.mutation(convexApi.deleteBox as any, args);
  }

  async updateBoxPolicy(args: {
    boxId: string;
    role?: string | null;
    instructions?: string | null;
    readOnly?: boolean;
    proposalOnly?: boolean;
    canPromote?: boolean;
  }): Promise<void> {
    await this.client.mutation(convexApi.updateBoxPolicy as any, args);
  }

  async upsertEngineProfile(args: {
    engineProfileId: string;
    engine: string;
    name: string;
    description?: string | null;
    status: "ready" | "needs_setup" | "error";
    isDefault: boolean;
    config: {
      gatewayBaseUrl?: string | null;
      routingMode?: string | null;
      sessionKeyPrefix?: string | null;
      agentId?: string | null;
      agentIdPrefix?: string | null;
      tokenConfigured?: boolean;
    };
  }): Promise<void> {
    await this.client.mutation(convexApi.upsertEngineProfile as any, args);
  }

  async upsertProviderProfile(args: {
    providerProfileId: string;
    engineProfileId?: string | null;
    provider: string;
    name: string;
    description?: string | null;
    model: string | null;
    status: "ready" | "needs_auth" | "error";
    isDefault: boolean;
    config: {
      authMethod?: string | null;
      authTarget?: string | null;
    };
  }): Promise<void> {
    await this.client.mutation(convexApi.upsertProviderProfile as any, args);
  }

  async setAppTemplateSourceStatus(args: {
    appId: string;
    status: "unknown" | "available" | "missing";
    path: string | null;
    message: string | null;
  }): Promise<void> {
    await this.client.mutation(convexApi.setAppTemplateSourceStatus as any, args);
  }

  async markJobRunning(jobId: string): Promise<JobRecord | null> {
    return await this.client.mutation(convexApi.markJobRunning as any, { jobId });
  }

  async listAppFiles(appId: string): Promise<SourceFile[]> {
    const files = await this.client.query(convexApi.listAppFiles as any, { appId });
    return files.map((file: any) => ({
      path: file.path,
      content: file.content,
    }));
  }

  async getShellState(appId: string, boxId?: string | null): Promise<any> {
    return await this.client.query(convexApi.getShellState as any, {
      appId,
      boxId: boxId ?? null,
    });
  }

  async recordReadyVersion(args: {
    appId: string;
    jobId: string;
    manifestUrl: string;
    buildLog: string;
    stateJson: string;
    agentResult?: {
      summary: string;
      changed_files: string[];
      notes?: string;
    };
    files: SourceFile[];
  }): Promise<void> {
    await this.client.mutation(convexApi.recordReadyVersion as any, args);
  }

  async recordPipelineStage(args: {
    runId: string;
    appId: string;
    key: string;
    status: "running" | "completed" | "failed";
    detail?: string;
  }): Promise<void> {
    await this.client.mutation(convexApi.recordPipelineStage as any, args);
  }

  async recordBuildFailure(args: {
    appId: string;
    jobId: string;
    buildLog: string;
    failureStage?: string;
    failureClassification?: "infra_transient" | "code_app" | "unknown";
    agentResult?: {
      summary: string;
      changed_files: string[];
      notes?: string;
    };
  }): Promise<void> {
    await this.client.mutation(convexApi.recordBuildFailure as any, args);
  }

  async seedApp(args: {
    appId: string;
    name: string;
    files: SourceFile[];
    manifestUrl: string;
    buildLog: string;
    stateJson: string;
  }): Promise<void> {
    await this.client.mutation(convexApi.seedApp as any, args);
  }
}
