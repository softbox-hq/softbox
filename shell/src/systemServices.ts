export type SystemService = {
  name: string;
  role: string;
  detail: string;
};

export const systemServices: SystemService[] = [
  {
    name: "Convex",
    role: "Control plane",
    detail: "Stores apps, jobs, versions, runtime state, and shell selection.",
  },
  {
    name: "Redis",
    role: "Queue storage",
    detail: "Persists BullMQ queue state for the worker pipeline.",
  },
  {
    name: "BullMQ",
    role: "Job queue",
    detail: "Schedules and runs prompt-driven jobs on top of Redis.",
  },
  {
    name: "Worker",
    role: "Pipeline runner",
    detail: "Claims jobs, invokes the agent, builds apps, and publishes results.",
  },
  {
    name: "OpenClaw",
    role: "Agent engine",
    detail: "Performs code-editing runs for hosted Softbox apps.",
  },
  {
    name: "Cloudflare R2",
    role: "Artifact storage",
    detail: "Stores immutable build artifacts used for preview and live versions.",
  },
];
