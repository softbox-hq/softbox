import { describe, expect, it } from "vitest";
import {
  defaultDesktopWallpaperPreference,
  getDesktopWallpaper,
  parseDesktopWallpaperPreference,
  resolveDesktopWallpaperPreference,
} from "./desktopWallpaper";

describe("parseDesktopWallpaperPreference", () => {
  it("returns null for malformed input", () => {
    expect(parseDesktopWallpaperPreference("{")).toBeNull();
  });

  it("parses valid wallpaper preferences", () => {
    expect(
      parseDesktopWallpaperPreference(
        JSON.stringify({
          wallpaperId: "classic",
          fit: "contain",
        }),
      ),
    ).toEqual({
      wallpaperId: "classic",
      fit: "contain",
    });
  });
});

describe("resolveDesktopWallpaperPreference", () => {
  it("falls back to the default preference when the payload is invalid", () => {
    expect(
      resolveDesktopWallpaperPreference({
        wallpaperId: "missing",
        fit: "stretch" as "cover",
      }),
    ).toEqual(defaultDesktopWallpaperPreference);
  });
});

describe("getDesktopWallpaper", () => {
  it("falls back to the default wallpaper when the id is missing", () => {
    expect(getDesktopWallpaper("missing").id).toBe(defaultDesktopWallpaperPreference.wallpaperId);
  });
});
