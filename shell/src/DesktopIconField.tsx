import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  DragDropProvider,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
} from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { RestrictToElement } from "@dnd-kit/dom/modifiers";
import { DesktopActionCard, type DesktopActionCardAction } from "./DesktopActionCard";
import {
  desktopIconLayoutStorageKey,
  desktopIconSlotHeightPx,
  desktopIconSlotWidthPx,
  getDesktopGridMetrics,
  getDesktopSlotId,
  moveDesktopIconToSlot,
  normalizeDesktopIconLayout,
  parseDesktopIconLayout,
  parseDesktopSlotId,
  type DesktopIconLayout,
} from "./desktopIconLayout";

const desktopIconType = "desktop-app-icon";
const desktopSensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 8 })],
  }),
  KeyboardSensor,
];

type DesktopIconFieldApp = {
  appId: string;
  title: string;
  iconSrc?: string;
  selected?: boolean;
  actions?: DesktopActionCardAction[];
  onOpen: () => void;
};

function readStoredDesktopIconLayout() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return parseDesktopIconLayout(window.localStorage.getItem(desktopIconLayoutStorageKey));
  } catch {
    return null;
  }
}

function DesktopDropSlot(props: {
  slotIndex: number;
  columns: number;
  slotWidth: number;
  children?: ReactNode;
}) {
  const { slotIndex, columns, slotWidth, children } = props;
  const { ref, isDropTarget } = useDroppable({
    id: getDesktopSlotId(slotIndex),
    accept: desktopIconType,
  });
  const column = slotIndex % columns;
  const row = Math.floor(slotIndex / columns);

  return (
    <div
      ref={ref}
      className="absolute overflow-visible px-1 pt-2"
      style={{
        left: `${column * slotWidth}px`,
        top: `${row * desktopIconSlotHeightPx}px`,
        width: `${slotWidth}px`,
        height: `${desktopIconSlotHeightPx}px`,
      }}
    >
      <div
        className={`pointer-events-none absolute inset-2 rounded-[1.35rem] border transition-colors ${
          isDropTarget
            ? "border-cyan-200/35 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(103,232,249,0.12)]"
            : "border-transparent"
        }`}
      />
      <div className="relative flex h-full w-full items-start justify-center">{children}</div>
    </div>
  );
}

function DesktopDraggableIcon(props: { app: DesktopIconFieldApp }) {
  const { app } = props;
  const { ref, isDragging } = useDraggable({
    id: app.appId,
    type: desktopIconType,
    data: { appId: app.appId },
    feedback: "move",
  });

  return (
    <DesktopActionCard
      ref={ref}
      title={app.title}
      iconSrc={app.iconSrc}
      selected={app.selected}
      actions={app.actions}
      onClick={app.onOpen}
      className={`touch-none ${isDragging ? "cursor-grabbing opacity-70" : "cursor-grab active:cursor-grabbing"}`}
    />
  );
}

export function DesktopIconField(props: { apps: DesktopIconFieldApp[] }) {
  const { apps } = props;
  const appIds = apps.map((app) => app.appId);
  const appIdsSignature = appIds.join("\u0000");
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const [fieldSize, setFieldSize] = useState({ width: 0, height: 0 });
  const [draggingAppId, setDraggingAppId] = useState<string | null>(null);
  const [layout, setLayout] = useState<DesktopIconLayout>(() =>
    normalizeDesktopIconLayout(appIds, readStoredDesktopIconLayout()),
  );

  useEffect(() => {
    setLayout((currentLayout) => {
      const persistedLayout = readStoredDesktopIconLayout();
      return normalizeDesktopIconLayout(appIds, {
        ...(persistedLayout ?? {}),
        ...currentLayout,
      });
    });
  }, [appIdsSignature]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(desktopIconLayoutStorageKey, JSON.stringify(layout));
    } catch {
      // Ignore storage failures. The desktop still works without persistence.
    }
  }, [layout]);

  useEffect(() => {
    const element = fieldRef.current;
    if (!element) {
      return;
    }

    const syncSize = () => {
      setFieldSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    syncSize();

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => syncSize())
        : null;

    resizeObserver?.observe(element);
    window.addEventListener("resize", syncSize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncSize);
    };
  }, []);

  const assignedSlots = Object.values(layout);
  const metrics = getDesktopGridMetrics({
    width: fieldSize.width,
    height: fieldSize.height,
    appCount: apps.length,
    assignedSlots,
  });
  const slotCount = metrics.slotCount;
  const fieldHeightPx = Math.max(metrics.fieldHeight, fieldSize.height, 448);
  const fieldWidthPx = Math.max(metrics.columns * metrics.slotWidth, fieldSize.width, desktopIconSlotWidthPx);
  const slots = Array.from({ length: slotCount }, (_, slotIndex) => slotIndex);
  const appsBySlotIndex = new Map<number, DesktopIconFieldApp>();

  for (const app of apps) {
    const slotIndex = layout[app.appId];
    if (slotIndex !== undefined) {
      appsBySlotIndex.set(slotIndex, app);
    }
  }

  const handleDragStart: NonNullable<ComponentProps<typeof DragDropProvider>["onDragStart"]> = (
    event,
  ) => {
    const sourceId = event.operation.source?.id;
    setDraggingAppId(typeof sourceId === "string" ? sourceId : null);
  };

  const handleDragEnd: NonNullable<ComponentProps<typeof DragDropProvider>["onDragEnd"]> = (
    event,
  ) => {
    setDraggingAppId(null);

    if (event.canceled) {
      return;
    }

    const sourceId = event.operation.source?.id;
    const targetId = event.operation.target?.id;

    if (typeof sourceId !== "string") {
      return;
    }

    const targetSlotIndex = parseDesktopSlotId(
      typeof targetId === "string" ? targetId : null,
    );

    if (targetSlotIndex === null || targetSlotIndex >= slotCount) {
      return;
    }

    setLayout((currentLayout) =>
      moveDesktopIconToSlot(appIds, currentLayout, sourceId, targetSlotIndex),
    );
  };

  return (
    <div
      ref={fieldRef}
      className="relative min-h-[28rem] flex-1 w-full"
    >
      <DragDropProvider
        modifiers={[
          RestrictToElement.configure({
            element: () => fieldRef.current,
          }),
        ]}
        sensors={desktopSensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          className="relative min-h-full"
          style={{
            width: `${fieldWidthPx}px`,
            height: `${fieldHeightPx}px`,
          }}
        >
          {slots.map((slotIndex) => (
            <DesktopDropSlot
              key={slotIndex}
              slotIndex={slotIndex}
              columns={metrics.columns}
              slotWidth={metrics.slotWidth}
            >
              {appsBySlotIndex.get(slotIndex) ? (
                <DesktopDraggableIcon app={appsBySlotIndex.get(slotIndex)!} />
              ) : null}
            </DesktopDropSlot>
          ))}
        </div>
      </DragDropProvider>
    </div>
  );
}
