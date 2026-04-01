import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

type AppPackageManager = "pnpm" | "npm" | "yarn" | "bun";

type AppDependencyInstallPlan = {
  appRoot: string;
  relativeAppRoot: string;
  packageJsonPath: string;
  packageManager: AppPackageManager;
  command: string;
  args: string[];
  fingerprint: string;
  nodeModulesPath: string;
  stampPath: string;
};

type AppDependencyInstallStamp = {
  version: 1;
  fingerprint: string;
  packageManager: AppPackageManager;
  installedAt: string;
};

type AppPackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const dependencyInstallStampRelativePath = ".softbox/install-deps.json";

function normalizeRelativePath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).replaceAll("\\", "/") || absolutePath;
}

function countDeclaredDependencies(packageJson: AppPackageJson): number {
  return (
    Object.keys(packageJson.dependencies ?? {}).length +
    Object.keys(packageJson.devDependencies ?? {}).length +
    Object.keys(packageJson.optionalDependencies ?? {}).length
  );
}

async function readPackageJson(packageJsonPath: string): Promise<AppPackageJson> {
  return JSON.parse(await readFile(packageJsonPath, "utf8")) as AppPackageJson;
}

async function resolveFingerprint(args: {
  packageJsonPath: string;
  packageManager: AppPackageManager;
  lockfilePath: string | null;
}): Promise<string> {
  const hash = createHash("sha256");
  hash.update(`package-manager:${args.packageManager}\n`);
  hash.update(await readFile(args.packageJsonPath, "utf8"));
  if (args.lockfilePath) {
    hash.update("\n--lockfile--\n");
    hash.update(await readFile(args.lockfilePath, "utf8"));
  }
  return hash.digest("hex");
}

function resolveInstallCommand(packageManager: AppPackageManager, hasLockfile: boolean): {
  command: string;
  args: string[];
} {
  switch (packageManager) {
    case "pnpm":
      return {
        command: "pnpm",
        args: hasLockfile ? ["install", "--frozen-lockfile"] : ["install"],
      };
    case "npm":
      return {
        command: "npm",
        args: ["ci"],
      };
    case "yarn":
      return {
        command: "yarn",
        args: ["install"],
      };
    case "bun":
      return {
        command: "bun",
        args: ["install", "--frozen-lockfile"],
      };
  }
}

export async function resolveAppDependencyInstallPlan(args: {
  projectRoot: string;
  appRoot: string;
}): Promise<AppDependencyInstallPlan | null> {
  const packageJsonPath = resolve(args.appRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  const packageJson = await readPackageJson(packageJsonPath);
  if (countDeclaredDependencies(packageJson) === 0) {
    return null;
  }

  const lockfiles: Array<{ fileName: string; packageManager: AppPackageManager }> = [
    { fileName: "pnpm-lock.yaml", packageManager: "pnpm" },
    { fileName: "package-lock.json", packageManager: "npm" },
    { fileName: "yarn.lock", packageManager: "yarn" },
    { fileName: "bun.lockb", packageManager: "bun" },
    { fileName: "bun.lock", packageManager: "bun" },
  ];

  const matchingLockfile = lockfiles.find(({ fileName }) =>
    existsSync(resolve(args.appRoot, fileName)),
  );
  const packageManager = matchingLockfile?.packageManager ?? "pnpm";
  const lockfilePath = matchingLockfile
    ? resolve(args.appRoot, matchingLockfile.fileName)
    : null;
  const { command, args: installArgs } = resolveInstallCommand(
    packageManager,
    Boolean(lockfilePath),
  );

  return {
    appRoot: args.appRoot,
    relativeAppRoot: normalizeRelativePath(args.projectRoot, args.appRoot),
    packageJsonPath,
    packageManager,
    command,
    args: installArgs,
    fingerprint: await resolveFingerprint({
      packageJsonPath,
      packageManager,
      lockfilePath,
    }),
    nodeModulesPath: resolve(args.appRoot, "node_modules"),
    stampPath: resolve(args.appRoot, dependencyInstallStampRelativePath),
  };
}

async function readInstallStamp(
  stampPath: string,
): Promise<AppDependencyInstallStamp | null> {
  if (!existsSync(stampPath)) {
    return null;
  }

  try {
    return JSON.parse(
      await readFile(stampPath, "utf8"),
    ) as AppDependencyInstallStamp;
  } catch {
    return null;
  }
}

async function runInstall(
  plan: AppDependencyInstallPlan,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.appRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString("utf8")}`.slice(-12000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      const detail =
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? `Required package manager '${plan.command}' is not available on PATH.`
          : error instanceof Error
            ? error.message
            : String(error);
      rejectPromise(
        new Error(
          `Failed to install app dependencies for '${plan.relativeAppRoot}'. ${detail}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      const output = (stderr || stdout).trim();
      rejectPromise(
        new Error(
          [
            `Failed to install app dependencies for '${plan.relativeAppRoot}' with '${plan.command} ${plan.args.join(" ")}'.`,
            output ? `Output tail:\n${output}` : null,
          ]
            .filter((value): value is string => Boolean(value))
            .join("\n\n"),
        ),
      );
    });
  });
}

async function writeInstallStamp(plan: AppDependencyInstallPlan): Promise<void> {
  const stamp: AppDependencyInstallStamp = {
    version: 1,
    fingerprint: plan.fingerprint,
    packageManager: plan.packageManager,
    installedAt: new Date().toISOString(),
  };
  await mkdir(dirname(plan.stampPath), { recursive: true });
  await writeFile(plan.stampPath, `${JSON.stringify(stamp, null, 2)}\n`, "utf8");
}

export type EnsureAppDependenciesResult =
  | {
      installed: false;
      packageManager: AppPackageManager | null;
      relativeAppRoot: string;
      reason: string;
    }
  | {
      installed: true;
      packageManager: AppPackageManager;
      relativeAppRoot: string;
      reason: string;
    };

export async function ensureAppDependencies(args: {
  projectRoot: string;
  appRoot: string;
  logger?: (message: string) => void;
}): Promise<EnsureAppDependenciesResult> {
  const plan = await resolveAppDependencyInstallPlan(args);
  const relativeAppRoot = normalizeRelativePath(args.projectRoot, args.appRoot);
  if (!plan) {
    return {
      installed: false,
      packageManager: null,
      relativeAppRoot,
      reason: "no app-local dependencies declared",
    };
  }

  if (!existsSync(plan.nodeModulesPath)) {
    args.logger?.(
      `installing app dependencies in ${plan.relativeAppRoot} with ${plan.command} ${plan.args.join(" ")}`,
    );
    await runInstall(plan);
    await writeInstallStamp(plan);
    return {
      installed: true,
      packageManager: plan.packageManager,
      relativeAppRoot: plan.relativeAppRoot,
      reason: "node_modules was missing",
    };
  }

  const installStamp = await readInstallStamp(plan.stampPath);
  if (!installStamp || installStamp.fingerprint !== plan.fingerprint) {
    const reason = installStamp
      ? "package manifest or lockfile changed"
      : "dependency install stamp is missing";
    args.logger?.(
      `refreshing app dependencies in ${plan.relativeAppRoot} because ${reason}`,
    );
    await runInstall(plan);
    await writeInstallStamp(plan);
    return {
      installed: true,
      packageManager: plan.packageManager,
      relativeAppRoot: plan.relativeAppRoot,
      reason,
    };
  }

  return {
    installed: false,
    packageManager: plan.packageManager,
    relativeAppRoot: plan.relativeAppRoot,
    reason: "dependencies already installed",
  };
}
