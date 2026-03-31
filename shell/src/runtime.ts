import { useEffect, useRef, useState, type RefObject } from "react";
import { liveManifestSchema, type LiveManifest } from "@shared/manifest";
import {
  liveAppStateSchema,
  type JsonObject,
  type LiveAppState,
  type RuntimeErrorPayload,
} from "@shared/liveApp";

type VersionRecord = {
  _id: string;
  appId: string;
  versionNumber: number;
  status: "ready" | "active" | "failed";
  manifestUrl: string;
  stateJson: string;
};

type RuntimeOptions = {
  appId: string;
  activeVersion: VersionRecord | null;
  nextReadyVersion: VersionRecord | null;
  onMountTransitionChange?(isTransitioning: boolean): void;
  publishState(state: LiveAppState): Promise<void>;
  activateVersion(versionId: string): Promise<void>;
  reportRuntimeError(args: {
    versionId?: string;
    message: string;
    stack?: string;
  }): Promise<void>;
  recordPipelineStageForVersion(args: {
    versionId: string;
    key: string;
    status: "running" | "completed" | "failed";
    detail?: string;
  }): Promise<void>;
};

type MountedLayer = {
  versionId: string;
  layer: HTMLDivElement;
  frame: HTMLIFrameElement;
  unmount(): Promise<void>;
};

type PublishedStateSnapshot = {
  versionId: string;
  state: LiveAppState;
};

type RuntimeFrameBridge = {
  publishState(state: LiveAppState): void;
  reportHealthy(): void;
  reportError(error: RuntimeErrorPayload): void;
};

type RuntimeFrameMountArgs = {
  entryUrl: string;
  cssUrls: string[];
  initialStateJson: string;
};

type RuntimeFrameWindow = Window &
  typeof globalThis & {
    __SOFTBOX_BRIDGE__?: RuntimeFrameBridge;
    __softboxMount?: (args: RuntimeFrameMountArgs) => Promise<void>;
    __softboxUnmount?: () => Promise<void>;
  };

const ACTIVE_CSS_SELECTOR = 'link[data-softbox-active-css="true"]';
const RUNTIME_FRAME_MIN_HEIGHT = 800;

export const SOFTBOX_RUNTIME_FRAME_SELECTOR = 'iframe[data-softbox-runtime-frame="true"]';
export const SOFTBOX_APP_ROOT_SELECTOR = '[data-softbox-app-root="true"]';

function buildRuntimeFrameDoc() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        min-height: 100%;
        background: #000;
      }

      body {
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior-y: contain;
      }

      #root[data-softbox-app-root="true"] {
        height: 100%;
        min-height: 100%;
      }
    </style>
  </head>
  <body>
    <div id="root" data-softbox-app-root="true"></div>
    <script type="module">
      const ROOT_SELECTOR = ${JSON.stringify(SOFTBOX_APP_ROOT_SELECTOR)};
      const FRAME_CSS_SELECTOR = 'link[data-softbox-frame-css="true"]';
      let mountedModule = null;

      const getBridge = () => window.__SOFTBOX_BRIDGE__;

      const getRoot = () => {
        const root = document.querySelector(ROOT_SELECTOR);
        if (!(root instanceof HTMLElement)) {
          throw new Error("Softbox runtime root missing");
        }
        return root;
      };

      const normalizeError = (error) =>
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { message: String(error) };

      const reportError = (error) => {
        getBridge()?.reportError?.(normalizeError(error));
      };

      const clearFrameCss = () => {
        document.querySelectorAll(FRAME_CSS_SELECTOR).forEach((node) => node.remove());
      };

      const unmountCurrent = async () => {
        if (mountedModule && typeof mountedModule.unmount === "function") {
          await mountedModule.unmount();
        }
        mountedModule = null;
        getRoot().innerHTML = "";
        clearFrameCss();
      };

      window.__softboxUnmount = async () => {
        await unmountCurrent();
      };

      window.__softboxMount = async ({ entryUrl, cssUrls, initialStateJson }) => {
        await unmountCurrent();

        for (const href of cssUrls ?? []) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = href;
          link.dataset.softboxFrameCss = "true";
          document.head.appendChild(link);
        }

        const module = await import(entryUrl);
        if (typeof module.mount !== "function" || typeof module.unmount !== "function") {
          throw new Error("Live app module is missing mount/unmount exports");
        }

        mountedModule = module;
        const bridge = getBridge();
        await module.mount({
          root: getRoot(),
          initialState: JSON.parse(initialStateJson),
          publishState: (state) => bridge?.publishState?.(state),
          reportHealthy: () => bridge?.reportHealthy?.(),
          reportError: (error) => reportError(error),
        });
      };

      window.addEventListener("error", (event) => {
        if (event.error) {
          reportError(event.error);
        }
      });

      window.addEventListener("unhandledrejection", (event) => {
        reportError(event.reason);
      });
    </script>
  </body>
</html>`;
}

function clearActiveCss() {
  document
    .querySelectorAll<HTMLLinkElement>(ACTIVE_CSS_SELECTOR)
    .forEach((node) => node.remove());
}

function withCacheBust(url: string, cacheBust: string) {
  const nextUrl = new URL(url);
  nextUrl.searchParams.set("t", cacheBust);
  return nextUrl.toString();
}

async function waitForFrameLoad(frame: HTMLIFrameElement) {
  if (frame.contentWindow && frame.contentDocument?.readyState === "complete") {
    return;
  }

  await new Promise<void>((resolve) => {
    const handleLoad = () => resolve();
    frame.addEventListener("load", handleLoad, { once: true });
  });
}

async function createRuntimeFrame(layer: HTMLDivElement) {
  const frame = document.createElement("iframe");
  frame.className = "runtime-frame";
  frame.dataset.softboxRuntimeFrame = "true";
  frame.setAttribute("title", "Softbox runtime");

  const loaded = waitForFrameLoad(frame);
  frame.srcdoc = buildRuntimeFrameDoc();
  layer.innerHTML = "";
  layer.appendChild(frame);
  await loaded;

  return frame;
}

function getRuntimeFrameWindow(frame: HTMLIFrameElement) {
  const frameWindow = frame.contentWindow as RuntimeFrameWindow | null;
  if (!frameWindow) {
    throw new Error("Softbox runtime frame window is unavailable");
  }
  return frameWindow;
}

async function mountVersionInLayer(args: {
  layer: HTMLDivElement;
  versionId: string;
  manifest: LiveManifest;
  initialState: LiveAppState;
  publishState(state: LiveAppState): void;
  reportHealthy(): void;
  reportError(error: RuntimeErrorPayload): void;
}) {
  const { initialState, layer, manifest, publishState, reportError, reportHealthy, versionId } = args;
  const frame = await createRuntimeFrame(layer);
  const frameWindow = getRuntimeFrameWindow(frame);
  let currentHeight = 0;
  const syncFrameHeight = () => {
    const nextHeight = Math.max(
      RUNTIME_FRAME_MIN_HEIGHT,
      Math.ceil(layer.getBoundingClientRect().height || layer.clientHeight),
    );
    if (nextHeight === currentHeight) {
      return;
    }
    currentHeight = nextHeight;
    frame.style.height = `${nextHeight}px`;
    notifyViewportChange();
  };
  syncFrameHeight();
  const layerResizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => syncFrameHeight())
      : null;
  layerResizeObserver?.observe(layer);
  window.addEventListener("resize", syncFrameHeight);

  frameWindow.__SOFTBOX_BRIDGE__ = {
    publishState,
    reportHealthy,
    reportError,
  };

  const cacheBust = Date.now().toString();

  try {
    const mount = frameWindow.__softboxMount;
    if (typeof mount !== "function") {
      throw new Error("Softbox runtime frame is missing mount()");
    }
    await mount({
      entryUrl: withCacheBust(manifest.entryUrl, cacheBust),
      cssUrls: (manifest.cssUrls ?? []).map((href) => withCacheBust(href, cacheBust)),
      initialStateJson: JSON.stringify(initialState),
    });
  } catch (error) {
    layerResizeObserver?.disconnect();
    window.removeEventListener("resize", syncFrameHeight);
    frameWindow.__SOFTBOX_BRIDGE__ = undefined;
    await Promise.resolve(frameWindow.__softboxUnmount?.()).catch(() => undefined);
    frame.remove();
    throw error;
  }

  return {
    versionId,
    layer,
    frame,
    async unmount() {
      layerResizeObserver?.disconnect();
      window.removeEventListener("resize", syncFrameHeight);
      const runtimeWindow = frame.contentWindow as RuntimeFrameWindow | null;
      if (runtimeWindow) {
        runtimeWindow.__SOFTBOX_BRIDGE__ = undefined;
        await Promise.resolve(runtimeWindow.__softboxUnmount?.()).catch(() => undefined);
      }
      if (frame.isConnected) {
        frame.remove();
      }
    },
  } satisfies MountedLayer;
}

export async function loadManifest(manifestUrl: string) {
  console.info("[shell] loading manifest", manifestUrl);
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load manifest: ${response.status}`);
  }
  return liveManifestSchema.parse(await response.json());
}

function ensureLayer(parent: HTMLDivElement, name: string) {
  let layer = parent.querySelector<HTMLDivElement>(`[data-layer="${name}"]`);
  if (layer) {
    return layer;
  }
  layer = document.createElement("div");
  layer.dataset.layer = name;
  layer.className = "runtime-layer";
  parent.appendChild(layer);
  return layer;
}

function notifyViewportChange() {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  });
}

function isPlainStateObject(state: LiveAppState): state is JsonObject {
  return Boolean(
    state &&
      typeof state === "object" &&
      !Array.isArray(state),
  );
}

function readShellRoute() {
  if (typeof window === "undefined") {
    return "/";
  }
  return window.location.pathname || "/";
}

function applyShellRouteToState(state: LiveAppState) {
  if (!isPlainStateObject(state) || typeof state.route !== "string") {
    return state;
  }
  return {
    ...(state as JsonObject),
    route: readShellRoute(),
  } as LiveAppState;
}

function syncShellRouteFromState(state: LiveAppState) {
  if (!isPlainStateObject(state) || typeof state.route !== "string" || typeof window === "undefined") {
    return null;
  }
  const route = state.route || "/";
  if (window.location.pathname !== route) {
    const nextUrl = `${route}${window.location.search}${window.location.hash}`;
    window.history.pushState(window.history.state, "", nextUrl);
  }
  return route;
}

export function shouldLoadCandidateVersion(args: {
  activeVersion: VersionRecord | null;
  nextReadyVersion: VersionRecord | null;
  previewVersionId: string | null;
}): boolean {
  const { activeVersion, nextReadyVersion, previewVersionId } = args;
  if (!nextReadyVersion) {
    return false;
  }
  if (activeVersion && nextReadyVersion.versionNumber <= activeVersion.versionNumber) {
    return false;
  }
  return previewVersionId !== nextReadyVersion._id;
}

export function useLiveAppRuntime(
  hostRef: RefObject<HTMLDivElement | null>,
  options: RuntimeOptions,
) {
  const activeMountRef = useRef<MountedLayer | null>(null);
  const previewVersionRef = useRef<string | null>(null);
  const previousAppIdRef = useRef<string | null>(null);
  const activeRouteRef = useRef<string | null>(null);
  const publishedStateRef = useRef<PublishedStateSnapshot | null>(null);
  const publishStateRef = useRef(options.publishState);
  const activateVersionRef = useRef(options.activateVersion);
  const reportRuntimeErrorRef = useRef(options.reportRuntimeError);
  const recordPipelineStageForVersionRef = useRef(options.recordPipelineStageForVersion);
  const mountTransitionRef = useRef(options.onMountTransitionChange);
  const [browserRouteVersion, setBrowserRouteVersion] = useState(0);
  const {
    appId,
    activeVersion,
    nextReadyVersion,
  } = options;
  const activeVersionId = activeVersion?._id ?? null;
  const activeVersionManifestUrl = activeVersion?.manifestUrl ?? null;
  const activeVersionStateJson = activeVersion?.stateJson ?? null;
  const nextReadyVersionId = nextReadyVersion?._id ?? null;
  const previewEffectVersionId = previewVersionRef.current ?? nextReadyVersionId;

  useEffect(() => {
    publishStateRef.current = options.publishState;
    activateVersionRef.current = options.activateVersion;
    reportRuntimeErrorRef.current = options.reportRuntimeError;
    recordPipelineStageForVersionRef.current = options.recordPipelineStageForVersion;
    mountTransitionRef.current = options.onMountTransitionChange;
  }, [
    options.activateVersion,
    options.onMountTransitionChange,
    options.publishState,
    options.recordPipelineStageForVersion,
    options.reportRuntimeError,
  ]);

  useEffect(() => {
    return () => {
      const currentMount = activeMountRef.current;
      activeMountRef.current = null;
      if (currentMount) {
        void currentMount.unmount();
      }
      previewVersionRef.current = null;
      activeRouteRef.current = null;
      publishedStateRef.current = null;
      clearActiveCss();
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setBrowserRouteVersion((current) => current + 1);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const previousAppId = previousAppIdRef.current;
    previousAppIdRef.current = appId;
    if (!previousAppId || previousAppId === appId) {
      return;
    }
  }, [appId, hostRef]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let cancelled = false;
    let mountingLayer: MountedLayer | null = null;

    void (async () => {
      if (!activeVersion) {
        mountTransitionRef.current?.(false);
        activeRouteRef.current = null;
        publishedStateRef.current = null;
        clearActiveCss();
        const currentMount = activeMountRef.current;
        activeMountRef.current = null;
        if (currentMount) {
          await currentMount.unmount();
        }
        host.innerHTML = "";
        return;
      }

      if (previewVersionRef.current === activeVersion._id) {
        return;
      }

      const shellRoute = readShellRoute();
      const publishedState =
        publishedStateRef.current?.versionId === activeVersion._id
          ? publishedStateRef.current.state
          : null;
      const baseState = publishedState ?? liveAppStateSchema.parse(JSON.parse(activeVersion.stateJson));
      const initialState = applyShellRouteToState(baseState);
      const routeCapable = isPlainStateObject(initialState) && typeof initialState.route === "string";

      if (
        activeMountRef.current?.versionId === activeVersion._id &&
        (!routeCapable || activeRouteRef.current === shellRoute)
      ) {
        return;
      }

      const activeLayer = ensureLayer(host, "active");
      mountTransitionRef.current?.(true);
      const manifest = await loadManifest(activeVersion.manifestUrl);
      const existingActive = activeMountRef.current;

      if (cancelled) {
        return;
      }

      clearActiveCss();
      activeMountRef.current = null;
      if (existingActive) {
        await Promise.resolve(existingActive.unmount()).catch(() => undefined);
      }

      mountingLayer = await mountVersionInLayer({
        layer: activeLayer,
        versionId: activeVersion._id,
        manifest,
        initialState,
        publishState: (state) => {
          publishedStateRef.current = {
            versionId: activeVersion._id,
            state,
          };
          activeRouteRef.current = syncShellRouteFromState(state);
          void publishStateRef.current(state);
        },
        reportHealthy: () => {
          // Active version is already promoted.
        },
        reportError: (error) => {
          void reportRuntimeErrorRef.current({
            versionId: activeVersion._id,
            message: error.message,
            stack: error.stack,
          });
        },
      });

      if (cancelled) {
        await mountingLayer.unmount();
        mountingLayer = null;
        return;
      }

      notifyViewportChange();
      console.info("[shell] mounted active version", activeVersion.versionNumber);

      activeMountRef.current = mountingLayer;
      mountingLayer = null;
      activeRouteRef.current = routeCapable ? shellRoute : null;
      publishedStateRef.current = {
        versionId: activeVersion._id,
        state: initialState,
      };
      mountTransitionRef.current?.(false);
    })().catch((error) => {
      mountTransitionRef.current?.(false);
      void reportRuntimeErrorRef.current({
        versionId: activeVersion?._id,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });

    return () => {
      cancelled = true;
      if (mountingLayer) {
        void mountingLayer.unmount();
      }
    };
  }, [
    activeVersionId,
    activeVersionManifestUrl,
    activeVersionStateJson,
    browserRouteVersion,
    hostRef,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    if (
      !shouldLoadCandidateVersion({
        activeVersion,
        nextReadyVersion,
        previewVersionId: previewVersionRef.current,
      })
    ) {
      return;
    }

    previewVersionRef.current = nextReadyVersion!._id;
    let cancelled = false;
    let previewMount: MountedLayer | null = null;
    let promotedMount: MountedLayer | null = null;

    void (async () => {
      const activeLayer = ensureLayer(host, "active");
      const previewLayer = ensureLayer(host, "preview");
      const version = nextReadyVersion!;
      mountTransitionRef.current?.(true);
      const manifest = await loadManifest(version.manifestUrl);
      const initialState = applyShellRouteToState(
        liveAppStateSchema.parse(JSON.parse(version.stateJson)),
      );

      try {
        console.info("[shell] previewing candidate version", version.versionNumber);
        await recordPipelineStageForVersionRef.current({
          versionId: version._id,
          key: "preview",
          status: "running",
        });

        previewMount = await mountVersionInLayer({
          layer: previewLayer,
          versionId: version._id,
          manifest,
          initialState,
          publishState: (state) => {
            void publishStateRef.current(state);
          },
          reportHealthy: () => {
            // Candidate health gate disabled. Promotion happens after mount succeeds.
          },
          reportError: (error) => {
            void reportRuntimeErrorRef.current({
              versionId: version._id,
              message: error.message,
              stack: error.stack,
            });
          },
        });

        if (cancelled) {
          await previewMount.unmount();
          previewMount = null;
          return;
        }

        await activateVersionRef.current(version._id);
        await recordPipelineStageForVersionRef.current({
          versionId: version._id,
          key: "preview",
          status: "completed",
        });
        console.info("[shell] promoted candidate version", version.versionNumber);

        const currentActive = activeMountRef.current;
        activeMountRef.current = null;
        if (currentActive) {
          await Promise.resolve(currentActive.unmount()).catch(() => undefined);
        }

        promotedMount = await mountVersionInLayer({
          layer: activeLayer,
          versionId: version._id,
          manifest,
          initialState,
          publishState: (state) => {
            publishedStateRef.current = {
              versionId: version._id,
              state,
            };
            activeRouteRef.current = syncShellRouteFromState(state);
            void publishStateRef.current(state);
          },
          reportHealthy: () => {},
          reportError: (error) => {
            void reportRuntimeErrorRef.current({
              versionId: version._id,
              message: error.message,
              stack: error.stack,
            });
          },
        });

        if (cancelled) {
          await promotedMount.unmount();
          promotedMount = null;
          return;
        }

        if (previewMount) {
          await previewMount.unmount();
          previewMount = null;
        }

        notifyViewportChange();
        console.info("[shell] remounted candidate as active", version.versionNumber);
        activeMountRef.current = promotedMount;
        promotedMount = null;
        activeRouteRef.current =
          isPlainStateObject(initialState) && typeof initialState.route === "string"
            ? readShellRoute()
            : null;
        publishedStateRef.current = {
          versionId: version._id,
          state: initialState,
        };
        mountTransitionRef.current?.(false);
      } catch (error) {
        if (previewMount) {
          await previewMount.unmount();
          previewMount = null;
        }
        if (promotedMount) {
          await promotedMount.unmount();
          promotedMount = null;
        }
        throw error;
      } finally {
        previewVersionRef.current = null;
      }
    })().catch((error) => {
      mountTransitionRef.current?.(false);
      void reportRuntimeErrorRef.current({
        versionId: nextReadyVersion?._id,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });

    return () => {
      cancelled = true;
      if (previewMount) {
        void previewMount.unmount();
      }
      if (promotedMount) {
        void promotedMount.unmount();
      }
    };
  }, [
    appId,
    hostRef,
    previewEffectVersionId,
  ]);
}
