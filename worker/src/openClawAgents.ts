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
        new Error(
          `Timed out after ${timeoutMs}ms while running '${command} ${args.join(" ")}'.`,
        ),
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
    30_000,
  );
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

export async function resolveOpenClawAgentForApp(args: {
  command: string;
  projectRoot: string;
  appId: string;
  liveAppRoot: string;
  openClaw: Pick<OpenClawRoutingConfig, "agentId" | "agentIdPrefix">;
}): Promise<{
  agentId: string;
  workspace: string | null;
  routingMode: "shared" | "per_app";
}> {
  const agentId = buildConfiguredOpenClawAgentId(args.appId, args.openClaw);
  const agents = await listOpenClawAgents({
    command: args.command,
    projectRoot: args.projectRoot,
  });
  const registeredAgent = agents.find((agent) => agent.id === agentId);

  if (!registeredAgent) {
    const expectedWorkspace = resolve(args.liveAppRoot);
    throw new Error(
      isPerAppOpenClawRouting(args.openClaw)
        ? `Expected OpenClaw agent '${agentId}' for app '${args.appId}', but it is not configured. ` +
            `Create it with: openclaw agents add ${agentId} --workspace ${expectedWorkspace} --non-interactive`
        : `Configured OpenClaw agent '${agentId}' was not found. Create it or switch to per-app routing with OPENCLAW_AGENT_ID_PREFIX.`,
    );
  }

  if (isPerAppOpenClawRouting(args.openClaw)) {
    const expectedWorkspace = resolve(args.liveAppRoot);
    if (registeredAgent.workspace !== expectedWorkspace) {
      throw new Error(
        `OpenClaw agent '${agentId}' is configured for workspace '${registeredAgent.workspace ?? "unknown"}', ` +
          `but Softbox expects '${expectedWorkspace}' in per-app mode.`,
      );
    }
  }

  return {
    agentId,
    workspace: registeredAgent.workspace,
    routingMode: isPerAppOpenClawRouting(args.openClaw) ? "per_app" : "shared",
  };
}
