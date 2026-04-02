export type ShellHostEmptyStateContent = {
  eyebrow: string;
  title: string;
  body: string;
  steps: string[];
};

export const shellHostEmptyStateContent = {
  noMountedApp: {
    eyebrow: "DESKTOP",
    title: "Nothing mounted",
    body: "Your shell is running, but no app is currently mounted.",
    steps: [
      "Open Apps and mount an existing app.",
      "Or keep the shell empty until you are ready to mount one.",
    ],
  },
  noActiveVersion: {
    eyebrow: "DESKTOP",
    title: "No App Loaded",
    body: "The shell is running, but there is no hosted app mounted yet.",
    steps: [
      "Open Apps and choose what you want to mount.",
      "Or wait here while the shell finishes loading.",
    ],
  },
  noShellState: {
    eyebrow: "DESKTOP",
    title: "No App Loaded",
    body: "The shell is running, but there is no hosted app mounted yet.",
    steps: [
      "Seed or register an app so the shell has something to load.",
      "Then mount it from the Apps menu.",
    ],
  },
} satisfies Record<string, ShellHostEmptyStateContent>;
