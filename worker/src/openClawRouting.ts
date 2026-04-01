import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const legacyOpenClawAgentIdPrefix = "softbox-";
const legacyConvexMirrorComment = "# Put same as VITE_CONVEX_URL, it is for Worker / control plane";
const normalizedConvexMirrorComment =
  "# Use the same Convex deployment URL here for the worker / control plane";

function readEnvFileValue(source: string, name: string): string | null {
  const pattern = new RegExp(`^${name}=(.*)$`, "m");
  const match = source.match(pattern);
  if (!match) {
    return null;
  }
  const rawValue = match[1] ?? "";
  const value = rawValue.split("#")[0]?.trim() ?? "";
  return value || null;
}

export function buildCheckoutScopedOpenClawAgentIdPrefix(projectRoot: string): string {
  const normalizedProjectRoot = resolve(projectRoot);
  const hash = createHash("sha256").update(normalizedProjectRoot).digest("hex").slice(0, 8);
  return `softbox-${hash}-`;
}

export function shouldAutofillOpenClawAgentIdPrefix(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return !normalized || normalized === legacyOpenClawAgentIdPrefix;
}

export function resolveOpenClawAgentIdPrefix(args: {
  projectRoot: string;
  agentId?: string | null;
  agentIdPrefix?: string | null;
}): string | undefined {
  const agentId = args.agentId?.trim() ?? "";
  if (agentId) {
    return undefined;
  }

  const configuredPrefix = args.agentIdPrefix?.trim() ?? "";
  if (!shouldAutofillOpenClawAgentIdPrefix(configuredPrefix)) {
    return configuredPrefix;
  }

  return buildCheckoutScopedOpenClawAgentIdPrefix(args.projectRoot);
}

export async function ensureOpenClawAgentIdPrefixInEnvFile(args: {
  envLocalPath: string;
  projectRoot: string;
}): Promise<{
  updated: boolean;
  prefix: string | null;
  source: "generated" | "existing" | "missing";
}> {
  if (!existsSync(args.envLocalPath)) {
    return {
      updated: false,
      prefix: null,
      source: "missing",
    };
  }

  const originalSource = await readFile(args.envLocalPath, "utf8");
  let nextSource = originalSource.replace(
    legacyConvexMirrorComment,
    normalizedConvexMirrorComment,
  );
  const configuredAgentId = readEnvFileValue(originalSource, "OPENCLAW_AGENT_ID");
  const configuredPrefix = readEnvFileValue(originalSource, "OPENCLAW_AGENT_ID_PREFIX");
  const resolvedPrefix = resolveOpenClawAgentIdPrefix({
    projectRoot: args.projectRoot,
    agentId: configuredAgentId,
    agentIdPrefix: configuredPrefix,
  });

  if (!resolvedPrefix) {
    if (nextSource !== originalSource) {
      await writeFile(args.envLocalPath, nextSource, "utf8");
      return {
        updated: true,
        prefix: null,
        source: "existing",
      };
    }

    return {
      updated: false,
      prefix: null,
      source: "existing",
    };
  }

  if (!shouldAutofillOpenClawAgentIdPrefix(configuredPrefix)) {
    if (nextSource !== originalSource) {
      await writeFile(args.envLocalPath, nextSource, "utf8");
      return {
        updated: true,
        prefix: resolvedPrefix,
        source: "existing",
      };
    }

    return {
      updated: false,
      prefix: resolvedPrefix,
      source: "existing",
    };
  }

  const replacementLine = `OPENCLAW_AGENT_ID_PREFIX=${resolvedPrefix}`;

  if (/^OPENCLAW_AGENT_ID_PREFIX=.*$/m.test(nextSource)) {
    nextSource = nextSource.replace(/^OPENCLAW_AGENT_ID_PREFIX=.*$/m, replacementLine);
  } else if (/^OPENCLAW_GATEWAY_TOKEN=.*$/m.test(nextSource)) {
    nextSource = nextSource.replace(
      /^OPENCLAW_GATEWAY_TOKEN=.*$/m,
      (line) => `${line}\n${replacementLine}`,
    );
  } else {
    const suffix = nextSource.endsWith("\n") ? "" : "\n";
    nextSource = `${nextSource}${suffix}${replacementLine}\n`;
  }

  if (nextSource !== originalSource) {
    await writeFile(args.envLocalPath, nextSource, "utf8");
    return {
      updated: true,
      prefix: resolvedPrefix,
      source: "generated",
    };
  }

  return {
    updated: false,
    prefix: resolvedPrefix,
    source: "existing",
  };
}
