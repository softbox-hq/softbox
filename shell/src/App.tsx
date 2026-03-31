import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DependencyList,
  type RefObject,
} from "react";
import { useMutation, useQuery } from "convex/react";
import {
  CircleAlert,
  AppWindow,
  ArrowUpFromLine,
  ListRestart,
  SquareDashedMousePointer,
  SquareMousePointer,
  Trash2,
  X,
} from "lucide-react";
import { convexApi } from "@shared/convexApi";
import type { LiveAppState } from "@shared/liveApp";
import { defaultAppId, defaultShellId } from "@shared/liveApp";
import {
  SOFTBOX_APP_ROOT_SELECTOR,
  SOFTBOX_RUNTIME_FRAME_SELECTOR,
  useLiveAppRuntime,
} from "./runtime";
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

const PIPELINE_STAGE_KEYS = [
  "queued",
  "agent",
  "build",
  "upload",
  "publish",
  "preview",
  "activate",
] as const;

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

function isAgentMetadataLine(line: string) {
  const cleaned = line.replace(/^[-*]\s+/u, "").trim();
  if (!cleaned) {
    return true;
  }

  return (
    /^(starting agent rewrite|agent observation|stdout:|stderr:|commit:|warning:|error:)/iu.test(cleaned) ||
    /^(mode|command|model|agent_id|thread|session_key|session_id|timeout_ms|request_chars|prompt_chars|editable_files|source_bytes|likely_targets):/iu.test(
      cleaned,
    ) ||
    /^(build_prompt|agent_turn|reread_files|diff|summarize|total_rewrite|stdout_chars|stderr_chars|changed_paths|written_files|deleted_paths|changed_preview):/iu.test(
      cleaned,
    ) ||
    /^(timing|output):/iu.test(cleaned)
  );
}

function getLatestStageDetailLine(detail: unknown, stageKey?: string | null) {
  const lines = getDetailLines(detail, stageKey);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}

function getDetailLines(detail: unknown, stageKey?: string | null) {
  if (typeof detail !== "string") {
    return [];
  }

  const lines = detail
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (stageKey === "agent") {
    return lines.filter((line) => !isAgentMetadataLine(line));
  }

  return lines;
}

function getRunStageDetailLines(run: any, stageKey: string) {
  const stage = run?.stages?.find((candidate: any) => candidate.key === stageKey);
  return getDetailLines(stage?.detail, stageKey);
}

function getStageDisplayDetail(detail: unknown, stageKey?: string | null) {
  const lines = getDetailLines(detail, stageKey);
  return lines.length > 0 ? lines.join("\n") : null;
}

function getRunProgress(run: any) {
  const stages = run?.stages ?? [];
  if (!run) {
    return {
      status: "idle",
      activeLabel: "Ready",
      activeDetailLine: null,
      currentStep: 0,
      total: PIPELINE_STAGE_KEYS.length,
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
    activeDetailLine: getLatestStageDetailLine(activeStage?.detail, activeStage?.key),
    currentStep,
    total: PIPELINE_STAGE_KEYS.length,
  };
}

function getFailedStage(run: any) {
  const stages = Array.isArray(run?.stages) ? run.stages : [];
  const failedStages = stages
    .filter((stage: any) => stage?.status === "failed")
    .sort((left: any, right: any) => (right?.sortOrder ?? 0) - (left?.sortOrder ?? 0));
  return failedStages[0] ?? null;
}

function getRepairableStage(run: any) {
  if (run?.status !== "failed") {
    return null;
  }
  return getFailedStage(run);
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

type ActiveRuntimeSurface = {
  layer: HTMLElement;
  boundary: HTMLElement;
  frame: HTMLIFrameElement | null;
  document: Document;
  window: Window;
};

type SelectionMode = "elements" | "pixels";

type ThoughtBubble = {
  id: string;
  runId: string;
  message: string;
};

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

function isHtmlElementTarget(target: EventTarget | null): target is HTMLElement {
  return Boolean(
    target &&
      typeof target === "object" &&
      "nodeType" in target &&
      (target as Node).nodeType === Node.ELEMENT_NODE &&
      "tagName" in target,
  );
}

function isTypingEventTarget(target: EventTarget | null) {
  if (!isHtmlElementTarget(target)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]'))
  );
}

function getActiveRuntimeSurface(host: HTMLElement): ActiveRuntimeSurface | null {
  const layer = host.querySelector<HTMLElement>('[data-layer="active"]');
  if (!layer) {
    return null;
  }

  const frame = layer.querySelector<HTMLIFrameElement>(SOFTBOX_RUNTIME_FRAME_SELECTOR);
  if (frame?.contentDocument && frame.contentWindow) {
    const boundary =
      frame.contentDocument.querySelector<HTMLElement>(SOFTBOX_APP_ROOT_SELECTOR) ??
      frame.contentDocument.body;
    if (!boundary) {
      return null;
    }
    return {
      layer,
      boundary,
      frame,
      document: frame.contentDocument,
      window: frame.contentWindow,
    };
  }

  return {
    layer,
    boundary: layer,
    frame: null,
    document: layer.ownerDocument,
    window,
  };
}

function useRuntimeHotkey(
  hostRef: RefObject<HTMLDivElement | null>,
  onKeyDown: (event: KeyboardEvent) => void,
  deps: DependencyList,
) {
  useEffect(() => {
    const host = hostRef.current;
    const cleanupFns: Array<() => void> = [];
    const attachedTargets = new Set<EventTarget>();

    const attachToTarget = (target: EventTarget | null | undefined) => {
      if (!target || attachedTargets.has(target)) {
        return;
      }
      attachedTargets.add(target);
      target.addEventListener("keydown", onKeyDown as EventListener);
      cleanupFns.push(() => {
        target.removeEventListener("keydown", onKeyDown as EventListener);
      });
    };

    const bindTargets = () => {
      attachToTarget(window);
      attachToTarget(document);
      if (!host) {
        return;
      }
      const activeSurface = getActiveRuntimeSurface(host);
      attachToTarget(activeSurface?.window);
      attachToTarget(activeSurface?.document);
    };

    bindTargets();

    if (host && typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => {
        bindTargets();
      });
      observer.observe(host, {
        childList: true,
        subtree: true,
      });
      cleanupFns.push(() => observer.disconnect());
    }

    return () => {
      while (cleanupFns.length > 0) {
        cleanupFns.pop()?.();
      }
    };
  }, deps);
}

function getInspectBoundarySelector(boundary: HTMLElement) {
  return boundary.matches(SOFTBOX_APP_ROOT_SELECTOR)
    ? SOFTBOX_APP_ROOT_SELECTOR
    : '[data-layer="active"]';
}

function translateFrameRectToViewport(rect: DOMRect, frame: HTMLIFrameElement | null): InspectRect {
  if (!frame) {
    return clampRect(rect);
  }

  const frameRect = frame.getBoundingClientRect();
  return {
    x: frameRect.left + rect.left,
    y: frameRect.top + rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function getSurfaceBoundaryRect(surface: ActiveRuntimeSurface) {
  return surface.frame?.getBoundingClientRect() ?? surface.boundary.getBoundingClientRect();
}

function translateFramePointToViewport(
  frame: HTMLIFrameElement | null,
  x: number,
  y: number,
) {
  if (!frame) {
    return { x, y };
  }
  const frameRect = frame.getBoundingClientRect();
  return {
    x: frameRect.left + x,
    y: frameRect.top + y,
  };
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
    segments.unshift(getInspectBoundarySelector(boundary));
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

function snapshotInspectTarget(
  element: HTMLElement,
  boundary: HTMLElement,
  frame: HTMLIFrameElement | null = null,
): InspectTarget {
  return {
    selector: buildSelector(element, boundary),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute("role") ?? getImplicitRole(element),
    label: getElementLabel(element),
    rect: translateFrameRectToViewport(element.getBoundingClientRect(), frame),
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
  const requestPipelineRepairMutation = useMutation(convexApi.requestPipelineRepair as any);
  const publishStateMutation = useMutation(convexApi.publishState as any);
  const activateVersionMutation = useMutation(convexApi.activateVersion as any);
  const resetBoxSessionMutation = useMutation(convexApi.resetBoxSession as any);
  const deleteVersionMutation = useMutation(convexApi.deleteVersion as any);
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
  const [repairingRunId, setRepairingRunId] = useState<string | null>(null);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null);
  const [repairModalRunId, setRepairModalRunId] = useState<string | null>(null);
  const [resettingBoxSessionId, setResettingBoxSessionId] = useState<string | null>(null);
  const [boxActionKey, setBoxActionKey] = useState<string | null>(null);
  const [switchingVersionId, setSwitchingVersionId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selectionMode, setSelectionMode] = useState<SelectionMode | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<InspectTarget | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<InspectTarget[]>([]);
  const [draftRegion, setDraftRegion] = useState<InspectRegion | null>(null);
  const [selectedRegions, setSelectedRegions] = useState<InspectRegion[]>([]);
  const [composerHidden, setComposerHidden] = useState(false);
  const [thoughtBubbles, setThoughtBubbles] = useState<ThoughtBubble[]>([]);
  const [dismissedThoughtBubbleIds, setDismissedThoughtBubbleIds] = useState<string[]>([]);
  const [runtimeMountTransitioning, setRuntimeMountTransitioning] = useState(false);
  const [runtimeTransitionKind, setRuntimeTransitionKind] = useState<"application" | "version" | null>(null);
  const lastMountedVersionRef = useRef<any | null>(null);

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
  const canResetSelectedBoxSession =
    Boolean(appId) &&
    Boolean(selectedBox?.boxId) &&
    selectedBox?.engine === "openclaw";
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
  const noMountedApp = appId === null;
  if (shellState?.activeVersion) {
    lastMountedVersionRef.current = shellState.activeVersion;
  } else if (noMountedApp) {
    lastMountedVersionRef.current = null;
  }
  const runtimeActiveVersion =
    noMountedApp ? null : shellState?.activeVersion ?? lastMountedVersionRef.current;
  const hasActiveVersion = Boolean(runtimeActiveVersion);
  const showEmptyState = noMountedApp || !hasActiveVersion;
  const showErrorBanner = !showEmptyState && (runtimeStatus || lastBuildError);
  const showRuntimeTransitionOverlay = Boolean(
    switchingAppId ||
      switchingVersionId ||
      runtimeMountTransitioning ||
      (!noMountedApp && shellState === undefined && lastMountedVersionRef.current),
  );
  const runtimeTransitionLabel =
    runtimeTransitionKind === "version" ? "Switching version..." : "Switching application...";
  const latestPipelineRuns = shellState?.latestPipelineRuns ?? [];
  const latestPipelineRun = shellState?.latestPipelineRun ?? latestPipelineRuns[0] ?? null;
  const activeVersionId = runtimeActiveVersion?._id ?? null;
  const mountedVersionLabel =
    typeof runtimeActiveVersion?.versionNumber === "number"
      ? `v${runtimeActiveVersion.versionNumber}`
      : "Versions";
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
  const pipelineElapsedLabel = formatDuration(elapsedMs);
  const queuedTooLong =
    latestPipelineRun?.status === "pending" && elapsedSeconds >= 60;
  const inspectMode = selectionMode === "elements";
  const pixelInspectMode = selectionMode === "pixels";
  const boxIdsSignature = currentBoxes.map((box: any) => box.boxId).join("|");
  const pipelineStepLabel =
    pipelineProgress.total > 0
      ? `${pipelineProgress.currentStep}/${pipelineProgress.total}`
      : "0/0";
  const pipelineInlineThought =
    latestPipelineRun && pipelineProgress.status === "running"
      ? pipelineProgress.activeDetailLine
      : null;
  const agentThoughtLines = getRunStageDetailLines(latestPipelineRun, "agent");
  const agentThoughtSignature = agentThoughtLines.join("\n");
  const visibleThoughtBubbles = thoughtBubbles
    .filter((bubble) => !dismissedThoughtBubbleIds.includes(bubble.id))
    .slice();
  const combinedThoughtMessage = visibleThoughtBubbles
    .map((bubble) => truncateText(bubble.message, 180) ?? bubble.message)
    .join("\n\n");
  const pipelineToneClass =
    pipelineProgress.status === "completed"
      ? "bg-emerald-500/12 text-emerald-200"
      : pipelineProgress.status === "failed"
        ? "bg-rose-500/12 text-rose-100 ring-1 ring-rose-500/25"
        : pipelineProgress.status === "running"
          ? "bg-amber-500/12 text-amber-100 ring-1 ring-amber-500/25"
          : "bg-white/8 text-slate-200 ring-1 ring-white/10";
  const versionActionPending = Boolean(switchingVersionId) || Boolean(deletingVersionId);
  const openPipelinePanel = () => {
    setPipelineOpen(true);
    setExpandedRunId(latestPipelineRuns[0]?._id ?? null);
  };
  const repairModalRun =
    repairModalRunId
      ? latestPipelineRuns.find((run: any) => run._id === repairModalRunId) ?? null
      : null;
  const repairModalStage = getRepairableStage(repairModalRun);
  const repairModalStageDetail = getStageDisplayDetail(
    repairModalStage?.detail ?? repairModalRun?.buildError ?? null,
    repairModalStage?.key ?? repairModalRun?.failureStage ?? null,
  );

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
    setThoughtBubbles([]);
    setDismissedThoughtBubbleIds([]);
  }, [latestPipelineRun?._id]);

  useEffect(() => {
    const runId = latestPipelineRun?._id;
    if (!runId || latestPipelineRun?.status !== "running" || agentThoughtLines.length === 0) {
      return;
    }

    setThoughtBubbles((current) => {
      const existingIds = new Set(current.map((bubble) => bubble.id));
      let changed = false;
      const next = [...current];

      agentThoughtLines.forEach((message, index) => {
        const id = `${runId}:agent:${index}`;
        if (existingIds.has(id)) {
          return;
        }
        next.push({
          id,
          runId,
          message,
        });
        changed = true;
      });

      return changed ? next : current;
    });
  }, [agentThoughtSignature, agentThoughtLines, latestPipelineRun?._id, latestPipelineRun?.status]);

  useEffect(() => {
    setAppsOpen(false);
    setSwitchingAppId(null);
    setVersionsOpen(false);
    setCompareOpen(false);
    setCompareVersionIds([]);
    setSwitchingVersionId(null);
    setDeletingVersionId(null);
    setResettingBoxSessionId(null);
    setExpandedRunId(null);
    setDeletingRunId(null);
    setRepairingRunId(null);
    setRepairModalRunId(null);
    setSelectionMode(null);
    setHoveredTarget(null);
    setSelectedTargets([]);
    setDraftRegion(null);
    setSelectedRegions([]);
    setSelectedBoxId(null);
    setSelectedTargetBoxIds([]);
  }, [appId]);

  useEffect(() => {
    if (switchingAppId) {
      setRuntimeTransitionKind("application");
      return;
    }
    if (switchingVersionId) {
      setRuntimeTransitionKind("version");
    }
  }, [switchingAppId, switchingVersionId]);

  useEffect(() => {
    if (!runtimeMountTransitioning) {
      setRuntimeTransitionKind(null);
    }
  }, [runtimeMountTransitioning]);

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
    const activeSurface = hostRef.current ? getActiveRuntimeSurface(hostRef.current) : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectionMode(null);
        setHoveredTarget(null);
        setDraftRegion(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    if (activeSurface && activeSurface.window !== window) {
      activeSurface.window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (activeSurface && activeSurface.window !== window) {
        activeSurface.window.removeEventListener("keydown", handleKeyDown);
      }
    };
  }, [selectionMode, shellState?.activeVersion?._id]);

  useEffect(() => {
    if (!inspectMode) {
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const activeSurface = getActiveRuntimeSurface(host);
    if (!activeSurface) {
      return;
    }

    activeSurface.layer.dataset.inspecting = "true";
    if (activeSurface.frame) {
      activeSurface.frame.dataset.inspecting = "true";
      activeSurface.document.documentElement.style.cursor = "crosshair";
      if (activeSurface.document.body) {
        activeSurface.document.body.style.cursor = "crosshair";
      }
    }

    const updateHoveredTarget = (target: EventTarget | null) => {
      if (!isHtmlElementTarget(target)) {
        setHoveredTarget(null);
        return;
      }
      const inspectable = pickInspectableElement(target, activeSurface.boundary);
      if (!inspectable) {
        setHoveredTarget(null);
        return;
      }
      setHoveredTarget(snapshotInspectTarget(inspectable, activeSurface.boundary, activeSurface.frame));
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateHoveredTarget(event.target);
    };

    const handlePointerLeave = () => {
      setHoveredTarget(null);
    };

    const handleScroll = () => {
      setHoveredTarget(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!isHtmlElementTarget(event.target)) {
        return;
      }
      const inspectable = pickInspectableElement(event.target, activeSurface.boundary);
      if (!inspectable) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const snapshot = snapshotInspectTarget(
        inspectable,
        activeSurface.boundary,
        activeSurface.frame,
      );
      setSelectedTargets((current) => toggleInspectTargetSelection(current, snapshot));
      setHoveredTarget(snapshot);
    };

    activeSurface.document.addEventListener("pointermove", handlePointerMove, true);
    activeSurface.document.addEventListener("pointerleave", handlePointerLeave, true);
    activeSurface.document.addEventListener("pointerdown", handlePointerDown, true);
    activeSurface.window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      delete activeSurface.layer.dataset.inspecting;
      if (activeSurface.frame) {
        delete activeSurface.frame.dataset.inspecting;
        activeSurface.document.documentElement.style.cursor = "";
        if (activeSurface.document.body) {
          activeSurface.document.body.style.cursor = "";
        }
      }
      activeSurface.document.removeEventListener("pointermove", handlePointerMove, true);
      activeSurface.document.removeEventListener("pointerleave", handlePointerLeave, true);
      activeSurface.document.removeEventListener("pointerdown", handlePointerDown, true);
      activeSurface.window.removeEventListener("scroll", handleScroll);
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
    const activeSurface = getActiveRuntimeSurface(host);
    if (!activeSurface) {
      return;
    }

    activeSurface.layer.dataset.inspecting = "true";
    if (activeSurface.frame) {
      activeSurface.frame.dataset.inspecting = "true";
      activeSurface.document.documentElement.style.cursor = "crosshair";
      if (activeSurface.document.body) {
        activeSurface.document.body.style.cursor = "crosshair";
      }
    }

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
      if (!isHtmlElementTarget(event.target)) {
        return;
      }
      const boundaryRect = getSurfaceBoundaryRect(activeSurface);
      const startPoint = translateFramePointToViewport(
        activeSurface.frame,
        event.clientX,
        event.clientY,
      );
      const start = clampPointToRect(startPoint.x, startPoint.y, boundaryRect);
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

    const updateDraftRegion = (clientX: number, clientY: number) => {
      if (!dragStart || !dragBoundary) {
        return;
      }
      const point = translateFramePointToViewport(activeSurface.frame, clientX, clientY);
      const rect = createSelectionRect(
        dragStart.x,
        dragStart.y,
        point.x,
        point.y,
        dragBoundary,
      );
      setDraftRegion(createInspectRegion("draft", rect, dragBoundary));
    };

    const handleSurfacePointerMove = (event: PointerEvent) => {
      updateDraftRegion(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
    };

    const completeDraftRegion = (clientX: number, clientY: number) => {
      if (!dragStart || !dragBoundary) {
        return;
      }
      const boundary = dragBoundary;
      const point = translateFramePointToViewport(activeSurface.frame, clientX, clientY);
      const rect = createSelectionRect(
        dragStart.x,
        dragStart.y,
        point.x,
        point.y,
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
    };

    const handleSurfacePointerUp = (event: PointerEvent) => {
      completeDraftRegion(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
      finishDrag();
    };

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (!activeSurface.frame) {
        return;
      }
      updateDraftRegion(event.clientX, event.clientY);
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      if (!activeSurface.frame) {
        return;
      }
      completeDraftRegion(event.clientX, event.clientY);
      finishDrag();
    };

    const handlePointerCancel = () => {
      finishDrag();
    };

    activeSurface.document.addEventListener("pointerdown", handlePointerDown, true);
    activeSurface.document.addEventListener("pointermove", handleSurfacePointerMove, true);
    activeSurface.document.addEventListener("pointerup", handleSurfacePointerUp, true);
    activeSurface.document.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("pointermove", handleWindowPointerMove, true);
    window.addEventListener("pointerup", handleWindowPointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);

    return () => {
      delete activeSurface.layer.dataset.inspecting;
      if (activeSurface.frame) {
        delete activeSurface.frame.dataset.inspecting;
        activeSurface.document.documentElement.style.cursor = "";
        if (activeSurface.document.body) {
          activeSurface.document.body.style.cursor = "";
        }
      }
      activeSurface.document.removeEventListener("pointerdown", handlePointerDown, true);
      activeSurface.document.removeEventListener("pointermove", handleSurfacePointerMove, true);
      activeSurface.document.removeEventListener("pointerup", handleSurfacePointerUp, true);
      activeSurface.document.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("pointermove", handleWindowPointerMove, true);
      window.removeEventListener("pointerup", handleWindowPointerUp, true);
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
    const activeSurface = getActiveRuntimeSurface(host);
    if (!activeSurface) {
      return;
    }

    const refreshSelectedTargets = () => {
      setSelectedTargets((current) => {
        let changed = false;
        const next = current.map((target) => {
          const element = activeSurface.document.querySelector<HTMLElement>(target.selector);
          if (!element || !activeSurface.boundary.contains(element)) {
            return target;
          }
          const snapshot = snapshotInspectTarget(
            element,
            activeSurface.boundary,
            activeSurface.frame,
          );
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
    activeSurface.layer.addEventListener("scroll", refreshSelectedTargets, { passive: true });
    activeSurface.window.addEventListener("scroll", refreshSelectedTargets, { passive: true });
    activeSurface.window.addEventListener("resize", refreshSelectedTargets);
    window.addEventListener("resize", refreshSelectedTargets);

    return () => {
      activeSurface.layer.removeEventListener("scroll", refreshSelectedTargets);
      activeSurface.window.removeEventListener("scroll", refreshSelectedTargets);
      activeSurface.window.removeEventListener("resize", refreshSelectedTargets);
      window.removeEventListener("resize", refreshSelectedTargets);
    };
  }, [selectedTargets.length, shellState?.activeVersion?._id]);

  useRuntimeHotkey(
    hostRef,
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (event.key.toLowerCase() !== "k" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (!composerHidden && isTypingEventTarget(event.target)) {
        return;
      }
      event.preventDefault();
      setComposerHidden((current) => !current);
      setSelectionMode(null);
      setHoveredTarget(null);
      setDraftRegion(null);
    },
    [composerHidden, shellState?.activeVersion?._id, hostRef],
  );

  useRuntimeHotkey(
    hostRef,
    (event: KeyboardEvent) => {
      if (!appId) {
        return;
      }
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !event.shiftKey ||
        versionActionPending ||
        submitting ||
        appsOpen ||
        pipelineOpen ||
        versionsOpen ||
        compareOpen
      ) {
        return;
      }
      if (isTypingEventTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key !== "a" && key !== "d") {
        return;
      }

      const currentIndex = versions.findIndex((version: any) => version._id === activeVersionId);
      if (currentIndex < 0) {
        return;
      }

      const targetIndex = key === "d" ? currentIndex + 1 : currentIndex - 1;
      const targetVersion = versions[targetIndex];
      if (!targetVersion || targetVersion.status === "failed") {
        return;
      }

      event.preventDefault();
      setSwitchingVersionId(targetVersion._id);
      void activateVersionMutation({
        appId,
        versionId: targetVersion._id,
        mode: "manual",
      }).finally(() => {
        setSwitchingVersionId((current) =>
          current === targetVersion._id ? null : current,
        );
      });
    },
    [
    activeVersionId,
    activateVersionMutation,
    appId,
    appsOpen,
    compareOpen,
    pipelineOpen,
    submitting,
    versionActionPending,
    versions,
    versionsOpen,
    hostRef,
  ],
  );

  useRuntimeHotkey(
    hostRef,
    (event: KeyboardEvent) => {
      if (
        !appId ||
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !event.shiftKey ||
        switchingAppId ||
        deletingAppId ||
        submitting ||
        pipelineOpen ||
        versionsOpen ||
        compareOpen ||
        isTypingEventTarget(event.target)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key !== "w" && key !== "s") {
        return;
      }

      const currentIndex = apps.findIndex((app) => app.appId === appId);
      if (currentIndex < 0) {
        return;
      }

      const targetIndex = key === "w" ? currentIndex - 1 : currentIndex + 1;
      const targetApp = apps[targetIndex];
      if (!targetApp) {
        return;
      }

      event.preventDefault();
      setSwitchingAppId(targetApp.appId);
      void setSelectedAppMutation({
        shellId,
        appId: targetApp.appId,
      }).finally(() => {
        setSwitchingAppId((current) => (current === targetApp.appId ? null : current));
      });
    },
    [
      appId,
      apps,
      compareOpen,
      deletingAppId,
      pipelineOpen,
      setSelectedAppMutation,
      shellId,
      submitting,
      switchingAppId,
      versionsOpen,
      hostRef,
    ],
  );

  useLiveAppRuntime(hostRef, {
    appId: appId ?? "__unmounted__",
    activeVersion: runtimeActiveVersion,
    nextReadyVersion: shellState?.nextReadyVersion ?? null,
    onMountTransitionChange: setRuntimeMountTransitioning,
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

      {showRuntimeTransitionOverlay ? (
        <div className="pointer-events-none absolute inset-0 z-[9]">
          <div className="absolute inset-0 bg-black/8" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-[#0c0c0f]/78 px-4 py-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.38)] backdrop-blur-xl">
              <span
                className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80"
                aria-hidden="true"
              />
              <span className="text-xs font-medium text-slate-200">
                {runtimeTransitionLabel}
              </span>
            </div>
          </div>
        </div>
      ) : null}

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
        <div className="mx-auto flex w-full max-w-6xl flex-col-reverse gap-3 lg:flex-row lg:items-end lg:justify-center">
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
          className="pointer-events-auto w-full max-w-3xl"
        >
          <div className="overflow-hidden rounded-[1.25rem] bg-[#101317]/90 shadow-[0_20px_64px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
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
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !event.ctrlKey || event.nativeEvent.isComposing) {
                    return;
                  }
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
                placeholder={
                  noMountedApp
                    ? "Mount an app to submit prompts."
                    : templateSourceMissing
                      ? "Restore the app source in /apps to submit new prompts."
                      : "Describe what you want to change..."
                }
                disabled={promptDisabled}
                className="min-h-[64px] w-full resize-none rounded-[1rem] bg-transparent px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:text-slate-500"
                rows={3}
              />

              <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-center">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={noMountedApp || showEmptyState}
                    onClick={() => {
                      setSelectionMode((current) => (current === "elements" ? null : "elements"));
                      setHoveredTarget(null);
                      setDraftRegion(null);
                    }}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      inspectMode
                        ? "bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                        : "text-slate-200 hover:bg-white/10"
                    }`}
                    title={inspectMode ? "Inspecting" : "Inspect"}
                    aria-label={inspectMode ? "Inspecting" : "Inspect"}
                  >
                    <SquareMousePointer className="size-3.5" />
                  </button>

                  <button
                    type="button"
                    disabled={noMountedApp || showEmptyState}
                    onClick={() => {
                      setSelectionMode((current) => (current === "pixels" ? null : "pixels"));
                      setHoveredTarget(null);
                      setDraftRegion(null);
                    }}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      pixelInspectMode
                        ? "bg-fuchsia-300 text-slate-950 hover:bg-fuchsia-200"
                        : "text-slate-200 hover:bg-white/10"
                    }`}
                    title={pixelInspectMode ? "Pixels on" : "Pixels"}
                    aria-label={pixelInspectMode ? "Pixels on" : "Pixels"}
                  >
                    <SquareDashedMousePointer className="size-3.5" />
                  </button>

                  {/* <label className="flex h-9 items-center gap-2 rounded-xl px-3 text-xs text-slate-300 transition-colors hover:bg-white/10">
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
                  </label> */}

                  <button
                    type="button"
                    disabled={!canResetSelectedBoxSession || resettingBoxSessionId === selectedBox?.boxId}
                    onClick={async () => {
                      if (!appId || !selectedBox?.boxId) {
                        return;
                      }
                      const confirmed = window.confirm(
                        `Reset the saved OpenClaw session for box '${formatBoxLabel(selectedBox)}'? The next prompt will start a fresh conversation context.`,
                      );
                      if (!confirmed) {
                        return;
                      }
                      setResettingBoxSessionId(selectedBox.boxId);
                      try {
                        await resetBoxSessionMutation({
                          appId,
                          boxId: selectedBox.boxId,
                        });
                      } finally {
                        setResettingBoxSessionId((current) =>
                          current === selectedBox.boxId ? null : current,
                        );
                      }
                    }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Reset Session"
                    aria-label="Reset Session"
                  >
                    <ListRestart className="size-3.5" />
                  </button>
                </div>

                {pipelineInlineThought ? (
                  <div className="hidden min-w-0 flex-1 items-center px-2 lg:flex">
                    <p
                      className="w-full truncate text-xs text-slate-400"
                      title={pipelineInlineThought}
                    >
                      {pipelineInlineThought}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-1.5 xl:ml-auto">
                  <button
                    type="button"
                    onClick={() => setAppsOpen(true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10"
                    title={selectedApp?.name ?? appId ?? "Apps"}
                  >
                    <AppWindow className="size-3.5" />
                    {selectedApp?.name ?? appId ?? "Apps"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setVersionsOpen(true)}
                    disabled={noMountedApp}
                    className="inline-flex h-9 items-center rounded-xl px-3 text-xs font-medium tabular-nums text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Versions"
                  >
                    {mountedVersionLabel}
                  </button>

                  {latestPipelineRun ? (
                    <button
                      type="button"
                      onClick={openPipelinePanel}
                      disabled={noMountedApp}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${pipelineToneClass}`}
                      title={
                        pipelineProgress.activeDetailLine
                          ? `${pipelineProgress.activeLabel} · ${pipelineProgress.activeDetailLine} · ${pipelineElapsedLabel}`
                          : `${pipelineProgress.activeLabel} · ${pipelineElapsedLabel}`
                      }
                    >
                      {pipelineStepLabel}
                      <span className="text-[11px] opacity-80">{pipelineElapsedLabel}</span>
                    </button>
                  ) : null}

                  <button
                    type="submit"
                    disabled={submitting || promptDisabled}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
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
                  </button>
                </div>
              </div>

            </div>
          </div>
        </form>
        {visibleThoughtBubbles.length > 0 ? (
          <aside className="pointer-events-auto w-full max-w-sm lg:mb-3 lg:w-80 lg:shrink-0">
            <div className="max-h-[45vh] overflow-y-auto rounded-[1.15rem] bg-[#0f1318]/92 p-2 shadow-[0_20px_64px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Openclaw says:
              </p>
              <article className="rounded-2xl bg-white/6 px-3 py-2.5 text-xs text-slate-200 ring-1 ring-white/8">
                <div className="flex items-start gap-2">
                  <p
                    className="min-w-0 flex-1 whitespace-pre-wrap leading-5 text-slate-200"
                    title={combinedThoughtMessage}
                  >
                    {combinedThoughtMessage}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setDismissedThoughtBubbleIds((current) => [
                        ...current,
                        ...visibleThoughtBubbles
                          .map((bubble) => bubble.id)
                          .filter((id) => !current.includes(id)),
                      ])
                    }
                    className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
                    aria-label="Dismiss notes"
                    title="Dismiss notes"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </article>
            </div>
          </aside>
        ) : null}
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
                      const runProgress = getRunProgress(run);
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
                              {runProgress.activeDetailLine ? (
                                <p className="mt-2 truncate text-xs text-gray-500">
                                  {runProgress.activeDetailLine}
                                </p>
                              ) : null}
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
                                  const stageDisplayDetail = getStageDisplayDetail(
                                    stage.detail,
                                    stage.key,
                                  );
                                  const canRepairStage =
                                    run.status === "failed" &&
                                    stage.status === "failed" &&
                                    Boolean(appId);
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
                                          {canRepairStage ? (
                                            <button
                                              type="button"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                setRepairModalRunId(run._id);
                                              }}
                                              className="mt-2 inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-200 transition-colors hover:bg-rose-500/20"
                                              title="Repair this failed run"
                                            >
                                              <CircleAlert className="size-3.5" />
                                              Repair
                                            </button>
                                          ) : null}
                                        </div>
                                      </div>
                                      {stageDisplayDetail ? (
                                        <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-gray-400">
                                          {stageDisplayDetail}
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

      {repairModalRun ? (
        <div
          className="fixed inset-0 z-30 bg-black/65 backdrop-blur-sm"
          onClick={() => {
            if (!repairingRunId) {
              setRepairModalRunId(null);
            }
          }}
        >
          <div className="flex min-h-screen items-center justify-center px-4 py-8">
            <section
              className="flex w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-rose-500/15 bg-[#0c0c0f]/98 shadow-2xl shadow-black/40"
              role="dialog"
              aria-modal="true"
              aria-label="Repair failed run"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5 sm:px-8">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CircleAlert className="size-4 text-rose-300" />
                    <p className="text-sm font-semibold text-white">Repair failed run</p>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Review the failed stage and send a repair job to the agent.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(repairingRunId)}
                  onClick={() => setRepairModalRunId(null)}
                  className="rounded-lg bg-[#1a1a1f] px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-[#25252b] disabled:cursor-wait disabled:opacity-50"
                >
                  Close
                </button>
              </div>

              <div className="space-y-4 px-6 py-5 sm:px-8">
                <div className="rounded-2xl border border-white/8 bg-[#141419] px-4 py-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Prompt</p>
                  <p className="mt-2 text-sm leading-6 text-gray-100">{repairModalRun.prompt}</p>
                </div>

                <div className="rounded-2xl border border-rose-500/15 bg-rose-500/5 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-rose-100">
                      {repairModalStage?.label ?? "Failed stage"}
                    </p>
                    <span className="rounded-md bg-black/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-200/80">
                      {repairModalStage?.key ?? repairModalRun.failureStage ?? "unknown"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-rose-100/70">
                    {repairModalRun.failureClassification ?? "code_app"}
                  </p>
                  <div className="mt-3 rounded-xl bg-black/20 px-3 py-3">
                    <p className="whitespace-pre-wrap text-xs leading-6 text-gray-300">
                      {repairModalStageDetail ?? "No failure detail was recorded for this run."}
                    </p>
                  </div>
                </div>

                <p className="text-sm leading-6 text-gray-400">
                  This will create a new repair job that tells the agent to fix the failed candidate
                  in place instead of restarting from the live version.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-4 sm:px-8">
                <button
                  type="button"
                  disabled={Boolean(repairingRunId)}
                  onClick={() => setRepairModalRunId(null)}
                  className="rounded-xl border border-white/10 bg-[#1a1a1f] px-4 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-[#25252b] disabled:cursor-wait disabled:opacity-50"
                >
                  No
                </button>
                <button
                  type="button"
                  disabled={Boolean(repairingRunId) || !appId}
                  onClick={async () => {
                    if (!appId) {
                      return;
                    }
                    setRepairingRunId(repairModalRun._id);
                    try {
                      await requestPipelineRepairMutation({
                        appId,
                        runId: repairModalRun._id,
                      });
                      setPipelineOpen(false);
                      setRepairModalRunId(null);
                    } finally {
                      setRepairingRunId((current) =>
                        current === repairModalRun._id ? null : current,
                      );
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-400 disabled:cursor-wait disabled:bg-rose-500/40"
                >
                  <CircleAlert className="size-3.5" />
                  {repairingRunId === repairModalRun._id ? "Repairing..." : "Yes, repair"}
                </button>
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
            if (!versionActionPending) {
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
                    disabled={comparedVersions.length !== 2 || versionActionPending}
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
                    disabled={versionActionPending}
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
                      const isDeleting = deletingVersionId === version._id;

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
                                    versionActionPending ||
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
                                  <>
                                    <button
                                      type="button"
                                      disabled={versionActionPending}
                                      onClick={async () => {
                                        const confirmed = window.confirm(
                                          `Delete version v${version.versionNumber} from history? This removes it from Softbox version history but does not purge shared build artifacts.`,
                                        );
                                        if (!confirmed || !appId) {
                                          return;
                                        }
                                        setDeletingVersionId(version._id);
                                        try {
                                          await deleteVersionMutation({
                                            appId,
                                            versionId: version._id,
                                          });
                                        } finally {
                                          setDeletingVersionId((current) =>
                                            current === version._id ? null : current,
                                          );
                                        }
                                      }}
                                      className="inline-flex h-9 items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-wait disabled:opacity-50"
                                    >
                                      <Trash2 className="size-3.5" />
                                      {isDeleting ? "Deleting..." : "Delete"}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isFailed || versionActionPending}
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
                                  </>
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
                              disabled={versionActionPending}
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
