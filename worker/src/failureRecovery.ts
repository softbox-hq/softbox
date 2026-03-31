export type FailureStage = "agent" | "build" | "upload" | "publish" | "preview" | "unknown";

export type FailureClassification = "infra_transient" | "code_app" | "unknown";

export type RecoveryMode = "stage_retry" | "repair_with_agent";

export type FailureRecoveryDecision = {
  classification: FailureClassification;
  recoveryMode: RecoveryMode | null;
  shouldAutoRecover: boolean;
  reason: string;
};

const infraPatterns = [
  /\bECONNRESET\b/i,
  /\bECONNREFUSED\b/i,
  /\bETIMEDOUT\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /\bsocket hang up\b/i,
  /\bnetwork error\b/i,
  /\bfetch failed\b/i,
  /\bservice unavailable\b/i,
  /\btemporar(?:ily)? unavailable\b/i,
  /\b(?:502|503|504)\b/i,
  /\bconnection reset\b/i,
  /\btimeout\b/i,
];

const codePatterns = [
  /\bFailed to resolve import\b/i,
  /\bCannot find module\b/i,
  /\bModule not found\b/i,
  /\bCould not resolve\b/i,
  /\bNo matching export\b/i,
  /\bis not exported by\b/i,
  /\bUnexpected token\b/i,
  /\bSyntaxError\b/i,
  /\bReferenceError\b/i,
  /\bTypeError\b/i,
  /\bBuild failed\b/i,
  /\bTS\d{4}\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyFailure(args: {
  stage: FailureStage;
  message: string;
  recoveryAttempt?: number | null;
}): FailureRecoveryDecision {
  const recoveryAttempt = Math.max(0, Math.trunc(args.recoveryAttempt ?? 0));
  const message = args.message;
  const isInfra = matchesAny(message, infraPatterns);
  const isCode = matchesAny(message, codePatterns);

  if (recoveryAttempt >= 1) {
    return {
      classification: isCode ? "code_app" : isInfra ? "infra_transient" : "unknown",
      recoveryMode: null,
      shouldAutoRecover: false,
      reason: "automatic recovery limit reached",
    };
  }

  if (args.stage === "build" && isCode) {
    return {
      classification: "code_app",
      recoveryMode: "repair_with_agent",
      shouldAutoRecover: true,
      reason: "build log indicates application code must change",
    };
  }

  if ((args.stage === "build" || args.stage === "upload" || args.stage === "publish") && isInfra) {
    return {
      classification: "infra_transient",
      recoveryMode: "stage_retry",
      shouldAutoRecover: true,
      reason: "failure looks transient and can retry build/upload/publish without rerunning the agent",
    };
  }

  return {
    classification: isCode ? "code_app" : isInfra ? "infra_transient" : "unknown",
    recoveryMode: null,
    shouldAutoRecover: false,
    reason: "no safe automatic recovery strategy matched",
  };
}

function truncateLog(message: string, maxChars = 4000): string {
  const trimmed = message.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars - 15)}\n...[truncated]`;
}

export function buildRepairPrompt(args: {
  originalPrompt: string;
  stage: Exclude<FailureStage, "unknown"> | "unknown";
  message: string;
}): string {
  return [
    "Repair the current failed candidate in place instead of starting from the live version.",
    "Only make the minimum code or dependency changes needed to get the pipeline unstuck.",
    "",
    `Original request: ${args.originalPrompt.trim()}`,
    `Failed stage: ${args.stage}`,
    "",
    "Failure log:",
    truncateLog(args.message),
  ].join("\n");
}
