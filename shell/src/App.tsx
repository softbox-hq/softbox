import { startTransition, useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpFromLine, Check, Crosshair, Trash2 } from "lucide-react";
import { convexApi } from "@shared/convexApi";
import type { LiveAppState } from "@shared/liveApp";
import { defaultAppId } from "@shared/liveApp";
import { useLiveAppRuntime } from "./runtime";
import { getOrCreateShellId } from "./shellId";
import { getRuntimeStatus } from "./state";
import "./styles.css";

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
  const appsQuery = useQuery(convexApi.listApps as any, {}) as any[] | undefined;
  const apps = appsQuery ?? [];
  const shellSelectedAppId = shellSelection?.selectedAppId ?? null;
  const hasPersistedSelection = shellSelection?.updatedAt != null;
  const selectedAppExists = shellSelectedAppId
    ? apps.some((app) => app.appId === shellSelectedAppId)
    : false;
  const appId = selectedAppExists
    ? shellSelectedAppId
    : hasPersistedSelection && shellSelectedAppId === null
      ? null
      : apps[0]?.appId ?? defaultAppId;
  const selectedApp = appId ? apps.find((app) => app.appId === appId) ?? null : null;
  const shellState = useQuery(
    convexApi.getShellState as any,
    appId ? { appId } : "skip",
  ) as any;
  const versions = (useQuery(
    convexApi.listVersions as any,
    appId ? { appId } : "skip",
  ) as any[]) ?? [];
  const setSelectedAppMutation = useMutation(convexApi.setSelectedApp as any);
  const deleteAppMutation = useMutation(convexApi.deleteApp as any);
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
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [switchingAppId, setSwitchingAppId] = useState<string | null>(null);
  const [deletingAppId, setDeletingAppId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [switchingVersionId, setSwitchingVersionId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selectionMode, setSelectionMode] = useState<SelectionMode | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<InspectTarget | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<InspectTarget[]>([]);
  const [draftRegion, setDraftRegion] = useState<InspectRegion | null>(null);
  const [selectedRegions, setSelectedRegions] = useState<InspectRegion[]>([]);
  const [composerHidden, setComposerHidden] = useState(false);

  const runtimeStatus = getRuntimeStatus(shellState);
  const lastBuildError = shellState?.lastBuildError ?? null;
  const hasActiveVersion = Boolean(shellState?.activeVersion);
  const showEmptyState =
    shellState === undefined || shellState === null || !hasActiveVersion;
  const showErrorBanner = !showEmptyState && (runtimeStatus || lastBuildError);
  const latestPipelineRuns = shellState?.latestPipelineRuns ?? [];
  const latestPipelineRun = shellState?.latestPipelineRun ?? latestPipelineRuns[0] ?? null;
  const activeVersionId = shellState?.activeVersion?._id ?? null;
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
    setSwitchingVersionId(null);
    setExpandedRunId(null);
    setDeletingRunId(null);
    setSelectionMode(null);
    setHoveredTarget(null);
    setSelectedTargets([]);
    setDraftRegion(null);
    setSelectedRegions([]);
  }, [appId]);

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
    if (!appsOpen && !pipelineOpen && !versionsOpen) {
      return;
    }
    setSelectionMode(null);
    setHoveredTarget(null);
    setDraftRegion(null);
  }, [appsOpen, pipelineOpen, versionsOpen]);

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
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
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

      {showEmptyState ? (
        <section className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden px-6">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_42%),linear-gradient(180deg,rgba(3,4,6,0.86),rgba(3,4,6,0.96))]" />
          <div className="pointer-events-auto relative w-full max-w-xl overflow-hidden rounded-[2rem] bg-[#0f1012]/92 p-8 text-center shadow-[0_36px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
            <div className="absolute inset-x-10 top-0 h-px bg-white/8" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
              Shell Host
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {emptyStateTitle}
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-300">
              {emptyStateBody}
            </p>
            <div className="mt-6 rounded-2xl bg-black/20 px-4 py-3 text-left text-xs leading-6 text-gray-400">
              <p className="font-medium text-gray-300">Next steps</p>
              <p>1. {emptyStateSteps[0]}</p>
              <p>2. {emptyStateSteps[1]}</p>
            </div>
          </div>
        </section>
      ) : null}

      {composerHidden ? (
        <button
          type="button"
          onClick={() => setComposerHidden(false)}
          className="fixed bottom-5 right-5 z-[13] rounded-full border border-white/10 bg-[#141414]/90 px-4 py-2 text-xs font-medium text-gray-100 shadow-2xl shadow-black/30 backdrop-blur-xl transition-colors hover:bg-[#202024]"
        >
          Show controls
        </button>
      ) : null}

      <section
        className={`relative z-10 flex min-h-screen items-end justify-center px-4 py-6 transition-[opacity,transform] duration-200 ease-out sm:px-6 sm:py-8 ${
          composerHidden
            ? "pointer-events-none translate-y-6 opacity-0"
            : "pointer-events-none translate-y-0 opacity-100"
        }`}
      >
        <div
          className={`w-full max-w-3xl transition-[opacity,transform] duration-200 ease-out ${
            composerHidden
              ? "pointer-events-none translate-y-3 opacity-0"
              : "pointer-events-auto translate-y-0 opacity-100"
          }`}
        >
          {showErrorBanner ? (
            <div className="mb-4 rounded-[1.5rem] border border-rose-500/25 bg-slate-950/85 px-4 py-3 text-sm text-rose-100 shadow-xl shadow-black/20 backdrop-blur-2xl">
              <p className="font-semibold">
                {runtimeStatus?.title ?? "Build Error"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-rose-100/80">
                {runtimeStatus?.body ?? lastBuildError}
              </p>
            </div>
          ) : null}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!prompt.trim() || promptDisabled) return;
              setSubmitting(true);
              try {
                setSelectionMode(null);
                setHoveredTarget(null);
                setDraftRegion(null);
                await submitPrompt({
                  appId,
                  prompt: buildPromptWithSelectionContext(
                    prompt,
                    selectedTargets,
                    selectedRegions,
                  ),
                });
                startTransition(() => setPrompt(""));
                setSelectedTargets([]);
                setSelectedRegions([]);
              } finally {
                setSubmitting(false);
              }
            }}
            className="mx-auto w-full max-w-2xl"
          >
            <div className="rounded-2xl border border-white/10 bg-[#141414]/95 p-3 shadow-2xl shadow-black/25 backdrop-blur-2xl">
              {templateSourceMissing ? (
                <div className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                  <p className="font-semibold text-amber-200">
                    Mounted version still works, but edits are disabled.
                  </p>
                  <p className="mt-1 text-amber-100/80">
                    {templateSourceMessage ??
                      "This app can still mount its existing built version, but its local source is missing from /apps."}
                  </p>
                </div>
              ) : null}
              {queuedTooLong ? (
                <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-100">
                  <p className="font-semibold text-rose-200">
                    Queued for 1 minute. Did you forget to run Docker?
                  </p>
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
                <div className="mb-3 rounded-xl bg-cyan-400/10 px-3 py-2 text-xs leading-5 text-cyan-100">
                  <p className="font-semibold text-cyan-200">Inspect mode is on.</p>
                  <p className="mt-1 text-cyan-100/80">
                    Click mounted app elements to add or remove them from the next prompt. Selected targets stay highlighted on the app. Press Escape or click Inspect again when done.
                  </p>
                </div>
              ) : null}
              {pixelInspectMode ? (
                <div className="mb-3 rounded-xl bg-fuchsia-400/10 px-3 py-2 text-xs leading-5 text-fuchsia-100">
                  <p className="font-semibold text-fuchsia-200">Pixel mode is on.</p>
                  <p className="mt-1 text-fuchsia-100/80">
                    Drag across the mounted app to select a pixel region for the next prompt. Click an existing region to remove it. Press Escape or click Pixels again when done.
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
                className="min-h-[60px] w-full resize-none bg-transparent px-1 text-sm text-gray-200 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed disabled:text-gray-500"
                rows={2}
              />

              <div className="mt-2 flex items-center justify-between border-t border-[#1f1f1f] pt-2">
                {/* <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-lg bg-[#1f1f1f] text-gray-400 transition-colors hover:bg-[#2a2a2a] hover:text-gray-300"
                  >
                    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    className="flex h-7 items-center gap-1.5 rounded-lg bg-[#1f1f1f] px-2.5 text-gray-400 transition-colors hover:bg-[#2a2a2a] hover:text-gray-300"
                  >
                    <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.9 4.9L19 10l-5.1 2.1L12 17l-1.9-4.9L5 10l5.1-2.1L12 3z" />
                    </svg>
                    <span className="text-xs font-medium">{versionLabel}</span>
                    <svg className="size-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25L12 15.75 4.5 8.25" />
                    </svg>
                  </button>
                </div> */}
                <div className="flex min-w-0 items-center gap-2.5">
                  {pipelineProgress.status === "completed" ? (
                    <div className="flex size-7 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                      <Check className="size-4" />
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-gray-300">
                      {pipelineProgress.activeLabel}
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      {pipelineProgress.total > 0
                        ? `${pipelineProgress.currentStep}/${pipelineProgress.total}`
                        : "0/0"}
                      {" · "}
                      {elapsedSeconds}s
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={noMountedApp || showEmptyState}
                    onClick={() => {
                      setSelectionMode((current) =>
                        current === "elements" ? null : "elements",
                      );
                      setHoveredTarget(null);
                      setDraftRegion(null);
                    }}
                    className={`flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      inspectMode
                        ? "bg-cyan-400 text-slate-950 hover:bg-cyan-300"
                        : "bg-[#1f1f1f] text-gray-300 hover:bg-[#2a2a2a]"
                    }`}
                  >
                    <Crosshair className="size-3.5" />
                    {inspectMode ? "Inspecting" : "Inspect"}
                  </button>

                  <button
                    type="button"
                    disabled={noMountedApp || showEmptyState}
                    onClick={() => {
                      setSelectionMode((current) =>
                        current === "pixels" ? null : "pixels",
                      );
                      setHoveredTarget(null);
                      setDraftRegion(null);
                    }}
                    className={`flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      pixelInspectMode
                        ? "bg-fuchsia-300 text-slate-950 hover:bg-fuchsia-200"
                        : "bg-[#1f1f1f] text-gray-300 hover:bg-[#2a2a2a]"
                    }`}
                  >
                    <Crosshair className="size-3.5" />
                    {pixelInspectMode ? "Pixels on" : "Pixels"}
                  </button>

                  {/* <button
                    type="button"
                    className="flex h-7 items-center gap-1.5 rounded-lg bg-[#1f1f1f] px-2.5 text-gray-400 transition-colors hover:bg-[#2a2a2a] hover:text-gray-300"
                  >
                    <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A2.25 2.25 0 015.25 5.25h13.5A2.25 2.25 0 0121 7.5v9A2.25 2.25 0 0118.75 18.75H5.25A2.25 2.25 0 013 16.5v-9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 9.75h9M7.5 14.25h4.5" />
                    </svg>
                    <span className="text-xs font-medium">Project</span>
                    <svg className="size-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25L12 15.75 4.5 8.25" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-lg bg-[#1f1f1f] text-gray-400 transition-colors hover:bg-[#2a2a2a] hover:text-gray-300"
                  >
                    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a3.75 3.75 0 003.75-3.75v-6a3.75 3.75 0 10-7.5 0v6A3.75 3.75 0 0012 18.75z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12a7.5 7.5 0 01-15 0M12 19.5v2.25" />
                    </svg>
                  </button> */}

                  <button
                    type="button"
                    onClick={() => setAppsOpen(true)}
                    className="flex h-7 items-center rounded-lg bg-[#1f1f1f] px-3 text-xs font-medium text-gray-300 transition-colors hover:bg-[#2a2a2a]"
                  >
                    {selectedApp?.appId ?? appId ?? "No app"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPipelineOpen(true);
                      setExpandedRunId(latestPipelineRuns[0]?._id ?? null);
                    }}
                    disabled={noMountedApp}
                    className="flex h-7 items-center rounded-lg bg-[#1f1f1f] px-3 text-xs font-medium text-gray-300 transition-colors hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Pipeline
                  </button>

                  <button
                    type="button"
                    onClick={() => setVersionsOpen(true)}
                    disabled={noMountedApp}
                    className="flex h-7 items-center rounded-lg bg-[#1f1f1f] px-3 text-xs font-medium text-gray-300 transition-colors hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Versions
                  </button>

                  <button
                    type="submit"
                    disabled={submitting || promptDisabled}
                    className="flex size-7 items-center justify-center rounded-lg bg-white text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60"
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
                    <ArrowUpFromLine className={`size-4 ${submitting ? "animate-pulse" : ""}`} />
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
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
                                <span className="rounded-md bg-black/20 px-2 py-1 font-medium text-gray-400">
                                  {run.templateId ?? "unknown template"}
                                </span>
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
                                <span className="rounded-md bg-white/5 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-300 ring-1 ring-white/10">
                                  {app.templateId ?? "unknown template"}
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
                              {app.lastBuildError ? (
                                <p className="mt-3 line-clamp-2 text-sm leading-6 text-rose-200/80">
                                  {app.lastBuildError}
                                </p>
                              ) : app.templateSourceStatus === "missing" ? (
                                <p className="mt-3 line-clamp-3 text-sm leading-6 text-amber-200/80">
                                  {app.templateSourceMessage ??
                                    "Mounted version is still available, but the local source template is missing."}
                                </p>
                              ) : app.lastRuntimeError ? (
                                <p className="mt-3 line-clamp-2 text-sm leading-6 text-amber-200/80">
                                  {app.lastRuntimeError}
                                </p>
                              ) : null}
                            </div>

                            <div className="shrink-0">
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
                <button
                  type="button"
                  disabled={Boolean(switchingVersionId)}
                  onClick={() => setVersionsOpen(false)}
                  className="rounded-lg bg-[#1a1a1f] px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-[#25252b] disabled:cursor-wait disabled:opacity-50"
                >
                  Close
                </button>
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
    </main>
  );
}
