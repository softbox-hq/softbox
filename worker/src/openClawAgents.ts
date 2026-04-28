import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { BoxPolicy } from "./boxes";

export type OpenClawRoutingConfig = {
  agentId?: string | null;
  agentIdPrefix?: string | null;
  sessionKeyPrefix: string;
};

export type OpenClawListedAgent = {
  id: string;
  workspace: string | null;
  model: string | null;
  name: string | null;
  isDefault: boolean;
};

type OpenClawJsonCommandResult = {
  stdout: string;
  stderr: string;
};

class OpenClawCommandTimeoutError extends Error {
  constructor(
    readonly command: string,
    readonly args: string[],
    readonly timeoutMs: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(
      `Timed out after ${timeoutMs}ms while running '${command} ${args.join(" ")}'. ` +
        `${stderr.trim() || stdout.trim() || "No output."}`,
    );
    this.name = "OpenClawCommandTimeoutError";
  }
}

let cachedAgentList:
  | {
      key: string;
      fetchedAt: number;
      agents: OpenClawListedAgent[];
    }
  | null = null;

function readTrimmed(value: string | null | undefined): string | null {
  const nextValue = value?.trim() ?? "";
  return nextValue ? nextValue : null;
}

export function isPerAppOpenClawRouting(config: Pick<OpenClawRoutingConfig, "agentIdPrefix">): boolean {
  return Boolean(readTrimmed(config.agentIdPrefix));
}

export function buildConfiguredOpenClawAgentId(
  appId: string,
  config: Pick<OpenClawRoutingConfig, "agentId" | "agentIdPrefix">,
): string {
  const agentIdPrefix = readTrimmed(config.agentIdPrefix);
  if (agentIdPrefix) {
    return `${agentIdPrefix}${appId}`;
  }

  const agentId = readTrimmed(config.agentId);
  if (agentId) {
    return agentId;
  }

  throw new Error(
    "OpenClaw agent routing is not configured. Set OPENCLAW_AGENT_ID for one shared agent or OPENCLAW_AGENT_ID_PREFIX for one agent per app.",
  );
}

export function normalizeOpenClawModelId(model: string | null | undefined): string | null {
  const normalized = readTrimmed(model);
  if (!normalized) {
    return null;
  }
  if (normalized.includes("/")) {
    return normalized;
  }
  if (/^gpt-/i.test(normalized) || /^o[1-9]/i.test(normalized)) {
    return `openai-codex/${normalized}`;
  }
  return normalized;
}

export function buildOpenClawBoxPolicy(config: OpenClawRoutingConfig): BoxPolicy {
  const routingMode = isPerAppOpenClawRouting(config) ? "per_app" : "shared";
  return {
    transport: "ws_gateway",
    routingMode,
    workspaceIsolation: routingMode === "per_app" ? "app_root" : "repo_root",
    sessionKeyPrefix: config.sessionKeyPrefix,
  };
}

function runOpenClawJsonCommand(
  command: string,
  projectRoot: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<OpenClawJsonCommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      rejectPromise(
        new OpenClawCommandTimeoutError(command, args, timeoutMs, stdout, stderr),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        rejectPromise(
          new Error(
            `Command '${command} ${args.join(" ")}' exited with code ${code}. ` +
              `${stderr.trim() || stdout.trim() || "No output."}`,
          ),
        );
        return;
      }

      resolvePromise({ stdout, stderr });
    });
  });
}

export async function listOpenClawAgents(args: {
  command: string;
  projectRoot: string;
  forceRefresh?: boolean;
}): Promise<OpenClawListedAgent[]> {
  const cacheKey = `${args.command}\u0000${args.projectRoot}`;
  if (
    !args.forceRefresh &&
    cachedAgentList &&
    cachedAgentList.key === cacheKey &&
    Date.now() - cachedAgentList.fetchedAt < 5_000
  ) {
    return cachedAgentList.agents;
  }

  const result = await runOpenClawJsonCommand(args.command, args.projectRoot, [
    "agents",
    "list",
    "--json",
  ], 30_000);
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("OpenClaw agents list returned invalid JSON.");
  }

  const agents = parsed
    .filter((agent): agent is Record<string, unknown> => Boolean(agent) && typeof agent === "object")
    .map((agent) => ({
      id: typeof agent.id === "string" ? agent.id : "",
      workspace: typeof agent.workspace === "string" ? resolve(agent.workspace) : null,
      model: typeof agent.model === "string" ? agent.model : null,
      name: typeof agent.name === "string" ? agent.name : null,
      isDefault: agent.isDefault === true,
    }))
    .filter((agent) => Boolean(agent.id));

  cachedAgentList = {
    key: cacheKey,
    fetchedAt: Date.now(),
    agents,
  };

  return agents;
}

export async function createOpenClawAgent(args: {
  command: string;
  projectRoot: string;
  agentId: string;
  workspace: string;
  model?: string;
}): Promise<OpenClawListedAgent | null> {
  const normalizedModel = normalizeOpenClawModelId(args.model ?? null);
  const commandArgs = [
    "agents",
    "add",
    args.agentId,
    "--workspace",
    resolve(args.workspace),
    "--non-interactive",
    "--json",
  ];

  if (normalizedModel) {
    commandArgs.push("--model", normalizedModel);
  }

  const result = await runOpenClawJsonCommand(
    args.command,
    args.projectRoot,
    commandArgs,
    120_000,
  ).catch(async (error: unknown) => {
    if (!(error instanceof OpenClawCommandTimeoutError)) {
      throw error;
    }

    console.log(
      "[openclaw] OpenClaw agent creation timed out. On first run, OpenClaw may still be installing plugin runtime dependencies. Retrying once...",
    );
    return await runOpenClawJsonCommand(
      args.command,
      args.projectRoot,
      commandArgs,
      120_000,
    );
  });
  cachedAgentList = null;

  const parsed = JSON.parse(result.stdout) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : args.agentId,
    workspace: typeof record.workspace === "string" ? resolve(record.workspace) : resolve(args.workspace),
    model: typeof record.model === "string" ? record.model : normalizedModel,
    name: typeof record.name === "string" ? record.name : null,
    isDefault: record.isDefault === true,
  };
}

export async function deleteOpenClawAgent(args: {
  command: string;
  projectRoot: string;
  agentId: string;
}): Promise<void> {
  await runOpenClawJsonCommand(
    args.command,
    args.projectRoot,
    ["agents", "delete", args.agentId, "--force", "--json"],
    30_000,
  );
  cachedAgentList = null;
}

function resolveExpectedOpenClawAgent(args: {
  appId: string;
  projectRoot: string;
  liveAppRoot: string;
  openClaw: Pick<OpenClawRoutingConfig, "agentId" | "agentIdPrefix">;
  model?: string | null;
}): {
  agentId: string;
  routingMode: "shared" | "per_app";
  workspace: string;
  model: string | null;
} {
  const agentId = buildConfiguredOpenClawAgentId(args.appId, args.openClaw);
  const routingMode: "shared" | "per_app" = isPerAppOpenClawRouting(args.openClaw)
    ? "per_app"
    : "shared";
  const workspace = resolve(routingMode === "per_app" ? args.liveAppRoot : args.projectRoot);
  const model = normalizeOpenClawModelId(args.model ?? null);
  return {
    agentId,
    routingMode,
    workspace,
    model,
  };
}

export async function recreateOpenClawAgentForApp(args: {
  command: string;
  projectRoot: string;
  appId: string;
  liveAppRoot: string;
  openClaw: Pick<OpenClawRoutingConfig, "agentId" | "agentIdPrefix">;
  model?: string | null;
}): Promise<{
  agentId: string;
  workspace: string;
  routingMode: "shared" | "per_app";
  model: string | null;
}> {
  const expected = resolveExpectedOpenClawAgent(args);
  const agents = await listOpenClawAgents({
    command: args.command,
    projectRoot: args.projectRoot,
    forceRefresh: true,
  });

  if (agents.some((agent) => agent.id === expected.agentId)) {
    await deleteOpenClawAgent({
      command: args.command,
      projectRoot: args.projectRoot,
      agentId: expected.agentId,
    });
  }

  await createOpenClawAgent({
    command: args.command,
    projectRoot: args.projectRoot,
    agentId: expected.agentId,
    workspace: expected.workspace,
    model: expected.model ?? undefined,
  });

  return expected;
}

export async function resolveOpenClawAgentForApp(args: {
  command: string;
  projectRoot: string;
  appId: string;
  liveAppRoot: string;
  openClaw: Pick<OpenClawRoutingConfig, "agentId" | "agentIdPrefix">;
  model?: string | null;
  autoRepair?: boolean;
}): Promise<{
  agentId: string;
  workspace: string | null;
  routingMode: "shared" | "per_app";
  repaired: boolean;
  model: string | null;
}> {
  const expected = resolveExpectedOpenClawAgent(args);
  const { agentId, routingMode } = expected;
  const expectedWorkspace = expected.workspace;
  const expectedModel = expected.model;
  const agents = await listOpenClawAgents({
    command: args.command,
    projectRoot: args.projectRoot,
  });
  const registeredAgent = agents.find((agent) => agent.id === agentId);
  const hasWorkspaceMismatch =
    registeredAgent !== undefined && registeredAgent.workspace !== expectedWorkspace;
  const hasModelMismatch =
    registeredAgent !== undefined &&
    expectedModel !== null &&
    registeredAgent.model !== expectedModel;

  async function createExpectedAgent() {
    await createOpenClawAgent({
      command: args.command,
      projectRoot: args.projectRoot,
      agentId,
      workspace: expectedWorkspace,
      model: expectedModel ?? undefined,
    });
  }

  if (!registeredAgent) {
    if (args.autoRepair) {
      await createExpectedAgent();
      return {
        agentId,
        workspace: expectedWorkspace,
        routingMode,
        repaired: true,
        model: expectedModel,
      };
    }

    throw new Error(
      routingMode === "per_app"
        ? `Expected OpenClaw agent '${agentId}' for app '${args.appId}', but it is not configured. ` +
            `Create it with: openclaw agents add ${agentId} --workspace ${expectedWorkspace} --non-interactive`
        : `Configured OpenClaw agent '${agentId}' was not found. Create it or switch to per-app routing with OPENCLAW_AGENT_ID_PREFIX.`,
    );
  }

  if (hasWorkspaceMismatch || hasModelMismatch) {
    if (args.autoRepair) {
      await deleteOpenClawAgent({
        command: args.command,
        projectRoot: args.projectRoot,
        agentId,
      });
      await createExpectedAgent();
      return {
        agentId,
        workspace: expectedWorkspace,
        routingMode,
        repaired: true,
        model: expectedModel,
      };
    }

    if (hasWorkspaceMismatch) {
      throw new Error(
        `OpenClaw agent '${agentId}' is configured for workspace '${registeredAgent.workspace ?? "unknown"}', ` +
          `but Softbox expects '${expectedWorkspace}'${routingMode === "per_app" ? " in per-app mode" : ""}.`,
      );
    }

    throw new Error(
      `OpenClaw agent '${agentId}' is configured for model '${registeredAgent.model ?? "unknown"}', ` +
        `but Softbox expects '${expectedModel}'.`,
    );
  }

  return {
    agentId,
    workspace: registeredAgent.workspace,
    routingMode,
    repaired: false,
    model: registeredAgent.model,
  };
}
