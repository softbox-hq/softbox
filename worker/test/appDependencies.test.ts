import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureAppDependencies,
  resolveAppDependencyInstallPlan,
} from "../src/appDependencies";

const tempRoots: string[] = [];

async function createApp(args: {
  packageJson: Record<string, unknown>;
  extraFiles?: Record<string, string>;
}): Promise<{
  projectRoot: string;
  appRoot: string;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "softbox-app-deps-"));
  tempRoots.push(projectRoot);
  const appRoot = resolve(projectRoot, "apps", "demo");
  await mkdir(appRoot, { recursive: true });
  await writeFile(
    resolve(appRoot, "package.json"),
    `${JSON.stringify(args.packageJson, null, 2)}\n`,
    "utf8",
  );

  for (const [relativePath, source] of Object.entries(args.extraFiles ?? {})) {
    const filePath = resolve(appRoot, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, source, "utf8");
  }

  return {
    projectRoot,
    appRoot,
  };
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("resolveAppDependencyInstallPlan", () => {
  it("uses pnpm when a pnpm lockfile is present", async () => {
    const { projectRoot, appRoot } = await createApp({
      packageJson: {
        name: "demo",
        dependencies: {
          react: "^19.2.4",
        },
      },
      extraFiles: {
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      },
    });

    const plan = await resolveAppDependencyInstallPlan({ projectRoot, appRoot });
    expect(plan).toEqual(
      expect.objectContaining({
        packageManager: "pnpm",
        command: "pnpm",
        args: ["install", "--frozen-lockfile"],
      }),
    );
  });

  it("uses npm when a package-lock is present", async () => {
    const { projectRoot, appRoot } = await createApp({
      packageJson: {
        name: "demo",
        dependencies: {
          react: "^19.2.4",
        },
      },
      extraFiles: {
        "package-lock.json": "{\n  \"name\": \"demo\"\n}\n",
      },
    });

    const plan = await resolveAppDependencyInstallPlan({ projectRoot, appRoot });
    expect(plan).toEqual(
      expect.objectContaining({
        packageManager: "npm",
        command: "npm",
        args: ["ci"],
      }),
    );
  });
});

describe("ensureAppDependencies", () => {
  it("skips apps without app-local dependencies", async () => {
    const { projectRoot, appRoot } = await createApp({
      packageJson: {
        name: "demo",
      },
    });

    await expect(
      ensureAppDependencies({ projectRoot, appRoot }),
    ).resolves.toEqual(
      expect.objectContaining({
        installed: false,
        packageManager: null,
        reason: "no app-local dependencies declared",
      }),
    );
  });

  it("skips reinstall when node_modules and a matching install stamp already exist", async () => {
    const { projectRoot, appRoot } = await createApp({
      packageJson: {
        name: "demo",
        dependencies: {
          react: "^19.2.4",
        },
      },
      extraFiles: {
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      },
    });
    const plan = await resolveAppDependencyInstallPlan({ projectRoot, appRoot });
    expect(plan).not.toBeNull();

    await mkdir(resolve(appRoot, "node_modules"), { recursive: true });
    await mkdir(dirname(plan!.stampPath), { recursive: true });
    await writeFile(
      plan!.stampPath,
      `${JSON.stringify(
        {
          version: 1,
          fingerprint: plan!.fingerprint,
          packageManager: plan!.packageManager,
          installedAt: "2026-04-01T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      ensureAppDependencies({ projectRoot, appRoot }),
    ).resolves.toEqual(
      expect.objectContaining({
        installed: false,
        packageManager: "pnpm",
        reason: "dependencies already installed",
      }),
    );
  });
});
