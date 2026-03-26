import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type HorizonsBodyConfig = {
  id: string;
  label: string;
  color: string;
  radiusKm: number;
};

type GeneratorOptions = {
  bodies: string[];
  date: string;
};

const outputPath = resolve(
  process.cwd(),
  "apps/live-app-template/src/generated/sceneObjects.ts",
);
const horizonsApiBase = "https://ssd.jpl.nasa.gov/api/horizons.api";
const kilometersToWorldUnits = 1 / 100_000;

const supportedBodies: Record<string, HorizonsBodyConfig> = {
  sun: { id: "10", label: "Sun", color: "#fbbf24", radiusKm: 695_700 },
  mercury: { id: "199", label: "Mercury", color: "#94a3b8", radiusKm: 2_439.7 },
  venus: { id: "299", label: "Venus", color: "#f59e0b", radiusKm: 6_051.8 },
  earth: { id: "399", label: "Earth", color: "#2563eb", radiusKm: 6_371 },
  moon: { id: "301", label: "Moon", color: "#d4d4d8", radiusKm: 1_737.4 },
  mars: { id: "499", label: "Mars", color: "#ef4444", radiusKm: 3_389.5 },
  jupiter: { id: "599", label: "Jupiter", color: "#a16207", radiusKm: 69_911 },
  io: { id: "501", label: "Io", color: "#fde68a", radiusKm: 1_821.6 },
  europa: { id: "502", label: "Europa", color: "#cbd5e1", radiusKm: 1_560.8 },
  ganymede: { id: "503", label: "Ganymede", color: "#94a3b8", radiusKm: 2_634.1 },
  callisto: { id: "504", label: "Callisto", color: "#78716c", radiusKm: 2_410.3 },
  saturn: { id: "699", label: "Saturn", color: "#d6b87c", radiusKm: 58_232 },
  titan: { id: "606", label: "Titan", color: "#fbbf24", radiusKm: 2_574.7 },
  uranus: { id: "799", label: "Uranus", color: "#67e8f9", radiusKm: 25_362 },
  neptune: { id: "899", label: "Neptune", color: "#2563eb", radiusKm: 24_622 },
};

function nextIsoDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): GeneratorOptions {
  const options: GeneratorOptions = {
    bodies: ["sun", "earth", "moon", "jupiter"],
    date: "2026-03-19",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.bodies.length === 0) {
    throw new Error("At least one body is required.");
  }

  return options;
}

function scaleFromRadius(radiusKm: number) {
  const scaled = radiusKm * kilometersToWorldUnits;
  return Number(Math.max(0.14, Math.min(4.5, scaled)).toFixed(3));
}

function buildQuery(bodyId: string, date: string) {
  const stopDate = nextIsoDate(date);
  const params = new URLSearchParams({
    format: "json",
    COMMAND: `'${bodyId}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@10'",
    START_TIME: `'${date}'`,
    STOP_TIME: `'${stopDate}'`,
    STEP_SIZE: "'1d'",
    VEC_TABLE: "'1'",
  });

  return `${horizonsApiBase}?${params.toString()}`;
}

function parseVectorResult(result: string) {
  const match = result.match(
    /X =\s*([+\-0-9.E]+)\s+Y =\s*([+\-0-9.E]+)\s+Z =\s*([+\-0-9.E]+)/,
  );

  if (!match) {
    throw new Error("Could not parse Horizons vector result.");
  }

  return {
    x: Number.parseFloat(match[1]),
    y: Number.parseFloat(match[2]),
    z: Number.parseFloat(match[3]),
  };
}

async function fetchBodyPosition(body: HorizonsBodyConfig, date: string) {
  const response = await fetch(buildQuery(body.id, date));

  if (!response.ok) {
    throw new Error(`Horizons request failed for ${body.label}: ${response.status}`);
  }

  const payload = (await response.json()) as { result?: string };

  if (!payload.result) {
    throw new Error(`Horizons returned no result for ${body.label}.`);
  }

  return parseVectorResult(payload.result);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const bodies = options.bodies.map((key) => {
    const config = supportedBodies[key];

    if (!config) {
      throw new Error(
        `Unsupported body "${key}". Supported: ${Object.keys(supportedBodies).join(", ")}`,
      );
    }

    return config;
  });

  const positions = await Promise.all(
    bodies.map(async (body) => ({
      body,
      position: await fetchBodyPosition(body, options.date),
    })),
  );

  const objectsSource = positions
    .map(({ body, position }) => {
      const scale = scaleFromRadius(body.radiusKm);

      return `  {
    id: "horizons-${body.label.toLowerCase()}",
    label: "${body.label}",
    shape: "sphere",
    position: { x: ${(position.x / 100_000_000).toFixed(3)}, y: ${(position.z / 100_000_000).toFixed(3)}, z: ${(position.y / 100_000_000).toFixed(3)} },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: ${scale}, y: ${scale}, z: ${scale} },
    color: "${body.color}",
  }`;
    })
    .join(",\n");

  const source = `import type { SceneObject } from "../types";

// Generated from NASA/JPL Horizons by scripts/generate-horizons.ts.
// Bodies: ${bodies.map((body) => body.label).join(", ")}.
// Date: ${options.date}.
export const generatedSceneObjects: SceneObject[] = [
${objectsSource}
];
`;

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, source, "utf8");
  process.stdout.write(
    `Generated ${bodies.length} Horizons bodies at ${outputPath} for ${options.date}\n`,
  );
}

void main();
