import { startTransition, useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpFromLine, Check, Crosshair, Trash2 } from "lucide-react";
import { convexApi } from "@shared/convexApi";
import type { LiveAppState } from "@shared/liveApp";
import { defaultAppId, defaultShellId } from "@shared/liveApp";
import { useLiveAppRuntime } from "./runtime";
import { getOrCreateShellId } from "./shellId";
import { getRuntimeStatus } from "./state";
import "./styles.css";

type CompareableVersionRecord = {
  _id: string;
  versionNumber: number;
  status: string;
  runtimeHealth: string;
  createdAt: number;
  manifestUrl: string;
  stateJson: string;
  agentResult?: {
    summary?: string | null;
  } | null;
};

function formatDuration(durationMs: number | null | undefined) {
  if (typeof durationMs !== "number" || Number.isNaN(durationMs)) {
    return "running";
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`;
}

function formatTimestamp(timestamp: number | null | undefined) {
  if (typeof timestamp !== "number" || Number.isNaN(timestamp)) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatBoxSummary(box: {
  boxId: string;
  appId?: string | null;
  engine: string;
  engineProfile?: { name: string } | null;
  providerProfile?: { name: string } | null;
  agentId: string | null;
  status: string;
  model: string | null;
  lastRunAt: number | null;
}) {
  const parts = [
    `Box ${box.engineProfile?.name ?? box.engine}`,
    box.providerProfile?.name ?? null,
    box.agentId,
    box.status,
    box.model ?? "default",
    box.lastRunAt ? formatTimestamp(box.lastRunAt) : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" · ");
}

function isPrimaryBox(box: { boxId: string; engine: string; appId?: string | null }) {
  if (!box.appId) {
    return false;
  }
  return box.boxId === `${box.engine}:${box.appId}`;
}

function formatBoxLabel(box: {
  boxId: string;
  appId?: string | null;
  policy?: { role?: string | null } | null;
}) {
  const explicitRole = box.policy?.role?.trim();
  if (explicitRole) {
    return explicitRole;
  }

  const appId = box.appId?.trim();
  if (appId && box.boxId.endsWith(`:${appId}`)) {
    return "default";
  }

  const segments = box.boxId.split(":");
  return segments.slice(2).join(":") || segments[segments.length - 1] || box.boxId;
}

function toggleStringSelection(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value];
}

function buildCompareFrameDoc(version: CompareableVersionRecord) {
  const payload = JSON.stringify({
    manifestUrl: version.manifestUrl,
    stateJson: version.stateJson,
    versionNumber: version.versionNumber,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        min-height: 100%;
        background: #050505;
        color: #e5e7eb;
        font-family: Inter, system-ui, sans-serif;
      }

      body {
        min-height: 100vh;
      }

      #root {
        min-height: 100vh;
      }

      #status {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 9999;
        max-width: min(420px, calc(100vw - 32px));
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(12, 12, 15, 0.92);
        padding: 12px 14px;
        font-size: 12px;
        line-height: 1.5;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.32);
      }

      #status[data-state="error"] {
        border-color: rgba(248, 113, 113, 0.28);
        color: #fecaca;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <div id="status">Loading version preview…</div>
    <script type="module">
      const payload = JSON.parse(${JSON.stringify(payload)});
      const root = document.getElementById("root");
      const status = document.getElementById("status");

      const setStatus = (message, state = "loading") => {
        if (!status) return;
        status.dataset.state = state;
        status.textContent = message;
      };

      const mountVersion = async () => {
        const response = await fetch(payload.manifestUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(\`Failed to load manifest: \${response.status}\`);
        }

        const manifest = await response.json();
        for (const href of manifest.cssUrls ?? []) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = href;
          document.head.appendChild(link);
        }

        const module = await import(\`\${manifest.entryUrl}?t=\${Date.now()}\`);
        if (typeof module.mount !== "function") {
          throw new Error("Live app module is missing mount()");
        }

        const initialState = JSON.parse(payload.stateJson);
        await module.mount({
          root,
          initialState,
          publishState: () => {},
          reportHealthy: () => {
            status?.remove();
          },
          reportError: (error) => {
            throw error instanceof Error ? error : new Error(String(error));
          },
        });

        status?.remove();
      };

      mountVersion().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[softbox/compare-frame]", error);
        setStatus(\`Version v\${payload.versionNumber} failed: \${message}\`, "error");
      });
    </script>
  </body>
</html>`;
}

function getRunDuration(run: any) {
  if (run.completedAt && run.submittedAt) {
    return run.completedAt - run.submittedAt;
  }
  if (run.failedAt && run.submittedAt) {
    return run.failedAt - run.submittedAt;
  }
  return null;
}

function getRunProgress(run: any) {
  const stages = run?.stages ?? [];
  if (!run || stages.length === 0) {
    return {
      status: "idle",
      activeLabel: "Ready",
      currentStep: 0,
      total: 0,
    };
  }

  const completed = stages.filter((stage: any) => stage.status === "completed").length;
  const runningStageIndex = stages.findIndex((stage: any) => stage.status === "running");
  const activeStage =
    runningStageIndex >= 0 ? stages[runningStageIndex] : null;
  const currentStep =
    run.status === "completed"
      ? stages.length
      : runningStageIndex >= 0
        ? runningStageIndex + 1
        : completed;

  return {
    status: run.status,
    activeLabel:
      activeStage?.label ??
      (run.status === "completed"
        ? "Ready"
        : run.status === "failed"
          ? "Failed"
          : "Queued"),
    currentStep,
    total: stages.length,
  };
}

type InspectTarget = {
  selector: string;
  tagName: string;
  role: string | null;
  label: string | null;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type InspectRect = InspectTarget["rect"];

type InspectRegion = {
  id: string;
  rect: InspectRect;
  relativeRect: InspectRect;
  devicePixelRatio: number;
};

type SelectionMode = "elements" | "pixels";

const inspectPreferredTags = new Set([
  "a",
  "article",
  "aside",
  "button",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "header",
  "input",
  "label",
  "li",
  "main",
  "nav",
  "section",
  "select",
  "summary",
  "textarea",
]);

function clampRect(rect: DOMRect): InspectRect {
  return {
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    width: Math.max(0, rect.width),
    height: Math.max(0, rect.height),
  };
}

function truncateText(text: string | null | undefined, max = 120) {
  if (!text) {
    return null;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function escapeSelectorValue(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function getImplicitRole(element: HTMLElement) {
  const tagName = element.tagName.toLowerCase();
  switch (tagName) {
    case "a":
      return element.hasAttribute("href") ? "link" : null;
    case "button":
      return "button";
    case "input":
      return "textbox";
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    default:
      return null;
  }
}

function getElementLabel(element: HTMLElement) {
  return (
    truncateText(element.getAttribute("aria-label")) ??
    truncateText(element.getAttribute("title")) ??
    truncateText(element.innerText) ??
    truncateText(element.textContent)
  );
}

function isInspectableCandidate(element: HTMLElement) {
  const tagName = element.tagName.toLowerCase();
  if (element.dataset.softboxId || element.dataset.testid || element.id) {
    return true;
  }
  if (element.hasAttribute("role") || element.hasAttribute("aria-label")) {
    return true;
  }
  if (inspectPreferredTags.has(tagName)) {
    return true;
  }
  return typeof element.onclick === "function";
}

function getSelectorSegment(element: HTMLElement, boundary: HTMLElement) {
  if (element.dataset.softboxId) {
    return `[data-softbox-id="${escapeSelectorValue(element.dataset.softboxId)}"]`;
  }
  if (element.dataset.testid) {
    return `[data-testid="${escapeSelectorValue(element.dataset.testid)}"]`;
  }
  if (element.id) {
    return `#${escapeSelectorValue(element.id)}`;
  }
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    return `${element.tagName.toLowerCase()}[aria-label="${escapeSelectorValue(ariaLabel)}"]`;
  }
  if (element === boundary) {
    return element.tagName.toLowerCase();
  }
  const tagName = element.tagName.toLowerCase();
  const parent = element.parentElement;
  if (!parent) {
    return tagName;
  }
  const siblings = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName,
  );
  if (siblings.length <= 1) {
    return tagName;
  }
  const index = siblings.indexOf(element) + 1;
  return `${tagName}:nth-of-type(${index})`;
}

function buildSelector(element: HTMLElement, boundary: HTMLElement) {
  const segments: string[] = [];
  let current: HTMLElement | null = element;
  while (current && current !== boundary) {
    const segment = getSelectorSegment(current, boundary);
    segments.unshift(segment);
    if (
      segment.startsWith("#") ||
      segment.startsWith("[data-softbox-id") ||
      segment.startsWith("[data-testid")
    ) {
      break;
    }
    current = current.parentElement;
  }
  if (current === boundary) {
    segments.unshift("[data-layer=\"active\"]");
  }
  return segments.join(" > ");
}

function pickInspectableElement(start: HTMLElement, boundary: HTMLElement) {
  let current: HTMLElement | null = start;
  while (current && current !== boundary) {
    if (isInspectableCandidate(current)) {
      return current;
    }
    current = current.parentElement;
  }
  return start !== boundary ? start : null;
}

function snapshotInspectTarget(element: HTMLElement, boundary: HTMLElement): InspectTarget {
  return {
    selector: buildSelector(element, boundary),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute("role") ?? getImplicitRole(element),
    label: getElementLabel(element),
    rect: clampRect(element.getBoundingClientRect()),
  };
}

function formatInspectSummary(target: InspectTarget) {
  return [target.tagName, target.role ? `role=${target.role}` : null, target.label ? `"${target.label}"` : null]
    .filter(Boolean)
    .join(" · ");
}

function isSameInspectTarget(left: InspectTarget, right: InspectTarget) {
  return left.selector === right.selector;
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampPointToRect(x: number, y: number, rect: DOMRect) {
  return {
    x: clampValue(x, rect.left, rect.right),
    y: clampValue(y, rect.top, rect.bottom),
  };
}

function createSelectionRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  boundaryRect: DOMRect,
): InspectRect {
  const start = clampPointToRect(startX, startY, boundaryRect);
  const end = clampPointToRect(endX, endY, boundaryRect);
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function createRelativeRect(rect: InspectRect, boundaryRect: DOMRect): InspectRect {
  return {
    x: Math.max(0, rect.x - boundaryRect.left),
    y: Math.max(0, rect.y - boundaryRect.top),
    width: rect.width,
    height: rect.height,
  };
}

function createInspectRegion(id: string, rect: InspectRect, boundaryRect: DOMRect): InspectRegion {
  return {
    id,
    rect,
    relativeRect: createRelativeRect(rect, boundaryRect),
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

function isMeaningfulRegion(rect: InspectRect) {
  return rect.width >= 8 && rect.height >= 8;
}

function isPointInsideRect(x: number, y: number, rect: InspectRect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function formatRectBounds(rect: InspectRect) {
  return `x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, w=${Math.round(rect.width)}, h=${Math.round(rect.height)}`;
}

function formatInspectRegionSummary(region: InspectRegion) {
  return `pixels · ${Math.round(region.rect.width)}×${Math.round(region.rect.height)}`;
}

function toggleInspectTargetSelection(targets: InspectTarget[], target: InspectTarget) {
  const existingIndex = targets.findIndex((current) => isSameInspectTarget(current, target));
  if (existingIndex >= 0) {
    return targets.filter((_, index) => index !== existingIndex);
  }
  return [...targets, target];
}

function buildPromptWithSelectionContext(
  prompt: string,
  targets: InspectTarget[],
  regions: InspectRegion[],
) {
  const trimmedPrompt = prompt.trim();
  if (targets.length === 0 && regions.length === 0) {
    return trimmedPrompt;
  }

  const lines = [trimmedPrompt];

  if (targets.length > 0) {
    lines.push("");
    lines.push(targets.length === 1 ? "Selected UI target:" : "Selected UI targets:");

    for (const [index, target] of targets.entries()) {
      if (targets.length > 1) {
        lines.push(`Target ${index + 1}:`);
      }
      lines.push(`- selector: ${target.selector}`);
      lines.push(`- tag: ${target.tagName}`);
      if (target.role) {
        lines.push(`- role: ${target.role}`);
      }
      if (target.label) {
        lines.push(`- text: ${target.label}`);
      }
      lines.push(`- bounds: ${formatRectBounds(target.rect)}`);
      if (index < targets.length - 1) {
        lines.push("");
      }
    }
  }

  if (regions.length > 0) {
    lines.push("");
    lines.push(regions.length === 1 ? "Selected pixel region:" : "Selected pixel regions:");

    for (const [index, region] of regions.entries()) {
      if (regions.length > 1) {
        lines.push(`Region ${index + 1}:`);
      }
      lines.push(`- viewport bounds (css px): ${formatRectBounds(region.rect)}`);
      lines.push(`- app-local bounds (css px): ${formatRectBounds(region.relativeRect)}`);
      lines.push(`- devicePixelRatio: ${region.devicePixelRatio}`);
      if (index < regions.length - 1) {
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

function getInspectOverlayStyle(target: { rect: InspectRect } | null): CSSProperties | null {
  if (!target) {
    return null;
  }
  return {
    left: target.rect.x,
    top: target.rect.y,
    width: target.rect.width,
    height: target.rect.height,
  };
}

function getInspectBadgeStyle(target: { rect: InspectRect } | null): CSSProperties | null {
  if (!target) {
    return null;
  }
  const badgeTop = target.rect.y <= 44 ? target.rect.y + target.rect.height + 8 : target.rect.y - 32;
  return {
    left: Math.max(8, target.rect.x),
    top: badgeTop,
  };
}

export function App() {
  const [shellId] = useState(() => getOrCreateShellId());
  const shellSelection = useQuery(convexApi.getShellSelection as any, { shellId }) as any;
  const defaultShellSelection = useQuery(
    convexApi.getShellSelection as any,
    shellId === defaultShellId ? "skip" : { shellId: defaultShellId },
  ) as any;
  const appsQuery = useQuery(convexApi.listApps as any, {}) as any[] | undefined;
  const apps = appsQuery ?? [];
  const sessionSelectionUpdatedAt =
    typeof shellSelection?.updatedAt === "number" ? shellSelection.updatedAt : null;
  const defaultSelectionUpdatedAt =
    typeof defaultShellSelection?.updatedAt === "number"
      ? defaultShellSelection.updatedAt
      : null;
  const effectiveShellSelection =
    sessionSelectionUpdatedAt !== null &&
    (defaultSelectionUpdatedAt === null || sessionSelectionUpdatedAt >= defaultSelectionUpdatedAt)
      ? shellSelection
      : defaultSelectionUpdatedAt !== null
        ? defaultShellSelection
        : shellSelection;
  const shellSelectedAppId = effectiveShellSelection?.selectedAppId ?? null;
  const hasPersistedSelection = effectiveShellSelection?.updatedAt != null;
  const selectedAppExists = shellSelectedAppId
    ? apps.some((app) => app.appId === shellSelectedAppId)
    : false;
  const appId = selectedAppExists
    ? shellSelectedAppId
    : hasPersistedSelection && shellSelectedAppId === null
      ? null
      : apps[0]?.appId ?? defaultAppId;
  const selectedApp = appId ? apps.find((app) => app.appId === appId) ?? null : null;
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [selectedTargetBoxIds, setSelectedTargetBoxIds] = useState<string[]>([]);
  const shellState = useQuery(
    convexApi.getShellState as any,
    appId ? { appId, boxId: selectedBoxId ?? null } : "skip",
  ) as any;
  const versions = (useQuery(
    convexApi.listVersions as any,
    appId ? { appId } : "skip",
  ) as any[]) ?? [];
  const setSelectedAppMutation = useMutation(convexApi.setSelectedApp as any);
  const deleteAppMutation = useMutation(convexApi.deleteApp as any);
  const createBoxMutation = useMutation(convexApi.createBox as any);
  const deleteBoxMutation = useMutation(convexApi.deleteBox as any);
  const updateBoxPolicyMutation = useMutation(convexApi.updateBoxPolicy as any);
  const deletePipelineRunMutation = useMutation(convexApi.deletePipelineRun as any);
  const submitPrompt = useMutation(convexApi.submitPrompt as any);
  const publishStateMutation = useMutation(convexApi.publishState as any);
  const activateVersionMutation = useMutation(convexApi.activateVersion as any);
  const reportRuntimeErrorMutation = useMutation(convexApi.reportRuntimeError as any);
  const recordPipelineStageForVersionMutation = useMutation(
    convexApi.recordPipelineStageForVersion as any,
  );
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareVersionIds, setCompareVersionIds] = useState<string[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [switchingAppId, setSwitchingAppId] = useState<string | null>(null);
  const [deletingAppId, setDeletingAppId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [boxActionKey, setBoxActionKey] = useState<string | null>(null);
  const [switchingVersionId, setSwitchingVersionId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selectionMode, setSelectionMode] = useState<SelectionMode | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<InspectTarget | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<InspectTarget[]>([]);
  const [draftRegion, setDraftRegion] = useState<InspectRegion | null>(null);
  const [selectedRegions, setSelectedRegions] = useState<InspectRegion[]>([]);
  const [composerHidden, setComposerHidden] = useState(false);

  const runtimeStatus = getRuntimeStatus(shellState);
  const currentBoxes =
    (shellState?.boxes as any[] | undefined) ??
    (selectedApp?.boxes as any[] | undefined) ??
    (selectedApp?.box ? [selectedApp.box] : []);
  const primaryBox =
    shellState?.primaryBox ??
    selectedApp?.primaryBox ??
    selectedApp?.box ??
    currentBoxes[0] ??
    null;
  const selectedBox =
    currentBoxes.find((box: any) => box.boxId === selectedBoxId) ??
    primaryBox;
  const promptTargetBoxIds = Array.from(
    new Set(
      (selectedTargetBoxIds.length > 0
        ? selectedTargetBoxIds
        : [selectedBox?.boxId ?? primaryBox?.boxId ?? null]
      ).filter(
        (boxId): boxId is string =>
          typeof boxId === "string" &&
          currentBoxes.some((box: any) => box.boxId === boxId),
      ),
    ),
  );
  const lastBuildError = shellState?.lastBuildError ?? null;
  const hasActiveVersion = Boolean(shellState?.activeVersion);
  const showEmptyState =
    shellState === undefined || shellState === null || !hasActiveVersion;
  const showErrorBanner = !showEmptyState && (runtimeStatus || lastBuildError);
  const latestPipelineRuns = shellState?.latestPipelineRuns ?? [];
  const latestPipelineRun = shellState?.latestPipelineRun ?? latestPipelineRuns[0] ?? null;
  const activeVersionId = shellState?.activeVersion?._id ?? null;
  const comparedVersions = compareVersionIds
    .map((versionId) => versions.find((version: any) => version._id === versionId) ?? null)
    .filter((version): version is CompareableVersionRecord => Boolean(version));
  const templateSourceStatus =
    selectedApp?.templateSourceStatus ??
    shellState?.templateSourceStatus ??
    "unknown";
  const templateSourceMessage =
    selectedApp?.templateSourceMessage ??
    shellState?.templateSourceMessage ??
    null;
  const noMountedApp = appId === null;
  const emptyStateTitle = noMountedApp
    ? "Nothing mounted"
    : runtimeStatus?.title ?? "No App Loaded";
  const emptyStateBody = noMountedApp
    ? "Your shell is running, but no app is currently mounted."
    : runtimeStatus?.body ?? "The shell is running, but there is no hosted app mounted yet.";
  const emptyStateSteps = noMountedApp
    ? [
        "Open Apps and mount an existing app.",
        "Or keep the shell empty until you are ready to mount one.",
      ]
    : shellState === null
      ? [
          "Seed or register an app so the shell has something to load.",
          "Then mount it from the Apps menu.",
        ]
      : [
          "Open Apps and choose what you want to mount.",
          "Or wait here while the shell finishes loading.",
        ];
  const templateSourceMissing = templateSourceStatus === "missing";
  const promptDisabled = noMountedApp || templateSourceMissing;
  const pipelineProgress = getRunProgress(latestPipelineRun);
  const elapsedMs = latestPipelineRun
    ? getRunDuration(latestPipelineRun) ??
      (typeof latestPipelineRun.submittedAt === "number"
        ? Math.max(0, now - latestPipelineRun.submittedAt)
        : 0)
    : 0;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const queuedTooLong =
    latestPipelineRun?.status === "pending" && elapsedSeconds >= 60;
  const inspectMode = selectionMode === "elements";
  const pixelInspectMode = selectionMode === "pixels";
  const boxIdsSignature = currentBoxes.map((box: any) => box.boxId).join("|");
  const pipelineStepLabel =
    pipelineProgress.total > 0
      ? `${pipelineProgress.currentStep}/${pipelineProgress.total}`
      : "0/0";
  const pipelineToneClass =
    pipelineProgress.status === "completed"
      ? "bg-emerald-500/12 text-emerald-200 ring-1 ring-emerald-500/25"
      : pipelineProgress.status === "failed"
        ? "bg-rose-500/12 text-rose-100 ring-1 ring-rose-500/25"
        : pipelineProgress.status === "running"
          ? "bg-amber-500/12 text-amber-100 ring-1 ring-amber-500/25"
          : "bg-white/8 text-slate-200 ring-1 ring-white/10";
  const selectedBoxLabel = selectedBox ? formatBoxLabel(selectedBox) : "No box";
  const targetBoxSummary =
    promptTargetBoxIds.length === 0
      ? "No target box selected"
      : promptTargetBoxIds.length === 1
        ? `Sending to ${formatBoxLabel(
            currentBoxes.find((box: any) => box.boxId === promptTargetBoxIds[0]) ?? {
              boxId: promptTargetBoxIds[0],
              appId: appId ?? null,
            },
          )}`
        : `Sending to ${promptTargetBoxIds.length} boxes`;
  const selectionSummary =
    selectedTargets.length > 0 || selectedRegions.length > 0
      ? `${selectedTargets.length} element${selectedTargets.length === 1 ? "" : "s"} · ${selectedRegions.length} region${selectedRegions.length === 1 ? "" : "s"}`
      : "No selection context";
  const currentVersionLabel = shellState?.activeVersion
    ? `v${shellState.activeVersion.versionNumber}`
    : "No active version";
  const currentAppLabel = selectedApp?.name ?? (appId ? appId : "Nothing mounted");
  const currentAppMeta = selectedApp?.appId ?? "shell idle";
  const shellLead = showEmptyState
    ? emptyStateBody
    : showErrorBanner
      ? runtimeStatus?.body ?? lastBuildError ?? "The latest mounted version reported an error."
      : templateSourceMissing
        ? templateSourceMessage ??
          "Mounted artifacts are still available, but prompt-driven edits are disabled until the app source returns."
        : null;

  useEffect(() => {
    if (!appsQuery || apps.length === 0 || shellSelection === undefined) {
      return;
    }
    if (shellSelectedAppId && selectedAppExists) {
      return;
    }
    if (hasPersistedSelection && shellSelectedAppId === null) {
      return;
    }
    void setSelectedAppMutation({
      shellId,
      appId: apps[0].appId,
    });
  }, [
    apps,
    appsQuery,
    selectedAppExists,
    setSelectedAppMutation,
    hasPersistedSelection,
    shellId,
    shellSelectedAppId,
    shellSelection,
  ]);

  useEffect(() => {
    if (!latestPipelineRun || latestPipelineRun.status === "completed" || latestPipelineRun.status === "failed") {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [latestPipelineRun?._id, latestPipelineRun?.status]);

  useEffect(() => {
    setAppsOpen(false);
    setSwitchingAppId(null);
    setVersionsOpen(false);
    setCompareOpen(false);
    setCompareVersionIds([]);
    setSwitchingVersionId(null);
    setExpandedRunId(null);
    setDeletingRunId(null);
    setSelectionMode(null);
    setHoveredTarget(null);
    setSelectedTargets([]);
    setDraftRegion(null);
    setSelectedRegions([]);
    setSelectedBoxId(null);
    setSelectedTargetBoxIds([]);
  }, [appId]);

  useEffect(() => {
    setCompareVersionIds((current) => {
      const next = current.filter((versionId) =>
        versions.some((version: any) => version._id === versionId),
      );

      if (
        next.length === current.length &&
        next.every((versionId, index) => versionId === current[index])
      ) {
        return current;
      }

      return next;
    });
  }, [versions]);

  useEffect(() => {
    if (currentBoxes.length === 0) {
      if (selectedBoxId !== null) {
        setSelectedBoxId(null);
      }
      if (selectedTargetBoxIds.length > 0) {
        setSelectedTargetBoxIds([]);
      }
      return;
    }
    if (selectedBoxId && currentBoxes.some((box: any) => box.boxId === selectedBoxId)) {
      return;
    }
    setSelectedBoxId(primaryBox?.boxId ?? currentBoxes[0]?.boxId ?? null);
  }, [boxIdsSignature, currentBoxes, primaryBox?.boxId, selectedBoxId, selectedTargetBoxIds.length]);

  useEffect(() => {
    const validTargetBoxIds = selectedTargetBoxIds.filter((boxId) =>
      currentBoxes.some((box: any) => box.boxId === boxId),
    );
    const defaultTargetBoxId = selectedBox?.boxId ?? primaryBox?.boxId ?? null;

    if (validTargetBoxIds.length === 0) {
      if (defaultTargetBoxId) {
        setSelectedTargetBoxIds([defaultTargetBoxId]);
      } else if (selectedTargetBoxIds.length > 0) {
        setSelectedTargetBoxIds([]);
      }
      return;
    }

    if (
      validTargetBoxIds.length !== selectedTargetBoxIds.length ||
      validTargetBoxIds.some((boxId, index) => boxId !== selectedTargetBoxIds[index])
    ) {
      setSelectedTargetBoxIds(validTargetBoxIds);
    }
  }, [boxIdsSignature, currentBoxes, primaryBox?.boxId, selectedBox?.boxId, selectedTargetBoxIds]);

  useEffect(() => {
    if (!selectedBox?.boxId) {
      return;
    }
    if (selectedTargetBoxIds.length === 1 && selectedTargetBoxIds[0] !== selectedBox.boxId) {
      setSelectedTargetBoxIds([selectedBox.boxId]);
    }
  }, [selectedBox?.boxId, selectedTargetBoxIds]);

  useEffect(() => {
    if (!showEmptyState) {
      return;
    }
    setSelectionMode(null);
    setHoveredTarget(null);
    setSelectedTargets([]);
    setDraftRegion(null);
    setSelectedRegions([]);
  }, [showEmptyState]);

  useEffect(() => {
    if (!appsOpen && !pipelineOpen && !versionsOpen && !compareOpen) {
      return;
    }
    setSelectionMode(null);
    setHoveredTarget(null);
    setDraftRegion(null);
  }, [appsOpen, compareOpen, pipelineOpen, versionsOpen]);

  useEffect(() => {
    if (!inspectMode) {
      setHoveredTarget(null);
    }
  }, [inspectMode]);

  useEffect(() => {
    if (!pixelInspectMode) {
      setDraftRegion(null);
    }
  }, [pixelInspectMode]);

  useEffect(() => {
    if (!selectionMode) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectionMode(null);
        setHoveredTarget(null);
        setDraftRegion(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectionMode]);

  useEffect(() => {
    if (!inspectMode) {
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const activeLayer = host.querySelector<HTMLElement>('[data-layer="active"]');
    if (!activeLayer) {
      return;
    }

    activeLayer.dataset.inspecting = "true";

    const updateHoveredTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        setHoveredTarget(null);
        return;
      }
      const inspectable = pickInspectableElement(target, activeLayer);
      if (!inspectable) {
        setHoveredTarget(null);
        return;
      }
      setHoveredTarget(snapshotInspectTarget(inspectable, activeLayer));
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateHoveredTarget(event.target);
    };

    const handlePointerLeave = () => {
      setHoveredTarget(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }
      const inspectable = pickInspectableElement(event.target, activeLayer);
      if (!inspectable) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const snapshot = snapshotInspectTarget(inspectable, activeLayer);
      setSelectedTargets((current) => toggleInspectTargetSelection(current, snapshot));
      setHoveredTarget(snapshot);
    };

    activeLayer.addEventListener("pointermove", handlePointerMove, true);
    activeLayer.addEventListener("pointerleave", handlePointerLeave, true);
    activeLayer.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      delete activeLayer.dataset.inspecting;
      activeLayer.removeEventListener("pointermove", handlePointerMove, true);
      activeLayer.removeEventListener("pointerleave", handlePointerLeave, true);
      activeLayer.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [inspectMode, shellState?.activeVersion?._id]);

  useEffect(() => {
    if (!pixelInspectMode) {
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const activeLayer = host.querySelector<HTMLElement>('[data-layer="active"]');
    if (!activeLayer) {
      return;
    }

    activeLayer.dataset.inspecting = "true";

    let dragStart: { x: number; y: number } | null = null;
    let dragBoundary: DOMRect | null = null;
    let removeRegionId: string | null = null;

    const finishDrag = () => {
      dragStart = null;
      dragBoundary = null;
      removeRegionId = null;
      setDraftRegion(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }
      const boundaryRect = activeLayer.getBoundingClientRect();
      const start = clampPointToRect(event.clientX, event.clientY, boundaryRect);
      const existingRegion = selectedRegions.find((region) =>
        isPointInsideRect(start.x, start.y, region.rect),
      );

      dragStart = start;
      dragBoundary = boundaryRect;
      removeRegionId = existingRegion?.id ?? null;
      setDraftRegion(createInspectRegion("draft", createSelectionRect(
        start.x,
        start.y,
        start.x,
        start.y,
        boundaryRect,
      ), boundaryRect));
      event.preventDefault();
      event.stopPropagation();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStart || !dragBoundary) {
        return;
      }
      const rect = createSelectionRect(
        dragStart.x,
        dragStart.y,
        event.clientX,
        event.clientY,
        dragBoundary,
      );
      setDraftRegion(createInspectRegion("draft", rect, dragBoundary));
      event.preventDefault();
      event.stopPropagation();
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!dragStart || !dragBoundary) {
        return;
      }
      const boundary = dragBoundary;
      const rect = createSelectionRect(
        dragStart.x,
        dragStart.y,
        event.clientX,
        event.clientY,
        boundary,
      );

      if (removeRegionId && !isMeaningfulRegion(rect)) {
        setSelectedRegions((current) => current.filter((region) => region.id !== removeRegionId));
      } else if (isMeaningfulRegion(rect)) {
        const id = [
          Date.now().toString(36),
          Math.round(rect.x),
          Math.round(rect.y),
          Math.round(rect.width),
          Math.round(rect.height),
        ].join("-");
        setSelectedRegions((current) => [...current, createInspectRegion(id, rect, boundary)]);
      }

      event.preventDefault();
      event.stopPropagation();
      finishDrag();
    };

    const handlePointerCancel = () => {
      finishDrag();
    };

    activeLayer.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);

    return () => {
      delete activeLayer.dataset.inspecting;
      activeLayer.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
    };
  }, [pixelInspectMode, selectedRegions, shellState?.activeVersion?._id]);

  useEffect(() => {
    if (selectedTargets.length === 0) {
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const activeLayer = host.querySelector<HTMLElement>('[data-layer="active"]');
    if (!activeLayer) {
      return;
    }

    const refreshSelectedTargets = () => {
      setSelectedTargets((current) => {
        let changed = false;
        const next = current.map((target) => {
          const element = host.querySelector<HTMLElement>(target.selector);
          if (!element || !activeLayer.contains(element)) {
            return target;
          }
          const snapshot = snapshotInspectTarget(element, activeLayer);
          const sameRect =
            snapshot.rect.x === target.rect.x &&
            snapshot.rect.y === target.rect.y &&
            snapshot.rect.width === target.rect.width &&
            snapshot.rect.height === target.rect.height;
          if (!sameRect) {
            changed = true;
          }
          return sameRect ? target : snapshot;
        });
        return changed ? next : current;
      });
    };

    refreshSelectedTargets();
    activeLayer.addEventListener("scroll", refreshSelectedTargets, { passive: true });
    window.addEventListener("resize", refreshSelectedTargets);

    return () => {
      activeLayer.removeEventListener("scroll", refreshSelectedTargets);
      window.removeEventListener("resize", refreshSelectedTargets);
    };
  }, [selectedTargets.length, shellState?.activeVersion?._id]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tagName = target.tagName.toLowerCase();
      return (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target.isContentEditable
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (event.key.toLowerCase() !== "k" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (!composerHidden && isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      setComposerHidden((current) => !current);
      setSelectionMode(null);
      setHoveredTarget(null);
      setDraftRegion(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [composerHidden]);

  useLiveAppRuntime(hostRef, {
    appId: appId ?? "__unmounted__",
    activeVersion: shellState?.activeVersion ?? null,
    nextReadyVersion: shellState?.nextReadyVersion ?? null,
    publishState: async (state: LiveAppState) => {
      if (!appId) return;
      await publishStateMutation({
        appId,
        stateJson: JSON.stringify(state),
      });
    },
    activateVersion: async (versionId: string) => {
      if (!appId) return;
      await activateVersionMutation({ appId, versionId });
    },
    reportRuntimeError: async ({ versionId, message, stack }) => {
      if (!appId) return;
      await reportRuntimeErrorMutation({
        appId,
        versionId,
        message,
        stack,
      });
    },
    recordPipelineStageForVersion: async ({ versionId, key, status, detail }) => {
      if (!appId) return;
      await recordPipelineStageForVersionMutation({
        appId,
        versionId,
        key,
        status,
        detail,
      });
    },
  });

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#040506] text-slate-100">
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(103,232,249,0.12),transparent_28%),radial-gradient(circle_at_80%_16%,rgba(244,114,182,0.08),transparent_22%),linear-gradient(180deg,rgba(4,5,6,0.18),rgba(4,5,6,0.9))]" />
      </div>
      <div className="absolute inset-0">
        <div
          ref={hostRef}
          className="h-screen min-h-[800px] w-full"
        />
      </div>

      {selectedTargets.length > 0 || selectedRegions.length > 0 ? (
        <div className="pointer-events-none fixed inset-0 z-[11]">
          {selectedTargets.map((target) => (
            <div
              key={target.selector}
              className="absolute rounded-xl border border-amber-300/70 bg-amber-300/10 shadow-[0_0_0_1px_rgba(252,211,77,0.2)]"
              style={getInspectOverlayStyle(target) ?? undefined}
            />
          ))}
          {selectedRegions.map((region) => (
            <div
              key={region.id}
              className="absolute rounded-xl border border-fuchsia-300/80 bg-fuchsia-300/10 shadow-[0_0_0_1px_rgba(232,121,249,0.22)]"
              style={getInspectOverlayStyle(region) ?? undefined}
            />
          ))}
        </div>
      ) : null}

      {inspectMode && hoveredTarget ? (
        <div className="pointer-events-none fixed inset-0 z-[12]">
          <div
            className="absolute rounded-2xl border border-cyan-300/80 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.28),0_18px_50px_rgba(8,145,178,0.2)]"
            style={getInspectOverlayStyle(hoveredTarget) ?? undefined}
          />
          <div
            className="absolute rounded-lg bg-cyan-300 px-2 py-1 text-[10px] font-semibold text-slate-950 shadow-lg"
            style={getInspectBadgeStyle(hoveredTarget) ?? undefined}
          >
            {formatInspectSummary(hoveredTarget)}
          </div>
        </div>
      ) : null}

      {pixelInspectMode && draftRegion ? (
        <div className="pointer-events-none fixed inset-0 z-[12]">
          <div
            className="absolute rounded-2xl border border-fuchsia-300/90 bg-fuchsia-400/10 shadow-[0_0_0_1px_rgba(217,70,239,0.28),0_18px_50px_rgba(134,25,143,0.2)]"
            style={getInspectOverlayStyle(draftRegion) ?? undefined}
          />
          <div
            className="absolute rounded-lg bg-fuchsia-300 px-2 py-1 text-[10px] font-semibold text-slate-950 shadow-lg"
            style={getInspectBadgeStyle(draftRegion) ?? undefined}
          >
            {formatInspectRegionSummary(draftRegion)}
          </div>
        </div>
      ) : null}

      {composerHidden ? (
        <button
          type="button"
          onClick={() => setComposerHidden(false)}
          className="fixed bottom-5 right-5 z-[13] rounded-full border border-white/10 bg-[#111419]/92 px-4 py-2 text-xs font-medium text-slate-100 shadow-[0_16px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-colors hover:bg-[#1a2028]"
        >
          Show HUD
        </button>
      ) : null}

      <section
        className={`pointer-events-none fixed inset-x-0 top-0 z-10 px-4 pt-4 transition-[opacity,transform] duration-200 ease-out sm:px-6 sm:pt-6 ${
          composerHidden ? "-translate-y-4 opacity-0" : "translate-y-0 opacity-100"
        } ${showEmptyState ? "hidden md:block" : ""}`}
      >
        <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="pointer-events-auto w-full max-w-2xl overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#0e1114]/82 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-2xl sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-lg font-semibold tracking-tight text-white sm:text-[1.5rem]">
                  {showEmptyState ? "Shell status" : currentAppLabel}
                </h1>
                {shellLead ? (
                  <p className="mt-1.5 max-w-xl text-xs leading-5 text-slate-300 sm:text-sm">
                    {shellLead}
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Mounted
                </p>
                <p className="mt-1 text-xs font-medium text-white">{currentAppMeta}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {currentVersionLabel} · {selectedBoxLabel}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-slate-200">
                {targetBoxSummary}
              </span>
              <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-slate-300">
                {selectionSummary}
              </span>
              <span className={`rounded-full px-2.5 py-1 font-medium ${pipelineToneClass}`}>
                {pipelineProgress.activeLabel} · {pipelineStepLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-slate-400">
                {elapsedSeconds}s elapsed
              </span>
            </div>

            {showErrorBanner ? (
              <div className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                <p className="font-semibold">{runtimeStatus?.title ?? "Build error"}</p>
                <p className="mt-1 whitespace-pre-wrap text-rose-100/80">
                  {runtimeStatus?.body ?? lastBuildError}
                </p>
              </div>
            ) : null}

            {templateSourceMissing ? (
              <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                <p className="font-semibold">Mounted version still works, but edits are disabled.</p>
                <p className="mt-1 text-amber-100/80">
                  {templateSourceMessage ??
                    "This app can still mount its existing built version, but its local source is missing from /apps."}
                </p>
              </div>
            ) : null}
          </div>

          <aside className="pointer-events-auto w-full max-w-[280px] overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#0b0f13]/80 p-3 shadow-[0_16px_56px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Workflow
                </p>
                <p className="mt-1.5 text-sm font-semibold text-white">
                  {pipelineProgress.activeLabel}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {pipelineStepLabel} stages · {elapsedSeconds}s
                </p>
              </div>
              {pipelineProgress.status === "completed" ? (
                <div className="flex size-8 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-300 ring-1 ring-emerald-500/20">
                  <Check className="size-4" />
                </div>
              ) : (
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${pipelineToneClass}`}>
                  {pipelineProgress.status}
                </span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setAppsOpen(true)}
                className="inline-flex h-8 items-center justify-center rounded-xl border border-white/10 bg-white/6 px-2.5 text-xs font-medium text-slate-100 transition-colors hover:bg-white/10"
              >
                Apps
              </button>
              <button
                type="button"
                onClick={() => {
                  setPipelineOpen(true);
                  setExpandedRunId(latestPipelineRuns[0]?._id ?? null);
                }}
                disabled={noMountedApp}
                className="inline-flex h-8 items-center justify-center rounded-xl border border-white/10 bg-white/6 px-2.5 text-xs font-medium text-slate-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Pipeline
              </button>
              <button
                type="button"
                onClick={() => setVersionsOpen(true)}
                disabled={noMountedApp}
                className="inline-flex h-8 items-center justify-center rounded-xl border border-white/10 bg-white/6 px-2.5 text-xs font-medium text-slate-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Versions
              </button>
              <button
                type="button"
                onClick={() => setComposerHidden(true)}
                className="inline-flex h-8 items-center justify-center rounded-xl border border-white/10 bg-[#151b22] px-2.5 text-xs font-medium text-slate-300 transition-colors hover:bg-[#1d2631]"
              >
                Hide HUD
              </button>
            </div>

            <div className="mt-3 grid gap-1.5 text-[11px] text-slate-400">
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                <p className="font-semibold uppercase tracking-[0.16em] text-slate-500">Current box</p>
                <p className="mt-1 text-xs font-medium text-slate-100">{selectedBoxLabel}</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                <p className="font-semibold uppercase tracking-[0.16em] text-slate-500">Prompt target</p>
                <p className="mt-1 text-xs font-medium text-slate-100">{targetBoxSummary}</p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {showEmptyState ? (
        <section className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4 pb-28 pt-24 sm:px-6 sm:pb-32 sm:pt-32">
          <div className="pointer-events-auto relative w-full max-w-2xl overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#0d1014]/86 p-5 shadow-[0_24px_84px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-6">
            <div
              className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(103,232,249,0.08),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_22%)]"
              aria-hidden="true"
            />
            <div className="relative">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200/60">
                Shell host
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {emptyStateTitle}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
                {emptyStateBody}
              </p>

              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {emptyStateSteps.map((step, index) => (
                  <div
                    key={step}
                    className="rounded-[1.1rem] border border-white/8 bg-black/20 px-4 py-3"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Step {index + 1}
                    </p>
                    <p className="mt-1.5 text-sm leading-5 text-slate-200">{step}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAppsOpen(true)}
                  className="inline-flex h-9 items-center justify-center rounded-xl bg-white px-3.5 text-sm font-medium text-black transition-colors hover:bg-slate-200"
                >
                  Open apps
                </button>
                <button
                  type="button"
                  onClick={() => setComposerHidden((current) => !current)}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/6 px-3.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
                >
                  {composerHidden ? "Show prompt HUD" : "Hide prompt HUD"}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-10 px-4 pb-4 transition-[opacity,transform] duration-200 ease-out sm:px-6 sm:pb-6 ${
          composerHidden ? "translate-y-8 opacity-0" : "translate-y-0 opacity-100"
        } ${showEmptyState ? "hidden lg:block" : ""}`}
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!prompt.trim() || promptDisabled) return;
            setSubmitting(true);
            try {
              setSelectionMode(null);
              setHoveredTarget(null);
              setDraftRegion(null);
              const promptWithContext = buildPromptWithSelectionContext(
                prompt,
                selectedTargets,
                selectedRegions,
              );
              const targetBoxIds =
                promptTargetBoxIds.length > 0
                  ? promptTargetBoxIds
                  : [selectedBox?.boxId ?? primaryBox?.boxId ?? null].filter(
                      (boxId): boxId is string => typeof boxId === "string" && boxId.length > 0,
                    );

              await Promise.all(
                (targetBoxIds.length > 0 ? targetBoxIds : [null]).map((boxId) =>
                  submitPrompt({
                    appId,
                    boxId,
                    prompt: promptWithContext,
                  }),
                ),
              );
              startTransition(() => setPrompt(""));
              setSelectedTargets([]);
              setSelectedRegions([]);
            } finally {
              setSubmitting(false);
            }
          }}
          className="pointer-events-auto mx-auto w-full max-w-3xl"
        >
          <div className="overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#101317]/90 shadow-[0_20px_64px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
            <div className="border-b border-white/8 px-3 py-2.5 sm:px-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Prompt workspace
                  </p>
                  <p className="mt-1 text-xs text-slate-300">{targetBoxSummary}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-slate-300">
                    {selectionSummary}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-slate-400">
                    {currentVersionLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-3 sm:p-4">
              {queuedTooLong ? (
                <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  <p className="font-semibold">Queued for 1 minute. Did you forget to run Docker?</p>
                  <p className="mt-1 text-rose-100/80">
                    Redis may not be running. Start it with{" "}
                    <code className="rounded bg-black/20 px-1.5 py-0.5 text-rose-50">
                      docker compose up -d redis
                    </code>
                    .
                  </p>
                </div>
              ) : null}

              {inspectMode ? (
                <div className="mb-3 rounded-xl border border-cyan-500/20 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
                  <p className="font-semibold text-cyan-200">Inspect mode is on.</p>
                  <p className="mt-1 text-cyan-100/80">
                    Click mounted app elements to add or remove them from the next prompt. Press Escape or click Inspect again when done.
                  </p>
                </div>
              ) : null}

              {pixelInspectMode ? (
                <div className="mb-3 rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-2 text-xs text-fuchsia-100">
                  <p className="font-semibold text-fuchsia-200">Pixel mode is on.</p>
                  <p className="mt-1 text-fuchsia-100/80">
                    Drag across the mounted app to select a pixel region. Click an existing region to remove it.
                  </p>
                </div>
              ) : null}

              <textarea
                id="prompt-input"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  noMountedApp
                    ? "Mount an app to submit prompts."
                    : templateSourceMissing
                      ? "Restore the app source in /apps to submit new prompts."
                      : "Describe what you want to change..."
                }
                disabled={promptDisabled}
                className="min-h-[64px] w-full resize-none rounded-[1rem] border border-white/8 bg-black/20 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/40 disabled:cursor-not-allowed disabled:text-slate-500"
                rows={3}
              />

              <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={noMountedApp || showEmptyState}
                    onClick={() => {
                      setSelectionMode((current) => (current === "elements" ? null : "elements"));
                      setHoveredTarget(null);
                      setDraftRegion(null);
                    }}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      inspectMode
                        ? "bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                        : "border border-white/10 bg-white/6 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    <Crosshair className="size-3.5" />
                    {inspectMode ? "Inspecting" : "Inspect"}
                  </button>

                  <button
                    type="button"
                    disabled={noMountedApp || showEmptyState}
                    onClick={() => {
                      setSelectionMode((current) => (current === "pixels" ? null : "pixels"));
                      setHoveredTarget(null);
                      setDraftRegion(null);
                    }}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      pixelInspectMode
                        ? "bg-fuchsia-300 text-slate-950 hover:bg-fuchsia-200"
                        : "border border-white/10 bg-white/6 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    <Crosshair className="size-3.5" />
                    {pixelInspectMode ? "Pixels on" : "Pixels"}
                  </button>

                  <label className="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/6 px-3 text-xs text-slate-300">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Box
                    </span>
                    <select
                      value={selectedBox?.boxId ?? ""}
                      onChange={(event) => setSelectedBoxId(event.target.value || null)}
                      disabled={currentBoxes.length === 0 || noMountedApp}
                      className="rounded bg-transparent text-xs font-medium text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {currentBoxes.length === 0 ? (
                        <option value="">No box</option>
                      ) : (
                        currentBoxes.map((box: any) => (
                          <option key={box.boxId} value={box.boxId}>
                            {formatBoxLabel(box)}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAppsOpen(true)}
                    className="inline-flex h-9 items-center rounded-xl border border-white/10 bg-white/6 px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10"
                  >
                    {selectedApp?.appId ?? appId ?? "No app"}
                  </button>

                  <button
                    type="submit"
                    disabled={submitting || promptDisabled}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-medium text-black transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500"
                    aria-label={
                      noMountedApp
                        ? "Mount an app to enable prompts"
                        : templateSourceMissing
                          ? "Restore source to enable prompts"
                          : submitting
                            ? "Sending prompt"
                        : "Send prompt"
                    }
                  >
                    <ArrowUpFromLine className={`size-3.5 ${submitting ? "animate-pulse" : ""}`} />
                    {submitting ? "Sending" : "Send prompt"}
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/8 pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Send to
                </span>
                {currentBoxes.length > 0 ? (
                  currentBoxes.map((box: any) => {
                    const targeted = promptTargetBoxIds.includes(box.boxId);
                    return (
                      <button
                        key={box.boxId}
                        type="button"
                        disabled={noMountedApp}
                        onClick={() =>
                          setSelectedTargetBoxIds((current) => {
                            const next = toggleStringSelection(current, box.boxId);
                            return next.length > 0 ? next : [box.boxId];
                          })
                        }
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          targeted
                            ? "bg-cyan-500/16 text-cyan-100 ring-1 ring-cyan-400/30"
                            : "border border-white/10 bg-white/6 text-slate-300 hover:bg-white/10"
                        }`}
                        title={box.boxId}
                      >
                        {formatBoxLabel(box)}
                      </button>
                    );
                  })
                ) : (
                  <span className="text-xs text-slate-500">No box</span>
                )}
              </div>
            </div>
          </div>
        </form>
      </section>

      {pipelineOpen ? (
        <div
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
          onClick={() => setPipelineOpen(false)}
        >
          <div className="flex h-screen">
            <section
              className="flex h-screen w-full flex-col overflow-hidden bg-[#0c0c0f]/98"
              role="dialog"
              aria-modal="true"
              aria-label="Pipeline runs"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-5 sm:px-8">
                <div>
                  <p className="text-sm font-semibold text-white">Pipeline runs</p>
                  <p className="mt-1 text-xs text-gray-500">Detailed prompt-to-render timeline.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPipelineOpen(false)}
                  className="rounded-lg bg-[#1a1a1f] px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-[#25252b]"
                >
                  Close
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-8 sm:py-6">
                {latestPipelineRuns.length > 0 ? (
                  <div className="space-y-4">
                    {latestPipelineRuns.map((run: any) => {
                      const isExpanded = expandedRunId === run._id;
                      const statusTone =
                        run.status === "completed"
                          ? "bg-emerald-500/10 text-emerald-300"
                          : run.status === "failed"
                            ? "bg-rose-500/10 text-rose-300"
                            : run.status === "running"
                              ? "bg-amber-500/10 text-amber-300"
                              : "bg-white/5 text-gray-300";

                      return (
                        <article
                          key={run._id}
                          className="overflow-hidden rounded-2xl bg-[#141419]"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRunId((current) => (current === run._id ? null : run._id))
                            }
                            className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-white/[0.02] sm:px-5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-gray-100">{run.prompt}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                <span>{run.stages?.length ?? 0} stages</span>
                                <span>{formatDuration(getRunDuration(run))}</span>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              <span className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusTone}`}>
                                {run.status}
                              </span>
                              <svg
                                className={`size-4 text-gray-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25L12 15.75 4.5 8.25" />
                              </svg>
                            </div>
                          </button>

                          {isExpanded ? (
                            <div className="bg-black/10 px-4 py-4 sm:px-5">
                              <div className="mb-3 flex items-center justify-end">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const confirmed = window.confirm(
                                      `Delete this pipeline run and its job record?\n\n${run.prompt}`,
                                    );
                                    if (!confirmed) {
                                      return;
                                    }
                                    setDeletingRunId(run._id);
                                    try {
                                      await deletePipelineRunMutation({ runId: run._id });
                                      setExpandedRunId((current) =>
                                        current === run._id ? null : current,
                                      );
                                    } finally {
                                      setDeletingRunId((current) =>
                                        current === run._id ? null : current,
                                      );
                                    }
                                  }}
                                  disabled={deletingRunId === run._id}
                                  className="inline-flex h-8 items-center gap-2 rounded-lg bg-rose-500/10 px-3 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-wait disabled:opacity-50"
                                >
                                  <Trash2 className="size-3.5" />
                                  {deletingRunId === run._id ? "Deleting..." : "Delete run"}
                                </button>
                              </div>
                              <div className="space-y-3">
                                {(run.stages ?? []).map((stage: any) => {
                                  const stageTone =
                                    stage.status === "completed"
                                      ? "bg-emerald-500/5"
                                      : stage.status === "failed"
                                        ? "bg-rose-500/5"
                                        : stage.status === "running"
                                          ? "bg-amber-500/5"
                                          : "bg-white/[0.02]";

                                  return (
                                    <div
                                      key={`${run._id}-${stage.key}`}
                                      className={`rounded-xl px-4 py-3 ${stageTone}`}
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <p className="text-sm font-medium text-gray-100">
                                            {stage.label}
                                          </p>
                                          <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
                                            {stage.key}
                                          </p>
                                        </div>
                                        <div className="text-right">
                                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-300">
                                            {stage.status}
                                          </p>
                                          <p className="mt-1 text-xs text-gray-500">
                                            {formatDuration(stage.durationMs ?? null)}
                                          </p>
                                        </div>
                                      </div>
                                      {stage.detail ? (
                                        <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-gray-400">
                                          {stage.detail}
                                        </p>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-[#141419] px-4 py-6 text-sm text-gray-400">
                    No pipeline runs yet.
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {appsOpen ? (
        <div
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
          onClick={() => {
            if (!switchingAppId) {
              setAppsOpen(false);
            }
          }}
        >
          <div className="flex min-h-screen items-center justify-center px-4 py-8">
            <section
              className="flex w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0c0c0f]/98 shadow-2xl shadow-black/40"
              role="dialog"
              aria-modal="true"
              aria-label="Mounted app selector"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-5 sm:px-8">
                <div>
                  <p className="text-sm font-semibold text-white">Mounted app</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Choose what this shell mounts, or remove an app entirely.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(switchingAppId) || Boolean(deletingAppId)}
                  onClick={() => setAppsOpen(false)}
                  className="rounded-lg bg-[#1a1a1f] px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-[#25252b] disabled:cursor-wait disabled:opacity-50"
                >
                  Close
                </button>
              </div>

              <div className="max-h-[70vh] overflow-y-auto px-4 py-4 sm:px-8 sm:py-6">
                {apps.length > 0 ? (
                  <div className="space-y-3">
                    {apps.map((app: any) => {
                      const isCurrent = app.appId === appId;
                      const isSwitching = switchingAppId === app.appId;
                      const isDeleting = deletingAppId === app.appId;
                      const appActionPending = Boolean(switchingAppId) || Boolean(deletingAppId);
                      const appBoxes = (app.boxes as any[] | undefined) ?? (app.box ? [app.box] : []);

                      return (
                        <article
                          key={app.appId}
                          className="rounded-2xl border border-white/8 bg-[#141419] px-4 py-4 sm:px-5"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-base font-semibold text-white">
                                  {app.name}
                                </p>
                                <span className="rounded-md bg-black/20 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                                  {app.appId}
                                </span>
                                {app.templateSourceStatus === "missing" ? (
                                  <span className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-amber-500/20">
                                    Source missing
                                  </span>
                                ) : null}
                                {isCurrent ? (
                                  <span className="rounded-md bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-300 ring-1 ring-cyan-500/20">
                                    Mounted
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-2 text-xs text-gray-500">
                                {app.activeVersion
                                  ? `Active v${app.activeVersion.versionNumber} · ${app.activeVersion.runtimeHealth}`
                                  : "No active version"}
                              </p>
                              {appBoxes.length > 0 ? (
                                <div className="mt-3 space-y-2">
                                  {appBoxes.map((box: any) => {
                                    const boxBusy = boxActionKey === box.boxId;
                                    const boxIsPrimary = isPrimaryBox(box);
                                    return (
                                      <div
                                        key={box.boxId}
                                        className="rounded-xl border border-white/6 bg-black/20 px-3 py-3"
                                      >
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-xs font-semibold text-gray-200">
                                            {formatBoxLabel(box)}
                                          </span>
                                          {boxIsPrimary ? (
                                            <span className="rounded-md bg-white/6 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                                              Primary
                                            </span>
                                          ) : null}
                                          {isCurrent && selectedBox?.boxId === box.boxId ? (
                                            <span className="rounded-md bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-300 ring-1 ring-cyan-500/20">
                                              Selected
                                            </span>
                                          ) : null}
                                          {isCurrent && promptTargetBoxIds.includes(box.boxId) ? (
                                            <span className="rounded-md bg-fuchsia-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-300 ring-1 ring-fuchsia-500/20">
                                              Targeted
                                            </span>
                                          ) : null}
                                        </div>
                                        <p className="mt-1 text-xs text-gray-500">
                                          {formatBoxSummary(box)}
                                        </p>
                                        {(box.policy?.instructions || box.lastError) ? (
                                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-gray-500">
                                            {box.lastError ?? box.policy?.instructions}
                                          </p>
                                        ) : null}
                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                          {isCurrent ? (
                                            <button
                                              type="button"
                                              onClick={() => setSelectedBoxId(box.boxId)}
                                              className="inline-flex h-8 items-center rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 text-[11px] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                                            >
                                              Use
                                            </button>
                                          ) : null}
                                          <button
                                            type="button"
                                            disabled={Boolean(boxActionKey)}
                                            onClick={async () => {
                                              const nextRole = window.prompt(
                                                `Role for ${box.boxId}`,
                                                box.policy?.role ?? "",
                                              );
                                              if (nextRole === null) {
                                                return;
                                              }
                                              const nextInstructions = window.prompt(
                                                `Instructions for ${box.boxId}`,
                                                box.policy?.instructions ?? "",
                                              );
                                              if (nextInstructions === null) {
                                                return;
                                              }
                                              setBoxActionKey(box.boxId);
                                              try {
                                                await updateBoxPolicyMutation({
                                                  boxId: box.boxId,
                                                  role: nextRole.trim() || null,
                                                  instructions: nextInstructions.trim() || null,
                                                  readOnly: box.policy?.readOnly === true,
                                                  proposalOnly: box.policy?.proposalOnly === true,
                                                  canPromote: box.policy?.canPromote === true,
                                                });
                                              } finally {
                                                setBoxActionKey(null);
                                              }
                                            }}
                                            className="inline-flex h-8 items-center rounded-lg border border-white/10 bg-[#1a1a1f] px-2.5 text-[11px] font-medium text-gray-300 transition-colors hover:bg-[#25252b] disabled:cursor-wait disabled:opacity-50"
                                          >
                                            {boxBusy ? "Saving..." : "Edit"}
                                          </button>
                                          <button
                                            type="button"
                                            disabled={Boolean(boxActionKey)}
                                            onClick={async () => {
                                              const scope = window.prompt(
                                                `New box scope cloned from ${box.boxId}`,
                                                "",
                                              );
                                              if (!scope) {
                                                return;
                                              }
                                              setBoxActionKey(box.boxId);
                                              try {
                                                await createBoxMutation({
                                                  appId: app.appId,
                                                  sourceBoxId: box.boxId,
                                                  scope,
                                                  role: box.policy?.role ?? null,
                                                  instructions: box.policy?.instructions ?? null,
                                                });
                                              } finally {
                                                setBoxActionKey(null);
                                              }
                                            }}
                                            className="inline-flex h-8 items-center rounded-lg border border-white/10 bg-[#1a1a1f] px-2.5 text-[11px] font-medium text-gray-300 transition-colors hover:bg-[#25252b] disabled:cursor-wait disabled:opacity-50"
                                          >
                                            Clone
                                          </button>
                                          {!boxIsPrimary ? (
                                            <button
                                              type="button"
                                              disabled={Boolean(boxActionKey)}
                                              onClick={async () => {
                                                const confirmed = window.confirm(
                                                  `Delete box '${box.boxId}'?`,
                                                );
                                                if (!confirmed) {
                                                  return;
                                                }
                                                setBoxActionKey(box.boxId);
                                                try {
                                                  await deleteBoxMutation({ boxId: box.boxId });
                                                  if (selectedBoxId === box.boxId) {
                                                    setSelectedBoxId(app.primaryBox?.boxId ?? null);
                                                  }
                                                } finally {
                                                  setBoxActionKey(null);
                                                }
                                              }}
                                              className="inline-flex h-8 items-center rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 text-[11px] font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-wait disabled:opacity-50"
                                            >
                                              Delete box
                                            </button>
                                          ) : null}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                              {app.lastBuildError ? (
                                <p className="mt-3 line-clamp-2 text-sm leading-6 text-rose-200/80">
                                  {app.lastBuildError}
                                </p>
                              ) : app.templateSourceStatus === "missing" ? (
                                <p className="mt-3 line-clamp-3 text-sm leading-6 text-amber-200/80">
                                  {app.templateSourceMessage ??
                                    "Mounted version is still available, but the local source app is missing."}
                                </p>
                              ) : app.lastRuntimeError ? (
                                <p className="mt-3 line-clamp-2 text-sm leading-6 text-amber-200/80">
                                  {app.lastRuntimeError}
                                </p>
                              ) : null}
                            </div>

                            <div className="shrink-0">
                              <div className="mb-2 flex justify-end">
                                <button
                                  type="button"
                                  disabled={Boolean(boxActionKey)}
                                  onClick={async () => {
                                    const scope = window.prompt(`New box scope for ${app.appId}`, "");
                                    if (!scope) {
                                      return;
                                    }
                                    const role = window.prompt("Role (optional)", scope) ?? null;
                                    const instructions = window.prompt("Instructions (optional)", "") ?? null;
                                    setBoxActionKey(`create:${app.appId}`);
                                    try {
                                      await createBoxMutation({
                                        appId: app.appId,
                                        sourceBoxId: app.primaryBox?.boxId ?? app.box?.boxId ?? null,
                                        scope,
                                        role: role?.trim() || null,
                                        instructions: instructions?.trim() || null,
                                      });
                                    } finally {
                                      setBoxActionKey(null);
                                    }
                                  }}
                                  className="inline-flex h-8 items-center rounded-lg border border-white/10 bg-[#1a1a1f] px-2.5 text-[11px] font-medium text-gray-300 transition-colors hover:bg-[#25252b] disabled:cursor-wait disabled:opacity-50"
                                >
                                  New box
                                </button>
                              </div>
                              {isCurrent ? (
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex h-9 items-center rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-300">
                                    Current
                                  </span>
                                  <button
                                    type="button"
                                    disabled={appActionPending}
                                    onClick={async () => {
                                      setSwitchingAppId(app.appId);
                                      try {
                                        await setSelectedAppMutation({
                                          shellId,
                                          appId: null,
                                        });
                                        setAppsOpen(false);
                                      } finally {
                                        setSwitchingAppId(null);
                                      }
                                    }}
                                    className="inline-flex h-9 items-center rounded-xl border border-white/10 bg-[#1a1a1f] px-3 text-xs font-medium text-gray-300 transition-colors hover:bg-[#25252b] disabled:cursor-wait disabled:opacity-50"
                                  >
                                    Unmount
                                  </button>
                                  <button
                                    type="button"
                                    disabled={appActionPending}
                                    onClick={async () => {
                                      const confirmed = window.confirm(
                                        `Delete app '${app.name}'? This removes its versions, jobs, and mounted history. Stored artifacts are purged in the background.`,
                                      );
                                      if (!confirmed) {
                                        return;
                                      }
                                      setDeletingAppId(app.appId);
                                      try {
                                        await deleteAppMutation({ appId: app.appId });
                                      } finally {
                                        setDeletingAppId(null);
                                      }
                                    }}
                                    className="inline-flex h-9 items-center rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-wait disabled:opacity-50"
                                  >
                                    {isDeleting ? "Deleting..." : "Delete"}
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={appActionPending}
                                    onClick={async () => {
                                      setSwitchingAppId(app.appId);
                                      try {
                                        await setSelectedAppMutation({
                                          shellId,
                                          appId: app.appId,
                                        });
                                        setAppsOpen(false);
                                      } finally {
                                        setSwitchingAppId(null);
                                      }
                                    }}
                                    className="inline-flex h-9 items-center rounded-xl bg-white px-3 text-xs font-medium text-black transition-colors hover:bg-gray-200 disabled:cursor-wait disabled:bg-white/10 disabled:text-gray-500"
                                  >
                                    {isSwitching ? "Switching..." : "Mount"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={appActionPending}
                                    onClick={async () => {
                                      const confirmed = window.confirm(
                                        `Delete app '${app.name}'? This removes its versions, jobs, and mounted history. Stored artifacts are purged in the background.`,
                                      );
                                      if (!confirmed) {
                                        return;
                                      }
                                      setDeletingAppId(app.appId);
                                      try {
                                        await deleteAppMutation({ appId: app.appId });
                                      } finally {
                                        setDeletingAppId(null);
                                      }
                                    }}
                                    className="inline-flex h-9 items-center rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-wait disabled:opacity-50"
                                  >
                                    {isDeleting ? "Deleting..." : "Delete"}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/8 bg-[#141419] px-4 py-6 text-sm text-gray-400">
                    No apps found yet. Seed an app first.
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {versionsOpen ? (
        <div
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
          onClick={() => {
            if (!switchingVersionId) {
              setVersionsOpen(false);
            }
          }}
        >
          <div className="flex min-h-screen items-center justify-center px-4 py-8">
            <section
              className="flex w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0c0c0f]/98 shadow-2xl shadow-black/40"
              role="dialog"
              aria-modal="true"
              aria-label="Version history"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-5 sm:px-8">
                <div>
                  <p className="text-sm font-semibold text-white">Version history</p>
                  <p className="mt-1 text-xs text-gray-500">
                    App <span className="font-medium text-gray-300">{selectedApp?.appId ?? appId ?? "none"}</span> only.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={comparedVersions.length !== 2 || Boolean(switchingVersionId)}
                    onClick={() => {
                      setCompareOpen(true);
                      setVersionsOpen(false);
                    }}
                    className="rounded-lg bg-cyan-500/12 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-gray-500"
                  >
                    Compare {comparedVersions.length === 2 ? "2 versions" : `(${comparedVersions.length}/2)`}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(switchingVersionId)}
                    onClick={() => setVersionsOpen(false)}
                    className="rounded-lg bg-[#1a1a1f] px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-[#25252b] disabled:cursor-wait disabled:opacity-50"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="max-h-[70vh] overflow-y-auto px-4 py-4 sm:px-8 sm:py-6">
                {versions.length > 0 ? (
                  <div className="space-y-3">
                    {versions.map((version: any) => {
                      const isActive = activeVersionId === version._id;
                      const isFailed = version.status === "failed";
                      const isSwitching = switchingVersionId === version._id;

                      return (
                        <article
                          key={version._id}
                          className="rounded-2xl border border-white/8 bg-[#141419] px-4 py-4 sm:px-5"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-base font-semibold text-white">
                                  v{version.versionNumber}
                                </p>
                                {isActive ? (
                                  <span className="rounded-md bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-300 ring-1 ring-cyan-500/20">
                                    Active
                                  </span>
                                ) : null}
                                <span className="rounded-md bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300 ring-1 ring-white/10">
                                  {version.status}
                                </span>
                                <span className="rounded-md bg-black/20 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                                  {version.runtimeHealth}
                                </span>
                              </div>
                              <p className="mt-2 text-xs text-gray-500">
                                {formatTimestamp(version.createdAt)}
                              </p>
                              {version.agentResult?.summary ? (
                                <p className="mt-3 text-sm leading-6 text-gray-300">
                                  {version.agentResult.summary}
                                </p>
                              ) : null}
                            </div>

                            <div className="shrink-0">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={
                                    Boolean(switchingVersionId) ||
                                    (!compareVersionIds.includes(version._id) && compareVersionIds.length >= 2)
                                  }
                                  onClick={() => {
                                    setCompareVersionIds((current) => {
                                      if (current.includes(version._id)) {
                                        return current.filter((value) => value !== version._id);
                                      }
                                      if (current.length >= 2) {
                                        return [current[1], version._id];
                                      }
                                      return [...current, version._id];
                                    });
                                  }}
                                  className={`inline-flex h-9 items-center rounded-xl px-3 text-xs font-medium transition-colors ${
                                    compareVersionIds.includes(version._id)
                                      ? "bg-fuchsia-500/16 text-fuchsia-100 ring-1 ring-fuchsia-400/30"
                                      : "bg-white/6 text-gray-300 hover:bg-white/10"
                                  } disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-gray-500`}
                                >
                                  {compareVersionIds.includes(version._id) ? "Compared" : "Compare"}
                                </button>
                                {isActive ? (
                                  <span className="inline-flex h-9 items-center rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-300">
                                    Current
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isFailed || Boolean(switchingVersionId)}
                                    onClick={async () => {
                                      setSwitchingVersionId(version._id);
                                      try {
                                        await activateVersionMutation({
                                          appId,
                                          versionId: version._id,
                                          mode: "manual",
                                        });
                                        setVersionsOpen(false);
                                      } finally {
                                        setSwitchingVersionId(null);
                                      }
                                    }}
                                    className="inline-flex h-9 items-center rounded-xl bg-white px-3 text-xs font-medium text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-500"
                                  >
                                    {isSwitching ? "Switching..." : isFailed ? "Unavailable" : "Activate"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/8 bg-[#141419] px-4 py-6 text-sm text-gray-400">
                    No versions found for this app yet.
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {compareOpen && comparedVersions.length === 2 ? (
        <div
          className="fixed inset-0 z-30 bg-black/72 backdrop-blur-sm"
          onClick={() => setCompareOpen(false)}
        >
          <div className="flex min-h-screen items-center justify-center px-4 py-6">
            <section
              className="flex h-[92vh] w-full max-w-[min(1440px,96vw)] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#07070a]/98 shadow-2xl shadow-black/50"
              role="dialog"
              aria-modal="true"
              aria-label="Version compare"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-5 sm:px-8">
                <div>
                  <p className="text-sm font-semibold text-white">Split compare</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Two isolated previews for{" "}
                    <span className="font-medium text-gray-300">{selectedApp?.appId ?? appId ?? "none"}</span>.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCompareOpen(false);
                      setVersionsOpen(true);
                    }}
                    className="rounded-lg bg-cyan-500/12 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                  >
                    Back to versions
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompareOpen(false)}
                    className="rounded-lg bg-[#1a1a1f] px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-[#25252b]"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto px-4 py-4 lg:grid-cols-2 lg:px-6 lg:py-6">
                {comparedVersions.map((version) => {
                  const isActive = activeVersionId === version._id;
                  const isSwitching = switchingVersionId === version._id;

                  return (
                    <article
                      key={version._id}
                      className="flex min-h-[420px] flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#111115]"
                    >
                      <div className="flex items-start justify-between gap-4 border-b border-white/8 px-4 py-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-white">v{version.versionNumber}</p>
                            {isActive ? (
                              <span className="rounded-md bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-300 ring-1 ring-cyan-500/20">
                                Current
                              </span>
                            ) : null}
                            <span className="rounded-md bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300 ring-1 ring-white/10">
                              {version.status}
                            </span>
                            <span className="rounded-md bg-black/20 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                              {version.runtimeHealth}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-gray-500">{formatTimestamp(version.createdAt)}</p>
                          {version.agentResult?.summary ? (
                            <p className="mt-3 text-sm leading-6 text-gray-300">
                              {version.agentResult.summary}
                            </p>
                          ) : (
                            <p className="mt-3 text-sm leading-6 text-gray-500">
                              No agent summary recorded for this version.
                            </p>
                          )}
                        </div>

                        <div className="shrink-0">
                          {isActive ? (
                            <span className="inline-flex h-9 items-center rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-300">
                              Current
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={Boolean(switchingVersionId)}
                              onClick={async () => {
                                if (!appId) {
                                  return;
                                }
                                setSwitchingVersionId(version._id);
                                try {
                                  await activateVersionMutation({
                                    appId,
                                    versionId: version._id,
                                    mode: "manual",
                                  });
                                  setCompareOpen(false);
                                } finally {
                                  setSwitchingVersionId(null);
                                }
                              }}
                              className="inline-flex h-9 items-center rounded-xl bg-white px-3 text-xs font-medium text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-500"
                            >
                              {isSwitching ? "Switching..." : "Make current"}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 bg-black">
                        <iframe
                          title={`Version ${version.versionNumber} preview`}
                          srcDoc={buildCompareFrameDoc(version)}
                          sandbox="allow-scripts allow-same-origin"
                          className="h-full min-h-[520px] w-full border-0 bg-black"
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </main>
  );
}
