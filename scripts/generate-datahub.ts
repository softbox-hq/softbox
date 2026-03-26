import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type GeneratorOptions = {
  baseUrl: string;
  bodies: string[];
  date: string;
  view: "fit" | "focus";
  focusBodyId?: string;
};

type DatahubSceneObject = {
  id: string;
  label: string;
  kind: "star" | "planet" | "moon";
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  color: string;
};

type DatahubSceneResponse = {
  objects: DatahubSceneObject[];
  camera: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    fov: number;
  };
  meta: {
    resolved_bodies: string[];
    requested_bodies: string[];
    source: string;
    cache_hit: boolean;
    date: string | null;
  };
};

const outputPath = resolve(
  process.cwd(),
  "apps/live-app-template/src/generated/sceneObjects.ts",
);
const configOutputPath = resolve(
  process.cwd(),
  "apps/live-app-template/src/generated/sceneConfig.ts",
);

function parseArgs(argv: string[]): GeneratorOptions {
  const options: GeneratorOptions = {
    baseUrl: process.env.DATAHUB_BASE_URL?.trim() || "http://127.0.0.1:3001",
    bodies: ["earth", "moon", "jupiter"],
    date: "2026-03-19",
    view: "fit",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--base-url") {
      options.baseUrl = argv[index + 1] ?? options.baseUrl;
      index += 1;
      continue;
    }

    if (arg === "--bodies") {
      options.bodies = (argv[index + 1] ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (arg === "--date") {
      options.date = argv[index + 1] ?? options.date;
      index += 1;
      continue;
    }

    if (arg === "--view") {
      const value = argv[index + 1] ?? options.view;
      if (value !== "fit" && value !== "focus") {
        throw new Error(`Unsupported --view "${value}". Use "fit" or "focus".`);
      }
      options.view = value;
      index += 1;
      continue;
    }

    if (arg === "--focus-body-id") {
      options.focusBodyId = argv[index + 1]?.trim().toLowerCase() || undefined;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.bodies.length === 0) {
    throw new Error("At least one body is required.");
  }

  return options;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot serialize non-finite number: ${value}`);
  }
  return Number(value.toFixed(6)).toString();
}

function toSourceObject(object: DatahubSceneObject): string {
  return `  {
    id: ${JSON.stringify(object.id)},
    label: ${JSON.stringify(object.label)},
    shape: "sphere",
    position: { x: ${formatNumber(object.position.x)}, y: ${formatNumber(object.position.y)}, z: ${formatNumber(object.position.z)} },
    rotation: { x: ${formatNumber(object.rotation.x)}, y: ${formatNumber(object.rotation.y)}, z: ${formatNumber(object.rotation.z)} },
    scale: { x: ${formatNumber(object.scale.x)}, y: ${formatNumber(object.scale.y)}, z: ${formatNumber(object.scale.z)} },
    color: ${JSON.stringify(object.color)},
  }`;
}

async function fetchScene(options: GeneratorOptions): Promise<DatahubSceneResponse> {
  const response = await fetch(`${options.baseUrl.replace(/\/+$/, "")}/scene/solar-system`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      bodies: options.bodies,
      date: options.date,
      view: options.view,
      ...(options.focusBodyId ? { focus_body_id: options.focusBodyId } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Datahub scene request failed with ${response.status}: ${detail.trim()}`,
    );
  }

  return (await response.json()) as DatahubSceneResponse;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scene = await fetchScene(options);
  const objectsSource = scene.objects.map(toSourceObject).join(",\n");

  const source = `import type { SceneObject } from "../types";

// Generated from datahub by scripts/generate-datahub.ts.
// Base URL: ${options.baseUrl}
// Bodies: ${scene.meta.resolved_bodies.join(", ")}
// Date: ${scene.meta.date ?? options.date}
// View: ${options.view}${options.focusBodyId ? ` (${options.focusBodyId})` : ""}
export const generatedSceneObjects: SceneObject[] = [
${objectsSource}
];
`;
  const cameraSource = `import type { Vector3Like } from "../types";

// Generated from datahub by scripts/generate-datahub.ts.
export const generatedCamera = {
  position: { x: ${formatNumber(scene.camera.position.x)}, y: ${formatNumber(scene.camera.position.y)}, z: ${formatNumber(scene.camera.position.z)} } satisfies Vector3Like,
  target: { x: ${formatNumber(scene.camera.target.x)}, y: ${formatNumber(scene.camera.target.y)}, z: ${formatNumber(scene.camera.target.z)} } satisfies Vector3Like,
  fov: ${formatNumber(scene.camera.fov)},
};

export const generatedSelectedObjectId: string | null = ${
    options.view === "focus" && options.focusBodyId
      ? JSON.stringify(scene.meta.resolved_bodies.find((body) => body === options.focusBodyId) ?? null)
      : "null"
  };
`;

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, source, "utf8");
  writeFileSync(configOutputPath, cameraSource, "utf8");
  process.stdout.write(
    `Generated ${scene.objects.length} scene object(s) from datahub at ${outputPath}\n`,
  );
}

void main();
