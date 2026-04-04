export const desktopWallpaperStorageKey = "softbox:desktop-wallpaper:v1";

export type DesktopWallpaperFit = "cover" | "contain";

export type DesktopWallpaperPreference = {
  wallpaperId: string;
  fit: DesktopWallpaperFit;
};

export type DesktopWallpaperOption = {
  id: string;
  label: string;
  description: string;
  src: string;
  backgroundColor?: string;
};

export const desktopWallpaperOptions: DesktopWallpaperOption[] = [
  {
    id: "poster",
    label: "Poster",
    description: "The bold black-and-magenta Softbox poster wallpaper.",
    src: "/desktop.png",
    backgroundColor: "#000000",
  },
  {
    id: "dark",
    label: "Dark",
    description: "A darker Softbox variation with more negative space.",
    src: "/desktop2.png",
    backgroundColor: "#000000",
  },
  {
    id: "classic",
    label: "Classic",
    description: "The retro Softbox wallpaper from the earlier desktop.",
    src: "/desktop5.jpg",
    backgroundColor: "#000000",
  },
  {
    id: "bauhaus",
    label: "Classic",
    description: "The retro Softbox wallpaper from the earlier desktop.",
    src: "/desktop6.png",
    backgroundColor: "#000000",
  },
];

const validWallpaperIds = new Set(desktopWallpaperOptions.map((wallpaper) => wallpaper.id));
const validFits = new Set<DesktopWallpaperFit>(["cover", "contain"]);

export const defaultDesktopWallpaperPreference: DesktopWallpaperPreference = {
  wallpaperId: desktopWallpaperOptions[0].id,
  fit: "cover",
};

export function resolveDesktopWallpaperPreference(
  value: DesktopWallpaperPreference | null | undefined,
) {
  return {
    wallpaperId:
      value?.wallpaperId && validWallpaperIds.has(value.wallpaperId)
        ? value.wallpaperId
        : defaultDesktopWallpaperPreference.wallpaperId,
    fit:
      value?.fit && validFits.has(value.fit)
        ? value.fit
        : defaultDesktopWallpaperPreference.fit,
  } satisfies DesktopWallpaperPreference;
}

export function parseDesktopWallpaperPreference(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const wallpaperId =
      typeof (parsed as { wallpaperId?: unknown }).wallpaperId === "string"
        ? (parsed as { wallpaperId: string }).wallpaperId
        : null;
    const fit =
      typeof (parsed as { fit?: unknown }).fit === "string"
        ? (parsed as { fit: string }).fit
        : null;

    if (!wallpaperId || !fit) {
      return null;
    }

    return resolveDesktopWallpaperPreference({
      wallpaperId,
      fit: fit as DesktopWallpaperFit,
    });
  } catch {
    return null;
  }
}

export function getDesktopWallpaper(wallpaperId: string) {
  return (
    desktopWallpaperOptions.find((wallpaper) => wallpaper.id === wallpaperId) ??
    desktopWallpaperOptions[0]
  );
}
