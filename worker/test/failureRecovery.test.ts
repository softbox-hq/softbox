import { describe, expect, it } from "vitest";
import { buildRepairPrompt, classifyFailure } from "../src/failureRecovery";

describe("classifyFailure", () => {
  it("routes import resolution build failures to agent repair", () => {
    expect(
      classifyFailure({
        stage: "build",
        message: "Build failed with 1 error:\nerror: Failed to resolve import \"./missing\" from \"src/App.tsx\"",
      }),
    ).toEqual({
      classification: "code_app",
      recoveryMode: "repair_with_agent",
      shouldAutoRecover: true,
      reason: "build log indicates application code must change",
    });
  });

  it("routes transient upload failures to stage retry", () => {
    expect(
      classifyFailure({
        stage: "upload",
        message: "putObject failed: ETIMEDOUT while uploading manifest.json",
      }),
    ).toEqual({
      classification: "infra_transient",
      recoveryMode: "stage_retry",
      shouldAutoRecover: true,
      reason: "failure looks transient and can retry build/upload/publish without rerunning the agent",
    });
  });

  it("stops automatic recovery after one recovery attempt", () => {
    expect(
      classifyFailure({
        stage: "build",
        message: "Failed to resolve import ./missing",
        recoveryAttempt: 1,
      }),
    ).toEqual({
      classification: "code_app",
      recoveryMode: null,
      shouldAutoRecover: false,
      reason: "automatic recovery limit reached",
    });
  });
});

describe("buildRepairPrompt", () => {
  it("tells the agent to repair the failed candidate rather than restart from live", () => {
    const prompt = buildRepairPrompt({
      originalPrompt: "Add a settings drawer",
      stage: "build",
      message: "Failed to resolve import ./drawer",
    });

    expect(prompt).toContain("Repair the current failed candidate in place");
    expect(prompt).toContain("Original request: Add a settings drawer");
    expect(prompt).toContain("Failed stage: build");
    expect(prompt).toContain("Failed to resolve import ./drawer");
  });
});
