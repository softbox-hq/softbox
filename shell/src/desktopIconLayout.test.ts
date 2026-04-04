import { describe, expect, it } from "vitest";
import {
  getDesktopGridMetrics,
  moveDesktopIconToSlot,
  normalizeDesktopIconLayout,
  parseDesktopIconLayout,
  parseDesktopSlotId,
} from "./desktopIconLayout";

describe("parseDesktopIconLayout", () => {
  it("returns null for malformed input", () => {
    expect(parseDesktopIconLayout("{")).toBeNull();
  });

  it("keeps only valid slot assignments", () => {
    expect(
      parseDesktopIconLayout(
        JSON.stringify({
          dashboard: 0,
          space: -1,
          snake: 2.5,
          pretext: 3,
        }),
      ),
    ).toEqual({
      dashboard: 0,
      pretext: 3,
    });
  });
});

describe("normalizeDesktopIconLayout", () => {
  it("preserves valid slots and fills missing apps into free slots", () => {
    expect(
      normalizeDesktopIconLayout(
        ["dashboard", "space", "snake"],
        {
          dashboard: 2,
          space: 2,
        },
      ),
    ).toEqual({
      dashboard: 2,
      space: 0,
      snake: 1,
    });
  });
});

describe("moveDesktopIconToSlot", () => {
  it("swaps icons when the target slot is occupied", () => {
    expect(
      moveDesktopIconToSlot(
        ["dashboard", "space"],
        {
          dashboard: 0,
          space: 1,
        },
        "dashboard",
        1,
      ),
    ).toEqual({
      dashboard: 1,
      space: 0,
    });
  });
});

describe("getDesktopGridMetrics", () => {
  it("keeps enough rows for off-screen persisted slots", () => {
    expect(
      getDesktopGridMetrics({
        width: 1400,
        height: 200,
        appCount: 2,
        assignedSlots: [0, 9],
      }),
    ).toMatchObject({
      columns: 4,
      rows: 3,
      slotCount: 12,
    });
  });
});

describe("parseDesktopSlotId", () => {
  it("parses valid slot ids", () => {
    expect(parseDesktopSlotId("desktop-slot:7")).toBe(7);
  });

  it("rejects invalid slot ids", () => {
    expect(parseDesktopSlotId("space")).toBeNull();
  });
});
