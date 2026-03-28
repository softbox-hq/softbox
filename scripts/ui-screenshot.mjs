import { spawn } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function findAppRoot(startDir) {
  let current = resolve(startDir);
  const root = resolve(repoRoot, "..");

  while (current.startsWith(root)) {
    const packageJsonPath = resolve(current, "package.json");
    const softboxConfigPath = resolve(current, "softbox.config.json");
    if (existsSync(packageJsonPath) && existsSync(softboxConfigPath)) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error(
    "ui:screenshot must be run from a wrapped app package root (or a subdirectory inside it).",
  );
}

async function getFreePort() {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a local port.")));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise(address.port);
      });
    });
    server.on("error", reject);
  });
}

function resolveViteEntry(appRoot) {
  const localVite = resolve(appRoot, "node_modules", "vite", "bin", "vite.js");
  if (existsSync(localVite)) {
    return localVite;
  }

  const repoVite = resolve(repoRoot, "node_modules", "vite", "bin", "vite.js");
  if (existsSync(repoVite)) {
    return repoVite;
  }

  throw new Error(
    `Could not find a Vite CLI for ${normalizePath(appRoot)}. Install app dependencies first.`,
  );
}

async function waitForServer(url, child, logs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before screenshot.\n\n${logs.join("")}`);
    }

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${url}\n\n${logs.join("")}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });

    child.kill("SIGTERM");
  });
}

async function main() {
  const appRoot = findAppRoot(process.cwd());
  const appName = normalizePath(appRoot).split("/").pop() ?? "app";
  const softboxRoot = resolve(appRoot, ".softbox");
  const screenshotsRoot = resolve(softboxRoot, "screenshots");
  const reportsRoot = resolve(softboxRoot, "reports");
  await mkdir(screenshotsRoot, { recursive: true });
  await mkdir(reportsRoot, { recursive: true });

  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const viteEntry = resolveViteEntry(appRoot);
  const logs = [];
  const child = spawn(
    process.execPath,
    [viteEntry, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: appRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout?.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr?.on("data", (chunk) => logs.push(chunk.toString()));

  try {
    await waitForServer(url, child, logs);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 960 },
        colorScheme: "dark",
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1200);
      const latestPath = resolve(screenshotsRoot, "latest.png");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const timestampedPath = resolve(screenshotsRoot, `${timestamp}.png`);
      await page.screenshot({
        path: latestPath,
        fullPage: true,
      });
      await copyFile(latestPath, timestampedPath);
      await writeFile(
        resolve(reportsRoot, "last-run.json"),
        `${JSON.stringify(
          {
            appName,
            appRoot: normalizePath(appRoot),
            url,
            capturedAt: new Date().toISOString(),
            latestScreenshot: normalizePath(latestPath),
            timestampedScreenshot: normalizePath(timestampedPath),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      console.log(`[ui:screenshot] captured ${normalizePath(latestPath)}`);
      console.log(`[ui:screenshot] archived ${normalizePath(timestampedPath)}`);
    } finally {
      await browser.close();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /error while loading shared libraries|libnspr4\.so/i.test(error.message)
    ) {
      throw new Error(
        `${error.message}\n\nThis machine is missing Linux browser runtime libraries.\nInstall them once, then retry:\n\npnpm exec playwright install --with-deps chromium\n\nIf --with-deps cannot run on this machine, install the missing Chromium/Playwright system libraries manually and retry.`,
      );
    }
    if (
      error instanceof Error &&
      /Executable doesn't exist|browserType\.launch/.test(error.message)
    ) {
      throw new Error(
        `${error.message}\n\nInstall Playwright Chromium once from the repo root:\n\npnpm exec playwright install chromium`,
      );
    }
    throw error;
  } finally {
    await stopChild(child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
