import React, { useEffect, useState } from "react";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, unwatchFile, watchFile } from "node:fs";
import { Socket } from "node:net";
import { resolve } from "node:path";
import { Box, Newline, Text, render } from "ink";
import { config as loadEnv, parse as parseDotenv } from "dotenv";
import type { ServiceHealthStatus, ServiceStatus as DesktopServiceStatus } from "../shell/src/serviceStatus";
import { systemServices } from "../shell/src/systemServices";
import { ensureOpenClawAgentIdPrefixInEnvFile } from "../worker/src/openClawRouting";
import { parseS3ApiUrl } from "../worker/src/config";

type Mode = "quiet" | "verbose";
type ServiceName = "shell" | "convex" | "worker" | "agents";
type ServiceStatus = "idle" | "waiting" | "starting" | "ready" | "skipped" | "error";
type EventLevel = "info" | "success" | "warn" | "error";
type StreamKind = "stdout" | "stderr";
type DesktopServiceName = (typeof systemServices)[number]["name"];

type ProcessSpec = {
  command: string;
  args: string[];
  label: string;
  name: Exclude<ServiceName, "agents">;
};

type ServiceState = {
  detail: string;
  label: string;
  status: ServiceStatus;
};

type UiEvent = {
  detail: string;
  level: EventLevel;
  source: ServiceName;
  timestamp: number;
};

type DashboardState = {
  desktopServices: DesktopServiceStatus[];
  events: UiEvent[];
  mode: Mode;
  services: Record<ServiceName, ServiceState>;
  startedAt: number;
};

type DesktopTableLayout = {
  checkedWidth: number;
  roleWidth: number;
  serviceWidth: number;
  statusWidth: number;
};

type RuntimeOptions = {
  agentCommand: string;
  envLocalPath: string;
  mode: Mode;
  onboardingDone: boolean;
  sharedOpenClawAgentId: string;
  syncAgents: boolean;
};

const shellProcess: ProcessSpec = {
  name: "shell",
  label: "Shell",
  command: "pnpm",
  args: ["exec", "vite", "--config", "shell/vite.config.ts"],
};

const runtimeProcesses: ProcessSpec[] = [
  {
    name: "convex",
    label: "Convex",
    command: "pnpm",
    args: ["exec", "convex", "dev", "--tail-logs=disable"],
  },
  {
    name: "worker",
    label: "Worker",
    command: "pnpm",
    args: [
      "exec",
      "tsx",
      "watch",
      "--exclude",
      ".tmp/**",
      "--exclude",
      "/tmp/live-runtime-state-*",
      "worker/src/index.ts",
    ],
  },
];

const recentEventLimit = 8;
const recentLogLimit = 80;
const fatalLogDumpLimit = 16;
const shutdownGracePeriodMs = 2000;
const serviceStatusPollIntervalMs = 2000;

function isOpenClawCommand(command: string): boolean {
  return command.trim().toLowerCase().startsWith("openclaw");
}

function readOnboardingDone(envLocalPath: string): boolean {
  const source = existsSync(envLocalPath) ? readFileSync(envLocalPath, "utf8") : "";
  const parsed = parseDotenv(source);
  return (parsed.VITE_ONBOARDING_DONE ?? process.env.VITE_ONBOARDING_DONE ?? "")
    .trim()
    .toLowerCase() === "true";
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function readMissingPackageName(line: string): string | null {
  const match = line.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/);
  return match?.[1] ?? null;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(startedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatCheckedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function padCell(value: string, width: number): string {
  return truncateText(value, width).padEnd(width, " ");
}

function computeDesktopTableLayout(
  columns: number,
  locationWidths: number[],
): DesktopTableLayout {
  const statusWidth = 7;
  const checkedWidth = 8;
  const minServiceWidth = 6;
  const minRoleWidth = 12;

  let serviceWidth = 10;
  let roleWidth = 16;

  const maxLocationWidth = Math.max(4, ...locationWidths);
  const baseWidth = columns - maxLocationWidth - statusWidth - checkedWidth - 6;
  const availableForServiceAndRole = Math.max(minServiceWidth + minRoleWidth, baseWidth);
  const overflow = Math.max(0, serviceWidth + roleWidth - availableForServiceAndRole);
  const roleShrink = Math.min(overflow, roleWidth - minRoleWidth);
  roleWidth -= roleShrink;
  serviceWidth -= Math.min(overflow - roleShrink, serviceWidth - minServiceWidth);

  return {
    checkedWidth,
    roleWidth,
    serviceWidth,
    statusWidth,
  };
}

function formatUrlLocation(rawUrl: string | null | undefined): string {
  const value = rawUrl?.trim() ?? "";
  if (!value) {
    return "-";
  }

  try {
    const parsed = new URL(value);
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return value;
  }
}

function formatRedisLocation(redisUrl: string | null | undefined): string {
  const value = redisUrl?.trim() ?? "";
  if (!value) {
    return "-";
  }

  try {
    const { host, port } = parseRedisTarget(value);
    return `${host}:${port}`;
  } catch {
    return value;
  }
}

function desktopServiceLocation(name: DesktopServiceName): string {
  switch (name) {
    case "Convex":
      return formatUrlLocation(process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL);
    case "Redis":
      return formatRedisLocation(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
    case "BullMQ":
      return formatRedisLocation(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
    case "Worker":
      return "local";
    case "OpenClaw":
      return formatUrlLocation(process.env.OPENCLAW_GATEWAY_BASE_URL ?? "http://127.0.0.1:18789");
    case "Artifact Storage": {
      const provider = (process.env.ARTIFACT_STORAGE_PROVIDER ?? "r2").trim().toLowerCase();
      if (provider === "minio") {
        return formatUrlLocation(
          process.env.MINIO_PUBLIC_DEVELOPMENT_URL ??
            process.env.MINIO_S3_API ??
            "http://127.0.0.1:9000",
        );
      }
      return formatUrlLocation(process.env.PUBLIC_DEVELOPMENT_URL ?? process.env.S3_API);
    }
  }

  return "-";
}

function desktopServiceLabel(name: DesktopServiceName): string {
  if (name !== "Artifact Storage") {
    return name;
  }

  const provider = (process.env.ARTIFACT_STORAGE_PROVIDER ?? "r2").trim().toLowerCase();
  if (provider === "minio") {
    return "MinIO";
  }
  if (provider === "r2") {
    return "R2";
  }

  return name;
}

function createInitialDesktopServices(): DesktopServiceStatus[] {
  const checkedAt = Date.now();
  return systemServices.map((service) => ({
    ...service,
    checkedAt,
    status: "unknown",
    message: "Waiting for startup checks.",
  }));
}

function normalizeServiceStatusForDisplay(status: ServiceHealthStatus): string {
  return status;
}

function serviceStatusColor(status: ServiceHealthStatus): string {
  switch (status) {
    case "healthy":
      return "green";
    case "warning":
      return "yellow";
    case "error":
      return "red";
    case "unknown":
      return "gray";
  }
}

function serviceStatusIcon(status: ServiceHealthStatus): string {
  switch (status) {
    case "healthy":
      return "✓";
    case "warning":
      return "!";
    case "error":
      return "✖";
    case "unknown":
      return "·";
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isLocalHttpUrl(rawUrl: string | null): boolean {
  if (!rawUrl) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function parseGatewayPort(rawUrl: string | null): string {
  if (!rawUrl) {
    return "18789";
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  } catch {
    return "18789";
  }
}

function parseRedisTarget(redisUrl: string): { host: string; port: number } {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error(`Unsupported Redis protocol '${parsed.protocol}'`);
  }
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port ? Number(parsed.port) : 6379,
  };
}

async function canConnectTcp(host: string, port: number): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const socket = new Socket();
    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };
    socket.setTimeout(1500);
    socket.once("connect", () => {
      cleanup();
      resolvePromise();
    });
    socket.once("timeout", () => {
      cleanup();
      rejectPromise(new Error("Connection timed out"));
    });
    socket.once("error", (error) => {
      cleanup();
      rejectPromise(error);
    });
    socket.connect(port, host);
  });
}

async function checkRedisReachable(redisUrl: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { host, port } = parseRedisTarget(redisUrl);
    await canConnectTcp(host, port);
    return {
      ok: true,
      message: `Reachable at ${host}:${port}.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkHttpHealth(url: string, label: string): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(url, { method: "GET" });
    return {
      ok: response.ok,
      message: `${label} responded with ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function isLocalMinioProviderConfigured(): boolean {
  if ((process.env.ARTIFACT_STORAGE_PROVIDER ?? "r2").trim().toLowerCase() !== "minio") {
    return false;
  }

  const s3Api = process.env.MINIO_S3_API?.trim();
  if (!s3Api) {
    return true;
  }

  try {
    const parsed = parseS3ApiUrl(s3Api);
    return isLocalHttpUrl(parsed.endpoint);
  } catch {
    return true;
  }
}

function summarizeSyncLines(lines: string[]): { detail: string; warnings: string[] } {
  const warnings = lines.filter((line) => /could not|skipped box upsert/i.test(line));
  const createdLine = [...lines]
    .reverse()
    .find((line) => /\[sync-openclaw-agents\] created \d+ agent\(s\)/.test(line));

  if (!createdLine) {
    return {
      detail: "Finished",
      warnings,
    };
  }

  const match = createdLine.match(/created (\d+) agent\(s\)/);
  if (!match) {
    return {
      detail: createdLine.replace("[sync-openclaw-agents] ", ""),
      warnings,
    };
  }

  const createdCount = Number(match[1]);
  return {
    detail: createdCount === 0 ? "No agent changes" : `Created ${createdCount} agent(s)`,
    warnings,
  };
}

function classifyEventLevel(line: string, stream: StreamKind): EventLevel {
  if (/\b(error|failed|crashed)\b/i.test(line)) {
    return "error";
  }
  if (/\b(warn|warning|missing|skipped)\b/i.test(line)) {
    return "warn";
  }
  return stream === "stderr" ? "warn" : "info";
}

function createInitialState(options: RuntimeOptions): DashboardState {
  const runtimeDetail = options.onboardingDone
    ? "Queued for startup"
    : "Waiting for VITE_ONBOARDING_DONE=true";

  const agentDetail = options.syncAgents
    ? "Queued"
    : "Manual. Run pnpm worker:openclaw-sync-agents -- --apply";

  return {
    desktopServices: createInitialDesktopServices(),
    mode: options.mode,
    startedAt: Date.now(),
    events: [],
    services: {
      shell: {
        label: "Shell",
        status: "starting",
        detail: "Booting Vite dev server",
      },
      convex: {
        label: "Convex",
        status: options.onboardingDone ? "starting" : "waiting",
        detail: runtimeDetail,
      },
      worker: {
        label: "Worker",
        status: options.onboardingDone ? "starting" : "waiting",
        detail: runtimeDetail,
      },
      agents: {
        label: "Agent Sync",
        status: options.syncAgents ? "starting" : "skipped",
        detail: agentDetail,
      },
    },
  };
}

class DevRuntime {
  private readonly listeners = new Set<(state: DashboardState) => void>();
  private readonly lineHistory = new Map<Exclude<ServiceName, "agents">, string[]>();
  private readonly seenEvents = new Set<string>();
  private readonly completion: Promise<number>;
  private readonly resolveCompletion: (exitCode: number) => void;
  private readonly state: DashboardState;

  private children = new Map<Exclude<ServiceName, "agents">, ChildProcess>();
  private exitCode = 0;
  private finished = false;
  private gatewayChild: ChildProcess | null = null;
  private runtimeStarted = false;
  private runtimeStarting = false;
  private serviceStatusPoller: NodeJS.Timeout | null = null;
  private shellUrl: string | null = null;
  private shuttingDown = false;

  constructor(private readonly options: RuntimeOptions) {
    this.state = createInitialState(options);
    this.lineHistory.set("shell", []);
    this.lineHistory.set("convex", []);
    this.lineHistory.set("worker", []);

    let resolveCompletion!: (exitCode: number) => void;
    this.completion = new Promise<number>((resolvePromise) => {
      resolveCompletion = resolvePromise;
    });
    this.resolveCompletion = resolveCompletion;
  }

  snapshot(): DashboardState {
    return {
      ...this.state,
      desktopServices: [...this.state.desktopServices],
      services: { ...this.state.services },
      events: [...this.state.events],
    };
  }

  subscribe(listener: (state: DashboardState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async run(): Promise<number> {
    if (!this.options.onboardingDone) {
      this.pushEvent(
        "info",
        "shell",
        "Onboarding is incomplete. Convex and worker will start after VITE_ONBOARDING_DONE=true.",
      );
      this.updateDesktopService("Convex", {
        status: "warning",
        message: "Waiting for onboarding to complete.",
      });
      this.updateDesktopService("Worker", {
        status: "warning",
        message: "Waiting for onboarding to complete.",
      });
      this.updateDesktopService("BullMQ", {
        status: "warning",
        message: "Waiting for the worker pipeline to start.",
      });
      this.updateService("convex", {
        status: "waiting",
        detail: "Waiting for onboarding to complete",
      });
      this.updateService("worker", {
        status: "waiting",
        detail: "Waiting for onboarding to complete",
      });
    }

    this.startChild(shellProcess);

    if (this.options.onboardingDone) {
      await this.startRuntimeServices();
    } else {
      watchFile(this.options.envLocalPath, { interval: 500 }, async () => {
        if (this.shuttingDown || this.runtimeStarted || this.runtimeStarting) {
          return;
        }

        if (!readOnboardingDone(this.options.envLocalPath)) {
          return;
        }

        this.pushEvent("success", "shell", "Onboarding completed. Starting Convex and worker.");
        await this.startRuntimeServices();
      });
    }

    return await this.completion;
  }

  announce(level: EventLevel, source: ServiceName, detail: string): void {
    this.pushEvent(level, source, detail);
  }

  async shutdown(exitCode = 0): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    this.exitCode = exitCode;
    unwatchFile(this.options.envLocalPath);
    if (this.serviceStatusPoller) {
      clearInterval(this.serviceStatusPoller);
      this.serviceStatusPoller = null;
    }

    for (const child of this.children.values()) {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGTERM");
      }
    }

    if (this.gatewayChild && !this.gatewayChild.killed && this.gatewayChild.exitCode === null) {
      this.gatewayChild.kill("SIGTERM");
    }

    if (this.children.size === 0 && (!this.gatewayChild || this.gatewayChild.exitCode !== null)) {
      this.finish(exitCode);
      return;
    }

    setTimeout(() => {
      if (!this.shuttingDown) {
        return;
      }
      for (const child of this.children.values()) {
        if (!child.killed && child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }
      if (this.gatewayChild && !this.gatewayChild.killed && this.gatewayChild.exitCode === null) {
        this.gatewayChild.kill("SIGKILL");
      }
    }, shutdownGracePeriodMs).unref();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private updateDesktopService(
    name: DesktopServiceName,
    patch: Partial<DesktopServiceStatus>,
  ): void {
    const checkedAt = patch.checkedAt ?? Date.now();
    this.state.desktopServices = this.state.desktopServices.map((service) =>
      service.name === name
        ? {
            ...service,
            ...patch,
            checkedAt,
          }
        : service,
    );
    this.emit();
  }

  private replaceDesktopServices(nextServices: DesktopServiceStatus[]): void {
    this.state.desktopServices = nextServices;
    this.emit();
  }

  private finish(exitCode: number): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.resolveCompletion(exitCode);
  }

  private updateService(name: ServiceName, patch: Partial<ServiceState>): void {
    this.state.services = {
      ...this.state.services,
      [name]: {
        ...this.state.services[name],
        ...patch,
      },
    };
    this.emit();
  }

  private pushEvent(level: EventLevel, source: ServiceName, detail: string): void {
    const nextEvents = [
      ...this.state.events,
      {
        level,
        source,
        detail,
        timestamp: Date.now(),
      },
    ].slice(-recentEventLimit);
    this.state.events = nextEvents;
    this.emit();
  }

  private pushEventOnce(key: string, level: EventLevel, source: ServiceName, detail: string): void {
    if (this.seenEvents.has(key)) {
      return;
    }
    this.seenEvents.add(key);
    this.pushEvent(level, source, detail);
  }

  private rememberLine(name: Exclude<ServiceName, "agents">, line: string): void {
    const lines = this.lineHistory.get(name) ?? [];
    lines.push(line);
    if (lines.length > recentLogLimit) {
      lines.splice(0, lines.length - recentLogLimit);
    }
    this.lineHistory.set(name, lines);
  }

  private dumpRecentLines(name: Exclude<ServiceName, "agents">): void {
    const lines = this.lineHistory.get(name) ?? [];
    if (lines.length === 0) {
      return;
    }

    console.error(`[start] last ${Math.min(lines.length, fatalLogDumpLimit)} ${name} line(s):`);
    for (const line of lines.slice(-fatalLogDumpLimit)) {
      console.error(`[${name}] ${line}`);
    }
  }

  private writeVerboseLine(name: Exclude<ServiceName, "agents">, stream: StreamKind, line: string): void {
    const target = stream === "stderr" ? process.stderr : process.stdout;
    target.write(`[${name}] ${line}\n`);
  }

  private attachStream(
    name: Exclude<ServiceName, "agents">,
    stream: NodeJS.ReadableStream | null,
    kind: StreamKind,
  ): void {
    if (!stream) {
      return;
    }

    let buffer = "";
    stream.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        this.handleProcessLine(name, kind, line);
      }
    });

    stream.on("end", () => {
      if (buffer.trim().length > 0) {
        this.handleProcessLine(name, kind, buffer);
      }
    });
  }

  private handleProcessLine(
    name: Exclude<ServiceName, "agents">,
    stream: StreamKind,
    rawLine: string,
  ): void {
    const line = stripAnsi(rawLine).replace(/\r/g, "").trimEnd();
    if (line.trim().length === 0) {
      return;
    }

    this.rememberLine(name, line);

    if (this.options.mode === "verbose") {
      this.writeVerboseLine(name, stream, line);
    }

    switch (name) {
      case "shell":
        this.handleShellLine(line, stream);
        return;
      case "convex":
        this.handleConvexLine(line, stream);
        return;
      case "worker":
        this.handleWorkerLine(line, stream);
        return;
    }
  }

  private handleShellLine(line: string, stream: StreamKind): void {
    if (/^VITE v/i.test(line)) {
      this.updateService("shell", {
        status: "starting",
        detail: "Starting Vite dev server",
      });
      return;
    }

    const localMatch = line.match(/Local:\s+(https?:\/\/\S+)/i);
    if (localMatch) {
      const url = localMatch[1] ?? "http://localhost:4173/";
      this.updateService("shell", {
        status: "ready",
        detail: url,
      });
      this.startServiceStatusPolling(url);
      this.pushEvent("success", "shell", `Shell ready at ${url}`);
      return;
    }

    if (line.includes("Network:") || line.includes("press h + enter to show help")) {
      return;
    }

    this.pushEvent(classifyEventLevel(line, stream), "shell", line);
  }

  private handleConvexLine(line: string, stream: StreamKind): void {
    if (line.includes("Preparing Convex functions")) {
      this.updateService("convex", {
        status: "starting",
        detail: "Preparing functions",
      });
      return;
    }

    if (line.includes("Convex functions ready!")) {
      const durationMatch = line.match(/\(([^)]+)\)$/);
      const detail = durationMatch ? `Functions ready ${durationMatch[1]}` : "Convex functions ready.";
      this.updateService("convex", {
        status: "ready",
        detail,
      });
      this.updateDesktopService("Convex", {
        status: "healthy",
        message: detail,
      });
      this.pushEvent("success", "convex", "Convex functions ready");
      return;
    }

    if (line.startsWith("Changelog:")) {
      return;
    }

    if (line.startsWith("A minor update is available for Convex")) {
      return;
    }

    if (line.includes("Found multiple VITE_CONVEX_URL environment variables")) {
      this.pushEventOnce(
        "convex-multiple-vite-convex-url",
        "warn",
        "convex",
        "Convex skipped env auto-update because .env.local appears to define VITE_CONVEX_URL more than once.",
      );
      return;
    }

    this.pushEvent(classifyEventLevel(line, stream), "convex", line);
  }

  private handleWorkerLine(line: string, stream: StreamKind): void {
    if (line.includes("ready for multi-app processing")) {
      const modelMatch = line.match(/model ([^,]+)/);
      const detail = modelMatch?.[1] ? `model ${modelMatch[1]}` : "Ready";

      this.updateService("worker", {
        status: "ready",
        detail,
      });
      this.updateDesktopService("Worker", {
        status: "healthy",
        message: "Worker process is running.",
      });
      this.updateDesktopService("BullMQ", {
        status: "healthy",
        message: "Redis is reachable; BullMQ can use the queue backend.",
      });
      this.pushEvent("success", "worker", "Worker process is running.");
      if (detail !== "Ready") {
        this.pushEvent("info", "agents", `Worker agent backend configured with ${detail}.`);
      }
      return;
    }

    const missingPackage = readMissingPackageName(line);
    if (missingPackage) {
      const message = `Missing local dependency '${missingPackage}'. Run 'pnpm install' in the repo root.`;
      this.updateService("worker", {
        status: "error",
        detail: `Missing package ${missingPackage}`,
      });
      this.updateDesktopService("Worker", {
        status: "error",
        message,
      });
      if (missingPackage === "bullmq") {
        this.updateDesktopService("BullMQ", {
          status: "error",
          message,
        });
      }
      this.pushEventOnce(`worker-missing-package-${missingPackage}`, "error", "worker", message);
    }

    if (
      line.includes("REDIS IS NOT STARTED") ||
      line.includes("Redis is not reachable")
    ) {
      this.updateService("worker", {
        status: "error",
        detail: "Redis unavailable",
      });
      this.updateDesktopService("Worker", {
        status: "error",
        message: line,
      });
      this.updateDesktopService("BullMQ", {
        status: "warning",
        message: "BullMQ depends on Redis; queue backend is not healthy.",
      });
    }

    this.pushEvent(classifyEventLevel(line, stream), "worker", line);
  }

  private startChild(spec: ProcessSpec): void {
    if (this.children.has(spec.name)) {
      return;
    }

    this.updateService(spec.name, {
      status: "starting",
      detail: `Starting ${spec.label.toLowerCase()}`,
    });

    const child = spawn(spec.command, spec.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    this.children.set(spec.name, child);
    this.attachStream(spec.name, child.stdout, "stdout");
    this.attachStream(spec.name, child.stderr, "stderr");

    child.on("exit", (code, signal) => {
      this.children.delete(spec.name);

      if (this.shuttingDown) {
        if (this.children.size === 0 && (!this.gatewayChild || this.gatewayChild.exitCode !== null)) {
          this.finish(this.exitCode);
        }
        return;
      }

      const reason = signal
        ? `${spec.label} exited from signal ${signal}`
        : (code ?? 0) !== 0
          ? `${spec.label} exited with code ${code ?? 1}`
          : `${spec.label} exited unexpectedly`;

      this.updateService(spec.name, {
        status: "error",
        detail: reason,
      });
      this.pushEvent("error", spec.name, reason);

      if (this.options.mode === "quiet") {
        this.dumpRecentLines(spec.name);
      }

      void this.shutdown((code ?? 0) === 0 ? 1 : (code ?? 1));
    });

    child.on("error", (error) => {
      const reason = `Failed to start ${spec.label}: ${error.message}`;
      this.updateService(spec.name, {
        status: "error",
        detail: error.message,
      });
      this.pushEvent("error", spec.name, reason);

      if (this.options.mode === "quiet") {
        this.dumpRecentLines(spec.name);
      }

      void this.shutdown(1);
    });
  }

  private async startRuntimeServices(): Promise<void> {
    if (this.runtimeStarted || this.runtimeStarting || this.shuttingDown) {
      return;
    }

    this.runtimeStarting = true;
    this.updateDesktopService("Convex", {
      status: "warning",
      message: "Starting Convex dev server.",
    });
    this.updateDesktopService("Worker", {
      status: "warning",
      message: "Starting worker process.",
    });
    this.updateDesktopService("BullMQ", {
      status: "warning",
      message: "Checking Redis before the worker starts.",
    });
    this.updateDesktopService("Redis", {
      status: "warning",
      message: "Checking Redis availability.",
    });
    this.updateDesktopService("OpenClaw", {
      status: "warning",
      message: isOpenClawCommand(this.options.agentCommand)
        ? "Checking OpenClaw gateway."
        : `Agent command is '${this.options.agentCommand}'.`,
    });
    this.updateDesktopService("Artifact Storage", {
      status: "warning",
      message: "Checking artifact storage.",
    });
    this.updateService("convex", {
      status: "starting",
      detail: "Starting Convex dev server",
    });
    this.updateService("worker", {
      status: "starting",
      detail: "Starting worker watcher",
    });

    try {
      await this.ensureLocalRedisIfNeeded();
      await this.ensureLocalArtifactStorageIfNeeded();
      await this.ensureLocalGatewayIfNeeded();
      await this.syncAgentsIfNeeded();

      for (const spec of runtimeProcesses) {
        this.startChild(spec);
      }

      this.runtimeStarted = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushEvent("error", "agents", message);
      this.updateService("agents", {
        status: "error",
        detail: message,
      });
      await this.shutdown(1);
    } finally {
      this.runtimeStarting = false;
    }
  }

  private async refreshDesktopServicesFromShell(): Promise<void> {
    if (!this.shellUrl || this.shuttingDown) {
      return;
    }

    try {
      const response = await fetch(new URL("/__softbox/service-status", this.shellUrl), {
        method: "GET",
      });
      if (!response.ok) {
        throw new Error(`service status responded with ${response.status}`);
      }
      const payload = (await response.json()) as DesktopServiceStatus[];
      if (!Array.isArray(payload)) {
        throw new Error("service status payload is invalid");
      }
      this.replaceDesktopServices(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const service of systemServices) {
        this.updateDesktopService(service.name, {
          status: service.name === "Worker" || service.name === "Convex" ? "warning" : "error",
          message:
            service.name === "Worker" || service.name === "Convex"
              ? "Waiting for shell service checks."
              : message,
        });
      }
    }
  }

  private startServiceStatusPolling(shellUrl: string): void {
    this.shellUrl = shellUrl;
    if (this.serviceStatusPoller) {
      return;
    }

    void this.refreshDesktopServicesFromShell();
    this.serviceStatusPoller = setInterval(() => {
      void this.refreshDesktopServicesFromShell();
    }, serviceStatusPollIntervalMs);
    this.serviceStatusPoller.unref();
  }

  private async ensureLocalRedisIfNeeded(): Promise<void> {
    const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    let target: { host: string; port: number };

    try {
      target = parseRedisTarget(redisUrl);
    } catch (error) {
      this.updateDesktopService("Redis", {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      this.updateDesktopService("BullMQ", {
        status: "warning",
        message: "BullMQ depends on Redis; queue backend is not healthy.",
      });
      return;
    }

    const initial = await checkRedisReachable(redisUrl);
    if (initial.ok) {
      this.updateDesktopService("Redis", {
        status: "healthy",
        message: initial.message,
      });
      this.updateDesktopService("BullMQ", {
        status: "healthy",
        message: "Redis is reachable; BullMQ can use the queue backend.",
      });
      return;
    }

    if (!isLocalHostname(target.host)) {
      this.updateDesktopService("Redis", {
        status: "error",
        message: initial.message,
      });
      this.updateDesktopService("BullMQ", {
        status: "warning",
        message: "BullMQ depends on Redis; queue backend is not healthy.",
      });
      return;
    }

    this.pushEvent("info", "worker", "Redis is not reachable. Starting docker compose redis.");
    this.updateDesktopService("Redis", {
      status: "warning",
      message: "Starting local Redis from docker-compose.yml.",
    });

    try {
      await this.runOneShotCommand("docker", ["compose", "up", "-d", "redis"], "worker");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateDesktopService("Redis", {
        status: "error",
        message,
      });
      this.updateDesktopService("BullMQ", {
        status: "warning",
        message: "BullMQ depends on Redis; queue backend is not healthy.",
      });
      this.pushEvent("error", "worker", message);
      return;
    }

    let latest = initial;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      latest = await checkRedisReachable(redisUrl);
      if (latest.ok) {
        break;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }

    this.updateDesktopService("Redis", {
      status: latest.ok ? "healthy" : "error",
      message: latest.ok ? latest.message : latest.message,
    });
    this.updateDesktopService("BullMQ", {
      status: latest.ok ? "healthy" : "warning",
      message: latest.ok
        ? "Redis is reachable; BullMQ can use the queue backend."
        : "BullMQ depends on Redis; queue backend is not healthy.",
    });

    if (latest.ok) {
      this.pushEvent("success", "worker", "Redis is reachable for the worker queue.");
    }
  }

  private async ensureLocalArtifactStorageIfNeeded(): Promise<void> {
    if (!isLocalMinioProviderConfigured()) {
      const provider = (process.env.ARTIFACT_STORAGE_PROVIDER ?? "r2").trim().toLowerCase();
      this.updateDesktopService("Artifact Storage", {
        status: provider === "r2" ? "healthy" : "warning",
        message:
          provider === "r2"
            ? "R2 environment variables are configured."
            : "Artifact storage auto-start is only supported for local MinIO.",
      });
      return;
    }

    const s3Api = process.env.MINIO_S3_API?.trim();
    let endpoint = "http://127.0.0.1:9000";
    if (s3Api) {
      try {
        endpoint = parseS3ApiUrl(s3Api).endpoint;
      } catch (error) {
        this.updateDesktopService("Artifact Storage", {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
    const healthUrl = `${endpoint.replace(/\/+$/, "")}/minio/health/live`;
    const initial = await checkHttpHealth(healthUrl, "MinIO health endpoint");
    if (initial.ok) {
      this.updateDesktopService("Artifact Storage", {
        status: "healthy",
        message: "Local MinIO is ready for preview and live artifacts.",
      });
      return;
    }

    this.pushEvent("info", "worker", "Artifact storage is not healthy. Starting local MinIO.");
    this.updateDesktopService("Artifact Storage", {
      status: "warning",
      message: "Starting local MinIO from docker-compose.yml.",
    });

    try {
      await this.runOneShotCommand("docker", ["compose", "up", "-d", "minio"], "worker");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateDesktopService("Artifact Storage", {
        status: "error",
        message,
      });
      this.pushEvent("error", "worker", message);
      return;
    }

    let latest = initial;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      latest = await checkHttpHealth(healthUrl, "MinIO health endpoint");
      if (latest.ok) {
        break;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }

    this.updateDesktopService("Artifact Storage", {
      status: latest.ok ? "healthy" : "error",
      message: latest.ok
        ? "Local MinIO is ready for preview and live artifacts."
        : latest.message,
    });

    if (latest.ok) {
      this.pushEvent("success", "worker", "Local MinIO is reachable.");
    }
  }

  private async ensureLocalGatewayIfNeeded(): Promise<void> {
    if (!isOpenClawCommand(this.options.agentCommand)) {
      this.updateDesktopService("OpenClaw", {
        status: "unknown",
        message: `Agent command is '${this.options.agentCommand}'.`,
      });
      return;
    }

    const gatewayBaseUrl = process.env.OPENCLAW_GATEWAY_BASE_URL?.trim() || "http://127.0.0.1:18789";
    const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || "";

    if (!gatewayToken) {
      this.updateDesktopService("OpenClaw", {
        status: "error",
        message: "OpenClaw gateway token is missing.",
      });
      return;
    }

    const initial = await checkHttpHealth(gatewayBaseUrl, "OpenClaw gateway");
    if (initial.ok) {
      this.updateDesktopService("OpenClaw", {
        status: "healthy",
        message: initial.message,
      });
      return;
    }

    if (!isLocalHttpUrl(gatewayBaseUrl)) {
      this.updateDesktopService("OpenClaw", {
        status: "error",
        message: initial.message,
      });
      return;
    }

    if (this.gatewayChild && this.gatewayChild.exitCode === null && !this.gatewayChild.killed) {
      return;
    }

    this.pushEvent("info", "agents", "OpenClaw gateway is not reachable. Starting local gateway.");
    this.updateDesktopService("OpenClaw", {
      status: "warning",
      message: "Starting local OpenClaw gateway.",
    });

    const gatewayPort = parseGatewayPort(gatewayBaseUrl);
    const child = spawn(
      "openclaw",
      ["gateway", "run", "--port", gatewayPort, "--token", gatewayToken],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          OPENCLAW_GATEWAY_TOKEN: gatewayToken,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    this.gatewayChild = child;
    this.attachGatewayStream(child.stdout);
    this.attachGatewayStream(child.stderr);

    child.on("error", (error) => {
      this.updateDesktopService("OpenClaw", {
        status: "error",
        message: error.message,
      });
      this.pushEvent("error", "agents", `Failed to start OpenClaw gateway: ${error.message}`);
      this.gatewayChild = null;
    });

    child.on("exit", (code, signal) => {
      this.gatewayChild = null;
      if (this.shuttingDown) {
        if (this.children.size === 0) {
          this.finish(this.exitCode);
        }
        return;
      }

      const message =
        signal === "SIGTERM"
          ? "OpenClaw gateway stopped."
          : `OpenClaw gateway exited with code ${code ?? 1}.`;
      this.updateDesktopService("OpenClaw", {
        status: "error",
        message,
      });
      this.pushEvent("error", "agents", message);
    });

    let latest = initial;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      latest = await checkHttpHealth(gatewayBaseUrl, "OpenClaw gateway");
      if (latest.ok) {
        break;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }

    this.updateDesktopService("OpenClaw", {
      status: latest.ok ? "healthy" : "error",
      message: latest.message,
    });

    if (latest.ok) {
      this.pushEvent("success", "agents", "OpenClaw gateway is reachable.");
      return;
    }

    this.pushEvent("error", "agents", latest.message);
  }

  private attachGatewayStream(stream: NodeJS.ReadableStream | null): void {
    if (!stream) {
      return;
    }

    let buffer = "";
    stream.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = stripAnsi(rawLine).trim();
        if (!line) {
          continue;
        }
        if (this.options.mode === "verbose") {
          process.stdout.write(`[gateway] ${line}\n`);
        }
      }
    });
  }

  private async syncAgentsIfNeeded(): Promise<void> {
    if (!this.options.syncAgents) {
      if (!isOpenClawCommand(this.options.agentCommand)) {
        this.updateService("agents", {
          status: "skipped",
          detail: `Disabled for agent command '${this.options.agentCommand}'`,
        });
        return;
      }

      if (this.options.sharedOpenClawAgentId) {
        this.updateService("agents", {
          status: "skipped",
          detail: "Shared OPENCLAW_AGENT_ID configured",
        });
        return;
      }

      this.updateService("agents", {
        status: "skipped",
        detail: "Manual. Run pnpm worker:openclaw-sync-agents -- --apply",
      });
      return;
    }

    if (!isOpenClawCommand(this.options.agentCommand)) {
      this.updateService("agents", {
        status: "skipped",
        detail: `Skipped for agent command '${this.options.agentCommand}'`,
      });
      this.pushEvent(
        "info",
        "agents",
        `OpenClaw sync skipped because AGENT_COMMAND is '${this.options.agentCommand}'.`,
      );
      return;
    }

    if (this.options.sharedOpenClawAgentId) {
      this.updateService("agents", {
        status: "skipped",
        detail: "Shared OPENCLAW_AGENT_ID configured",
      });
      this.pushEvent(
        "info",
        "agents",
        "OpenClaw sync skipped because OPENCLAW_AGENT_ID points to one shared agent.",
      );
      return;
    }

    this.updateService("agents", {
      status: "starting",
      detail: "Syncing OpenClaw agents",
    });
    this.pushEvent("info", "agents", "Syncing OpenClaw agents for this checkout.");

    const lines = await this.runOneShotCommand(
      "pnpm",
      ["worker:openclaw-sync-agents", "--", "--apply"],
      "agents",
    );

    const { detail, warnings } = summarizeSyncLines(lines);
    this.updateService("agents", {
      status: "ready",
      detail,
    });
    this.pushEvent("success", "agents", detail);

    for (const warning of warnings) {
      this.pushEvent("warn", "agents", warning.replace("[sync-openclaw-agents] ", ""));
    }
  }

  private async runOneShotCommand(
    command: string,
    args: string[],
    source: ServiceName = "agents",
  ): Promise<string[]> {
    const lines: string[] = [];
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const handleLine = (rawLine: string) => {
      const line = stripAnsi(rawLine).replace(/\r/g, "").trim();
      if (line.length === 0) {
        return;
      }
      lines.push(line);
      if (this.options.mode === "verbose") {
        process.stdout.write(`[${source}] ${line}\n`);
      }
    };

    const bindStream = (stream: NodeJS.ReadableStream | null) => {
      if (!stream) {
        return;
      }
      let buffer = "";
      stream.on("data", (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const nextLines = buffer.split(/\r?\n/);
        buffer = nextLines.pop() ?? "";
        for (const line of nextLines) {
          handleLine(line);
        }
      });
      stream.on("end", () => {
        if (buffer.trim().length > 0) {
          handleLine(buffer);
        }
      });
    };

    bindStream(child.stdout);
    bindStream(child.stderr);

    return await new Promise<string[]>((resolvePromise, rejectPromise) => {
      child.on("error", (error) => {
        rejectPromise(error);
      });
      child.on("exit", (code, signal) => {
        if (signal) {
          rejectPromise(new Error(`OpenClaw agent sync exited from signal ${signal}`));
          return;
        }
        if ((code ?? 0) !== 0) {
          rejectPromise(
            new Error(
              lines.slice(-fatalLogDumpLimit).join("\n") ||
                `OpenClaw agent sync failed with exit code ${code ?? 1}`,
            ),
          );
          return;
        }
        resolvePromise(lines);
      });
    });
  }
}

function statusColor(status: ServiceStatus): string {
  switch (status) {
    case "ready":
      return "green";
    case "starting":
      return "cyan";
    case "waiting":
    case "skipped":
      return "yellow";
    case "error":
      return "red";
    case "idle":
      return "gray";
  }
}

function statusIcon(status: ServiceStatus): string {
  switch (status) {
    case "ready":
      return "✓";
    case "starting":
      return "●";
    case "waiting":
      return "◌";
    case "skipped":
      return "○";
    case "error":
      return "✖";
    case "idle":
      return "·";
  }
}

function eventColor(level: EventLevel): string {
  switch (level) {
    case "success":
      return "green";
    case "warn":
      return "yellow";
    case "error":
      return "red";
    case "info":
      return "cyan";
  }
}

function eventLabel(level: EventLevel): string {
  switch (level) {
    case "success":
      return "OK";
    case "warn":
      return "WARN";
    case "error":
      return "FAIL";
    case "info":
      return "INFO";
  }
}

function ServiceRow(props: { service: ServiceState }) {
  return (
    <Box>
      <Box width={2}>
        <Text color={statusColor(props.service.status)}>{statusIcon(props.service.status)}</Text>
      </Box>
      <Box width={12}>
        <Text bold>{props.service.label}</Text>
      </Box>
      <Box width={10}>
        <Text color={statusColor(props.service.status)}>
          {props.service.status === "ready"
            ? "ready"
            : props.service.status === "starting"
              ? "starting"
              : props.service.status === "waiting"
                ? "waiting"
                : props.service.status === "skipped"
                  ? "manual"
                  : props.service.status}
        </Text>
      </Box>
      <Text dimColor>{props.service.detail}</Text>
    </Box>
  );
}

function DesktopServiceRowWithLayout(props: {
  layout: DesktopTableLayout;
  service: DesktopServiceStatus;
}) {
  const serviceLabel = desktopServiceLabel(props.service.name);
  const location = desktopServiceLocation(props.service.name);

  return (
    <Text>
      <Text color={serviceStatusColor(props.service.status)}>
        {serviceStatusIcon(props.service.status)}
      </Text>
      <Text> </Text>
      <Text bold>{padCell(serviceLabel, props.layout.serviceWidth)}</Text>
      <Text> </Text>
      <Text dimColor>{padCell(props.service.role, props.layout.roleWidth)}</Text>
      <Text> </Text>
      <Text color={serviceStatusColor(props.service.status)}>
        {padCell(normalizeServiceStatusForDisplay(props.service.status), props.layout.statusWidth)}
      </Text>
      <Text> </Text>
      <Text dimColor>{padCell(formatCheckedAt(props.service.checkedAt), props.layout.checkedWidth)}</Text>
      <Text> </Text>
      <Text>{location}</Text>
    </Text>
  );
}

function EventRow(props: { event: UiEvent }) {
  return (
    <Box>
      <Box width={9}>
        <Text dimColor>{formatTimestamp(props.event.timestamp)}</Text>
      </Box>
      <Box width={7}>
        <Text color={eventColor(props.event.level)}>{eventLabel(props.event.level)}</Text>
      </Box>
      <Box width={9}>
        <Text dimColor>{props.event.source}</Text>
      </Box>
      <Text>{props.event.detail}</Text>
    </Box>
  );
}

function DevDashboard(props: { runtime: DevRuntime }) {
  const [state, setState] = useState<DashboardState>(() => props.runtime.snapshot());
  const tableLayout = computeDesktopTableLayout(
    process.stdout.columns ?? 80,
    state.desktopServices.map((service) => desktopServiceLocation(service.name).length),
  );

  useEffect(() => {
    return props.runtime.subscribe(setState);
  }, [props.runtime]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <ServiceRow service={state.services.shell} />

      <Newline />

      <Box flexDirection="column">
        <Text>
          <Text>  </Text>
          <Text bold>{padCell("Service", tableLayout.serviceWidth)}</Text>
          <Text> </Text>
          <Text bold>{padCell("Role", tableLayout.roleWidth)}</Text>
          <Text> </Text>
          <Text bold>{padCell("Status", tableLayout.statusWidth)}</Text>
          <Text> </Text>
          <Text bold>{padCell("Checked", tableLayout.checkedWidth)}</Text>
          <Text> </Text>
          <Text bold>Port</Text>
        </Text>
        {state.desktopServices.map((service) => (
          <DesktopServiceRowWithLayout
            key={service.name}
            layout={tableLayout}
            service={service}
          />
        ))}
      </Box>

      <Newline />

      <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1} paddingY={0}>
        <Box justifyContent="space-between">
          <Text bold>Recent Activity</Text>
          <Text dimColor>uptime {formatDuration(state.startedAt)}</Text>
        </Box>
        <Newline />
        {state.events.length === 0 ? (
          <Text dimColor>Waiting for service output...</Text>
        ) : (
          state.events.map((event) => (
            <EventRow
              key={`${event.timestamp}-${event.source}-${event.detail}`}
              event={event}
            />
          ))
        )}
      </Box>

      <Newline />

      <Text dimColor>
        Agent sync: {state.services.agents.detail} • Ctrl+C stop • pnpm run doctor checks local setup
      </Text>
    </Box>
  );
}

async function main(): Promise<void> {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });

  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    console.log("Usage: pnpm start [-- --verbose] [--sync-agents]");
    console.log("  --verbose      Show raw child-process logs instead of the Ink dashboard.");
    console.log("  --sync-agents  Run pnpm worker:openclaw-sync-agents -- --apply before worker startup.");
    return;
  }

  let mode: Mode = args.has("--verbose") ? "verbose" : "quiet";
  if (!process.stdout.isTTY && mode === "quiet") {
    mode = "verbose";
    console.log("[start] stdout is not a TTY; falling back to verbose logs");
  }

  const projectRoot = resolve(process.cwd());
  const envLocalPath = resolve(projectRoot, ".env.local");
  const openClawRouting = await ensureOpenClawAgentIdPrefixInEnvFile({
    envLocalPath,
    projectRoot,
  });
  if (openClawRouting.prefix) {
    process.env.OPENCLAW_AGENT_ID_PREFIX = openClawRouting.prefix;
  }

  const agentCommand =
    process.env.AGENT_COMMAND?.trim() ||
    process.env.CLAUDE_CODE_COMMAND?.trim() ||
    "codex";
  const sharedOpenClawAgentId = process.env.OPENCLAW_AGENT_ID?.trim() || "";
  const onboardingDone = readOnboardingDone(envLocalPath);
  const runtime = new DevRuntime({
    envLocalPath,
    onboardingDone,
    agentCommand,
    sharedOpenClawAgentId,
    mode,
    syncAgents: args.has("--sync-agents"),
  });

  if (openClawRouting.updated && openClawRouting.prefix) {
    runtime.announce(
      "info",
      "agents",
      `Using checkout-scoped OPENCLAW_AGENT_ID_PREFIX=${openClawRouting.prefix}`,
    );
  }

  let inkInstance: ReturnType<typeof render> | null = null;
  if (mode === "quiet") {
    inkInstance = render(<DevDashboard runtime={runtime} />, {
      exitOnCtrlC: false,
    });
  } else {
    console.log("[start] starting Convex, worker, and shell");
    console.log("[start] run 'pnpm run doctor' first if startup fails");
    console.log("[start] verbose mode enabled; use 'pnpm start' for the Ink dashboard");
    if (!onboardingDone) {
      console.log("[start] onboarding mode detected; starting the shell first");
    }
    if (args.has("--sync-agents")) {
      console.log("[start] OpenClaw agent sync is enabled for this start run");
    }
  }

  process.on("SIGINT", () => {
    void runtime.shutdown(0);
  });
  process.on("SIGTERM", () => {
    void runtime.shutdown(0);
  });

  const exitCode = await runtime.run();
  inkInstance?.unmount();
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
