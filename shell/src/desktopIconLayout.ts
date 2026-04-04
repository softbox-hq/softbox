export const desktopIconLayoutStorageKey = "softbox:desktop-icon-layout:v1";
export const desktopIconSlotHeightPx = 132;
const maxPersistedSlotIndex = 511;

export type DesktopIconLayout = Record<string, number>;

export function parseDesktopIconLayout(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const nextLayout: DesktopIconLayout = {};
    for (const [appId, slotIndex] of Object.entries(parsed)) {
      if (
        typeof appId === "string" &&
        typeof slotIndex === "number" &&
        Number.isInteger(slotIndex) &&
        slotIndex >= 0 &&
        slotIndex <= maxPersistedSlotIndex
      ) {
        nextLayout[appId] = slotIndex;
      }
    }

    return nextLayout;
  } catch {
    return null;
  }
}

export function normalizeDesktopIconLayout(
  appIds: string[],
  savedLayout: DesktopIconLayout | null | undefined,
) {
  const nextLayout: DesktopIconLayout = {};
  const usedSlots = new Set<number>();

  for (const appId of appIds) {
    const slotIndex = savedLayout?.[appId];
    if (
      typeof slotIndex === "number" &&
      Number.isInteger(slotIndex) &&
      slotIndex >= 0 &&
      slotIndex <= maxPersistedSlotIndex &&
      !usedSlots.has(slotIndex)
    ) {
      nextLayout[appId] = slotIndex;
      usedSlots.add(slotIndex);
      continue;
    }

    let nextSlotIndex = 0;
    while (usedSlots.has(nextSlotIndex)) {
      nextSlotIndex += 1;
    }
    nextLayout[appId] = nextSlotIndex;
    usedSlots.add(nextSlotIndex);
  }

  return nextLayout;
}

export function moveDesktopIconToSlot(
  appIds: string[],
  layout: DesktopIconLayout,
  appId: string,
  targetSlotIndex: number,
) {
  const nextLayout = normalizeDesktopIconLayout(appIds, layout);
  const sourceSlotIndex = nextLayout[appId];

  if (sourceSlotIndex === undefined || sourceSlotIndex === targetSlotIndex) {
    return nextLayout;
  }

  const displacedAppId =
    appIds.find(
      (candidateAppId) =>
        candidateAppId !== appId && nextLayout[candidateAppId] === targetSlotIndex,
    ) ?? null;

  nextLayout[appId] = targetSlotIndex;

  if (displacedAppId) {
    nextLayout[displacedAppId] = sourceSlotIndex;
  }

  return nextLayout;
}

export function getDesktopColumnCount(width: number) {
  if (width <= 0) {
    return 4;
  }
  if (width >= 1280) {
    return 4;
  }
  if (width >= 1024) {
    return 3;
  }
  if (width >= 640) {
    return 2;
  }
  return 1;
}

export function getDesktopGridMetrics(args: {
  width: number;
  height: number;
  appCount: number;
  assignedSlots: number[];
}) {
  const { width, height, appCount, assignedSlots } = args;
  const columns = getDesktopColumnCount(width);
  const visibleRows = Math.max(3, Math.ceil(Math.max(height, desktopIconSlotHeightPx) / desktopIconSlotHeightPx));
  const appRows = Math.max(1, Math.ceil(appCount / columns));
  const highestAssignedSlotIndex = assignedSlots.length > 0 ? Math.max(...assignedSlots) : -1;
  const assignedRows =
    highestAssignedSlotIndex >= 0
      ? Math.floor(highestAssignedSlotIndex / columns) + 1
      : 0;
  const rows = Math.max(visibleRows, appRows, assignedRows);

  return {
    columns,
    rows,
    slotCount: columns * rows,
    fieldHeight: rows * desktopIconSlotHeightPx,
  };
}

export function getDesktopSlotId(slotIndex: number) {
  return `desktop-slot:${slotIndex}`;
}

export function parseDesktopSlotId(value: string | null | undefined) {
  if (!value?.startsWith("desktop-slot:")) {
    return null;
  }

  const slotIndex = Number.parseInt(value.slice("desktop-slot:".length), 10);
  return Number.isInteger(slotIndex) && slotIndex >= 0 ? slotIndex : null;
}
