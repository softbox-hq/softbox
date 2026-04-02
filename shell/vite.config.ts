import { execFile, spawn } from "node:child_process";
import { cpus, freemem, hostname, platform, release, totalmem, arch } from "node:os";
import { Socket } from "node:net";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { systemServices } from "./src/systemServices";

loadEnv({ path: resolve(import.meta.dirname, "../.env.local"), quiet: true });
loadEnv({ path: resolve(import.meta.dirname, "../.env"), quiet: true });

export default defineConfig({
  root: resolve(import.meta.dirname),
  envDir: resolve(import.meta.dirname, ".."),
  plugins: [
    react(),
    {
      name: "softbox-create-app-api",
      configureServer(server) {
        let createAppInFlight = false;
        async function checkRedis(redisUrl: string | undefined) {
          if (!redisUrl) {
            return { status: "warning", message: "REDIS_URL is not configured." } as const;
          }
          try {
            const parsed = new URL(redisUrl);
            const port = Number(parsed.port || 6379);
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
              socket.connect(port, parsed.hostname);
            });
            return { status: "healthy", message: `Reachable at ${parsed.hostname}:${port}.` } as const;
          } catch (error) {
            return {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            } as const;
          }
        }

        async function checkHttp(url: string | undefined, label: string) {
          if (!url) {
            return { status: "warning", message: `${label} is not configured.` } as const;
          }
          try {
            const response = await fetch(url, { method: "GET" });
            return {
              status: response.ok ? "healthy" : "warning",
              message: `${label} responded with ${response.status}.`,
            } as const;
          } catch (error) {
            return {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            } as const;
          }
        }

        server.middlewares.use("/__softbox/create-app", (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
            return;
          }

          if (createAppInFlight) {
            res.statusCode = 409;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Another app creation is already running." }));
            return;
          }

          const chunks: Buffer[] = [];
          req.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          req.on("end", () => {
            let payload: { appId?: string } = {};
            try {
              payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
              return;
            }

            const appId = payload.appId?.trim().toLowerCase() ?? "";
            if (!/^[a-z0-9][a-z0-9-]*$/.test(appId)) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  ok: false,
                  error: "App id must use lowercase letters, numbers, and hyphens only.",
                }),
              );
              return;
            }

            createAppInFlight = true;
            const child = spawn(
              "pnpm",
              ["new-app", appId, "--", "--template", "react-ts"],
              {
                cwd: resolve(import.meta.dirname, ".."),
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
              },
            );

            let stderr = "";
            child.stdout.on("data", (chunk) => {
              process.stdout.write(`[create-app] ${chunk.toString()}`);
            });
            child.stderr.on("data", (chunk) => {
              const text = chunk.toString();
              stderr += text;
              process.stderr.write(`[create-app] ${text}`);
            });

            child.on("error", (error) => {
              createAppInFlight = false;
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: error.message }));
            });

            child.on("exit", (code, signal) => {
              createAppInFlight = false;
              if ((code ?? 0) === 0) {
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ ok: true, appId }));
                return;
              }

              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  ok: false,
                  error:
                    stderr.trim() ||
                    `pnpm new-app failed with ${signal ? `signal ${signal}` : `exit code ${code ?? 1}`}`,
                }),
              );
            });
          });
        });

        server.middlewares.use("/__softbox/server-info", (_req, res) => {
          execFile("df", ["-k", "."], { cwd: resolve(import.meta.dirname, "..") }, (error, stdout) => {
            let diskTotalGb: number | null = null;
            let diskFreeGb: number | null = null;

            if (!error) {
              const lines = stdout.trim().split("\n");
              const parts = lines[lines.length - 1]?.trim().split(/\s+/) ?? [];
              if (parts.length >= 4) {
                const totalKb = Number(parts[1]);
                const freeKb = Number(parts[3]);
                if (!Number.isNaN(totalKb) && !Number.isNaN(freeKb)) {
                  diskTotalGb = totalKb / 1024 / 1024;
                  diskFreeGb = freeKb / 1024 / 1024;
                }
              }
            }

            const cpuList = cpus();
            const cpuModel = cpuList[0]?.model ?? "Unknown CPU";
            const payload = {
              hostname: hostname(),
              platform: platform(),
              release: release(),
              arch: arch(),
              cpuModel,
              cpuCores: cpuList.length,
              totalMemoryGb: totalmem() / 1024 / 1024 / 1024,
              freeMemoryGb: freemem() / 1024 / 1024 / 1024,
              diskTotalGb,
              diskFreeGb,
              nodeVersion: process.version,
            };

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(payload));
          });
        });

        server.middlewares.use("/__softbox/service-status", async (_req, res) => {
          const checkedAt = Date.now();
          const redis = await checkRedis(process.env.REDIS_URL);
          const convex = await checkHttp(
            process.env.CONVEX_URL || process.env.VITE_CONVEX_URL,
            "Convex URL",
          );
          const openClaw = await checkHttp(
            process.env.OPENCLAW_GATEWAY_BASE_URL,
            "OpenClaw gateway",
          );

          execFile("pgrep", ["-f", "worker/src/index.ts"], (workerError, workerStdout) => {
            const workerHealthy = !workerError && workerStdout.trim().length > 0;
            const statuses = systemServices.map((service) => {
              if (service.name === "Convex") {
                return { ...service, checkedAt, ...convex };
              }
              if (service.name === "Redis") {
                return { ...service, checkedAt, ...redis };
              }
              if (service.name === "BullMQ") {
                return {
                  ...service,
                  checkedAt,
                  status: redis.status === "healthy" ? "healthy" : "warning",
                  message:
                    redis.status === "healthy"
                      ? "Redis is reachable; BullMQ can use the queue backend."
                      : "BullMQ depends on Redis; queue backend is not healthy.",
                };
              }
              if (service.name === "Worker") {
                return {
                  ...service,
                  checkedAt,
                  status: workerHealthy ? "healthy" : "error",
                  message: workerHealthy
                    ? "Worker process is running."
                    : "Worker process was not found.",
                };
              }
              if (service.name === "OpenClaw") {
                return { ...service, checkedAt, ...openClaw };
              }
              if (service.name === "Cloudflare R2") {
                const configured = Boolean(
                  process.env.S3_API &&
                    process.env.PUBLIC_DEVELOPMENT_URL &&
                    process.env.R2_ACCESS_KEY_ID &&
                    process.env.R2_SECRET_ACCESS_KEY,
                );
                return {
                  ...service,
                  checkedAt,
                  status: configured ? "healthy" : "warning",
                  message: configured
                    ? "R2 environment variables are configured."
                    : "One or more R2 environment variables are missing.",
                };
              }
              return {
                ...service,
                checkedAt,
                status: "unknown" as const,
                message: "No check implemented.",
              };
            });

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(statuses));
          });
        });
      },
    },
  ],
  publicDir: resolve(import.meta.dirname, "../public"),
  server: {
    port: 4173,
  },
  build: {
    outDir: resolve(import.meta.dirname, "../dist-shell"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shell": resolve(import.meta.dirname, "src"),
      "@shared": resolve(import.meta.dirname, "../worker/src/shared"),
    },
  },
});
