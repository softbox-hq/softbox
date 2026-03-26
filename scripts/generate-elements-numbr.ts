import { createInterface } from "node:readline";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type MinorPlanetRow = {
  number: number;
  name: string;
  semiMajorAxisAu: number;
  eccentricity: number;
  inclinationDeg: number;
  argumentOfPerihelionDeg: number;
  ascendingNodeDeg: number;
  meanAnomalyDeg: number;
  absoluteMagnitude: number;
};

const sourcePath = resolve(process.cwd(), "apps/live-app-template/ELEMENTS.NUMBR");
const outputPath = resolve(
  process.cwd(),
  "apps/live-app-template/src/generated/sceneObjects.ts",
);
const auToWorldUnits = 4;

type GeneratorOptions = {
  limit: number;
  nameIncludes: string | null;
  minSemiMajorAxisAu: number | null;
  maxSemiMajorAxisAu: number | null;
  maxAbsoluteMagnitude: number | null;
};

function parseArgs(argv: string[]): GeneratorOptions {
  const options: GeneratorOptions = {
    limit: 50,
    nameIncludes: null,
    minSemiMajorAxisAu: null,
    maxSemiMajorAxisAu: null,
    maxAbsoluteMagnitude: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (/^\d+$/.test(arg)) {
      options.limit = Number.parseInt(arg, 10);
      continue;
    }

    if (arg === "--limit") {
      options.limit = Number.parseInt(argv[index + 1] ?? "", 10);
      index += 1;
      continue;
    }

    if (arg === "--name-includes") {
      options.nameIncludes = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--min-a") {
      options.minSemiMajorAxisAu = Number.parseFloat(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (arg === "--max-a") {
      options.maxSemiMajorAxisAu = Number.parseFloat(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (arg === "--max-h") {
      options.maxAbsoluteMagnitude = Number.parseFloat(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.limit) || options.limit <= 0) {
    throw new Error(`Invalid limit: ${options.limit}`);
  }

  return options;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function solveEccentricAnomaly(meanAnomalyRad: number, eccentricity: number) {
  let eccentricAnomaly = meanAnomalyRad;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const delta =
      (eccentricAnomaly -
        eccentricity * Math.sin(eccentricAnomaly) -
        meanAnomalyRad) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= delta;

    if (Math.abs(delta) < 1e-8) {
      break;
    }
  }

  return eccentricAnomaly;
}

function parseRow(line: string): MinorPlanetRow | null {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("Num") || trimmed.startsWith("------")) {
    return null;
  }

  const row = {
    number: Number.parseInt(line.slice(0, 6).trim(), 10),
    name: line.slice(7, 24).trim(),
    semiMajorAxisAu: Number.NaN,
    eccentricity: Number.NaN,
    inclinationDeg: Number.NaN,
    argumentOfPerihelionDeg: Number.NaN,
    ascendingNodeDeg: Number.NaN,
    meanAnomalyDeg: Number.NaN,
    absoluteMagnitude: Number.NaN,
  };

  const numericFields = line.slice(24).trim().split(/\s+/);

  row.semiMajorAxisAu = Number.parseFloat(numericFields[1] ?? "");
  row.eccentricity = Number.parseFloat(numericFields[2] ?? "");
  row.inclinationDeg = Number.parseFloat(numericFields[3] ?? "");
  row.argumentOfPerihelionDeg = Number.parseFloat(numericFields[4] ?? "");
  row.ascendingNodeDeg = Number.parseFloat(numericFields[5] ?? "");
  row.meanAnomalyDeg = Number.parseFloat(numericFields[6] ?? "");
  row.absoluteMagnitude = Number.parseFloat(numericFields[7] ?? "");

  if (
    !Number.isFinite(row.number) ||
    !row.name ||
    !Number.isFinite(row.semiMajorAxisAu) ||
    !Number.isFinite(row.eccentricity) ||
    !Number.isFinite(row.inclinationDeg) ||
    !Number.isFinite(row.argumentOfPerihelionDeg) ||
    !Number.isFinite(row.ascendingNodeDeg) ||
    !Number.isFinite(row.meanAnomalyDeg) ||
    !Number.isFinite(row.absoluteMagnitude)
  ) {
    return null;
  }

  return row;
}

function orbitalPosition(row: MinorPlanetRow) {
  const meanAnomalyRad = toRadians(row.meanAnomalyDeg);
  const inclinationRad = toRadians(row.inclinationDeg);
  const argumentOfPerihelionRad = toRadians(row.argumentOfPerihelionDeg);
  const ascendingNodeRad = toRadians(row.ascendingNodeDeg);
  const eccentricAnomaly = solveEccentricAnomaly(
    meanAnomalyRad,
    row.eccentricity,
  );

  const xPrime =
    row.semiMajorAxisAu * (Math.cos(eccentricAnomaly) - row.eccentricity);
  const yPrime =
    row.semiMajorAxisAu *
    Math.sqrt(1 - row.eccentricity ** 2) *
    Math.sin(eccentricAnomaly);

  const cosOmega = Math.cos(ascendingNodeRad);
  const sinOmega = Math.sin(ascendingNodeRad);
  const cosI = Math.cos(inclinationRad);
  const sinI = Math.sin(inclinationRad);
  const cosW = Math.cos(argumentOfPerihelionRad);
  const sinW = Math.sin(argumentOfPerihelionRad);

  const xOrbital = xPrime * cosW - yPrime * sinW;
  const yOrbital = xPrime * sinW + yPrime * cosW;

  const x =
    (cosOmega * xOrbital - sinOmega * yOrbital * cosI) * auToWorldUnits;
  const y = (yOrbital * sinI) * auToWorldUnits;
  const z =
    (sinOmega * xOrbital + cosOmega * yOrbital * cosI) * auToWorldUnits;

  return { x, y, z };
}

function objectScale(row: MinorPlanetRow) {
  const size = 0.12 + Math.max(0, 10 - row.absoluteMagnitude) * 0.045;
  const clamped = Math.max(0.12, Math.min(0.42, size));
  return Number(clamped.toFixed(3));
}

function objectColor(row: MinorPlanetRow) {
  const hue = Math.round(
    210 - Math.min(120, row.semiMajorAxisAu * 20 + row.inclinationDeg * 1.5),
  );
  return `hsl(${hue} 85% 68%)`;
}

function matchesFilters(row: MinorPlanetRow, options: GeneratorOptions) {
  if (
    options.nameIncludes &&
    !row.name.toLowerCase().includes(options.nameIncludes.toLowerCase())
  ) {
    return false;
  }

  if (
    options.minSemiMajorAxisAu !== null &&
    row.semiMajorAxisAu < options.minSemiMajorAxisAu
  ) {
    return false;
  }

  if (
    options.maxSemiMajorAxisAu !== null &&
    row.semiMajorAxisAu > options.maxSemiMajorAxisAu
  ) {
    return false;
  }

  if (
    options.maxAbsoluteMagnitude !== null &&
    row.absoluteMagnitude > options.maxAbsoluteMagnitude
  ) {
    return false;
  }

  return true;
}

async function readRows(options: GeneratorOptions) {
  const rows: MinorPlanetRow[] = [];
  const reader = createInterface({
    input: createReadStream(sourcePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    const parsed = parseRow(line);

    if (!parsed) {
      continue;
    }

    if (!matchesFilters(parsed, options)) {
      continue;
    }

    rows.push(parsed);

    if (rows.length >= options.limit) {
      reader.close();
      break;
    }
  }

  return rows;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = await readRows(options);
  const filterSummary = [
    `limit=${options.limit}`,
    options.nameIncludes ? `nameIncludes=${JSON.stringify(options.nameIncludes)}` : null,
    options.minSemiMajorAxisAu !== null
      ? `minA=${options.minSemiMajorAxisAu}`
      : null,
    options.maxSemiMajorAxisAu !== null
      ? `maxA=${options.maxSemiMajorAxisAu}`
      : null,
    options.maxAbsoluteMagnitude !== null
      ? `maxH=${options.maxAbsoluteMagnitude}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  const objectsSource = rows
    .map((row) => {
      const position = orbitalPosition(row);
      const scale = objectScale(row);

      return `  {
    id: "minor-planet-${row.number}",
    label: "${row.name.replaceAll('"', '\\"')}",
    shape: "sphere",
    position: { x: ${position.x.toFixed(3)}, y: ${position.y.toFixed(3)}, z: ${position.z.toFixed(3)} },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: ${scale}, y: ${scale}, z: ${scale} },
    color: "${objectColor(row)}",
  }`;
    })
    .join(",\n");

  const source = `import type { SceneObject } from "../types";

// Generated from apps/live-app-template/ELEMENTS.NUMBR by scripts/generate-elements-numbr.ts.
// Filters: ${filterSummary}.
// This file contains ${rows.length} rows converted from orbital elements
// into approximate heliocentric scene positions at the catalog epoch.
export const generatedSceneObjects: SceneObject[] = [
  {
    id: "sun",
    label: "Sun",
    shape: "sphere",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1.8, y: 1.8, z: 1.8 },
    color: "#fbbf24",
  },
${objectsSource}
];
`;

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, source, "utf8");
  process.stdout.write(
    `Generated ${rows.length} objects at ${outputPath} using ${filterSummary}\\n`,
  );
}

void main();
