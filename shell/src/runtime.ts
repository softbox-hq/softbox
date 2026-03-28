import { useEffect, useRef, useState, type RefObject } from "react";
import { liveManifestSchema } from "@shared/manifest";
import {
  liveAppStateSchema,
  type JsonObject,
  type LiveAppModule,
  type LiveAppState,
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
  module: LiveAppModule;
  layer: HTMLDivElement;
};

type PublishedStateSnapshot = {
  versionId: string;
  state: LiveAppState;
};

const ACTIVE_CSS_SELECTOR = 'link[data-softbox-active-css="true"]';

function clearActiveCss() {
  document
    .querySelectorAll<HTMLLinkElement>(ACTIVE_CSS_SELECTOR)
    .forEach((node) => node.remove());
}

function applyActiveCss(versionId: string, cssUrls: string[]) {
  clearActiveCss();
  for (const href of cssUrls) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${href}?t=${Date.now()}`;
    link.dataset.softboxActiveCss = "true";
    link.dataset.versionId = versionId;
    document.head.appendChild(link);
  }
}

export async function loadManifest(manifestUrl: string) {
  console.info("[shell] loading manifest", manifestUrl);
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load manifest: ${response.status}`);
  }
  return liveManifestSchema.parse(await response.json());
}

async function importLiveApp(entryUrl: string): Promise<LiveAppModule> {
  console.info("[shell] importing live app", entryUrl);
  const module = (await import(/* @vite-ignore */ `${entryUrl}?t=${Date.now()}`)) as {
    mount: LiveAppModule["mount"];
    unmount: LiveAppModule["unmount"];
  };
  if (typeof module.mount !== "function" || typeof module.unmount !== "function") {
    throw new Error("Live app module is missing mount/unmount exports");
  }
  return module;
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
  const [browserRouteVersion, setBrowserRouteVersion] = useState(0);
  const {
    appId,
    activeVersion,
    nextReadyVersion,
    publishState,
    activateVersion,
    reportRuntimeError,
    recordPipelineStageForVersion,
  } = options;

  useEffect(() => {
    return () => {
      void activeMountRef.current?.module.unmount();
      activeMountRef.current = null;
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
    const host = hostRef.current;
    const previousAppId = previousAppIdRef.current;
    previousAppIdRef.current = appId;
    if (!host || !previousAppId || previousAppId === appId) {
      return;
    }

    void Promise.resolve(activeMountRef.current?.module.unmount()).catch(() => undefined);
    activeMountRef.current = null;
    previewVersionRef.current = null;
    activeRouteRef.current = null;
    publishedStateRef.current = null;
    clearActiveCss();
    host.innerHTML = "";
  }, [appId, hostRef]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let cancelled = false;

    void (async () => {
      if (!activeVersion) {
        activeRouteRef.current = null;
        publishedStateRef.current = null;
        clearActiveCss();
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
      const manifest = await loadManifest(activeVersion.manifestUrl);
      const module = await importLiveApp(manifest.entryUrl);
      const existingActive = activeMountRef.current;
      if (cancelled) {
        await module.unmount();
        return;
      }

      applyActiveCss(activeVersion._id, manifest.cssUrls ?? []);
      if (existingActive) {
        await Promise.resolve(existingActive.module.unmount()).catch(() => undefined);
        existingActive.layer.innerHTML = "";
      }
      await module.mount({
        root: activeLayer,
        initialState,
        publishState: (state) => {
          publishedStateRef.current = {
            versionId: activeVersion._id,
            state,
          };
          activeRouteRef.current = syncShellRouteFromState(state);
          void publishState(state);
        },
        reportHealthy: () => {
          // Active version is already promoted.
        },
        reportError: (error) => {
          void reportRuntimeError({
            versionId: activeVersion._id,
            message: error.message,
            stack: error.stack,
          });
        },
      });
      notifyViewportChange();
      console.info(
        "[shell] mounted active version",
        activeVersion.versionNumber,
      );

      activeMountRef.current = {
        versionId: activeVersion._id,
        module,
        layer: activeLayer,
      };
      activeRouteRef.current = routeCapable ? shellRoute : null;
      publishedStateRef.current = {
        versionId: activeVersion._id,
        state: initialState,
      };
    })().catch((error) => {
      void reportRuntimeError({
        versionId: activeVersion?._id,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeVersion, browserRouteVersion, hostRef, publishState, reportRuntimeError]);

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

    void (async () => {
      const activeLayer = ensureLayer(host, "active");
      const previewLayer = ensureLayer(host, "preview");
      previewLayer.innerHTML = "";

      const version = nextReadyVersion!;
      const manifest = await loadManifest(version.manifestUrl);
      const module = await importLiveApp(manifest.entryUrl);
      const initialState = applyShellRouteToState(
        liveAppStateSchema.parse(JSON.parse(version.stateJson)),
      );

      try {
        console.info("[shell] previewing candidate version", version.versionNumber);
        await recordPipelineStageForVersion({
          versionId: version._id,
          key: "preview",
          status: "running",
        });
        await module.mount({
          root: previewLayer,
          initialState,
          publishState: (state) => {
            void publishState(state);
          },
          reportHealthy: () => {
            // Candidate health gate disabled. Promotion happens after mount succeeds.
          },
          reportError: (error) => {
            void reportRuntimeError({
              versionId: version._id,
              message: error.message,
              stack: error.stack,
            });
          },
        });
        if (cancelled) {
          await module.unmount();
          previewLayer.innerHTML = "";
          return;
        }

        await activateVersion(version._id);
        await recordPipelineStageForVersion({
          versionId: version._id,
          key: "preview",
          status: "completed",
        });
        console.info("[shell] promoted candidate version", version.versionNumber);

        const currentActive = activeMountRef.current;
        if (currentActive && currentActive.layer !== previewLayer) {
          await currentActive.module.unmount();
          currentActive.layer.innerHTML = "";
        }

        applyActiveCss(version._id, manifest.cssUrls ?? []);
        activeLayer.innerHTML = "";
        await module.mount({
          root: activeLayer,
          initialState,
          publishState: (state) => {
            publishedStateRef.current = {
              versionId: version._id,
              state,
            };
            activeRouteRef.current = syncShellRouteFromState(state);
            void publishState(state);
          },
          reportHealthy: () => {},
          reportError: (error) => {
            void reportRuntimeError({
              versionId: version._id,
              message: error.message,
              stack: error.stack,
            });
          },
        });
        notifyViewportChange();

        if (previewLayer !== activeLayer) {
          previewLayer.innerHTML = "";
          previewLayer.dataset.layer = "preview";
        }

        activeLayer.dataset.layer = "active";
        console.info("[shell] remounted candidate as active", version.versionNumber);
        activeMountRef.current = {
          versionId: version._id,
          module,
          layer: activeLayer,
        };
        activeRouteRef.current =
          isPlainStateObject(initialState) && typeof initialState.route === "string"
            ? readShellRoute()
            : null;
        publishedStateRef.current = {
          versionId: version._id,
          state: initialState,
        };
      } catch (error) {
        await Promise.resolve(module.unmount()).catch(() => undefined);
        previewLayer.innerHTML = "";
        throw error;
      } finally {
        previewVersionRef.current = null;
      }
    })().catch((error) => {
      void reportRuntimeError({
        versionId: nextReadyVersion?._id,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activateVersion, activeVersion, hostRef, nextReadyVersion, publishState, recordPipelineStageForVersion, reportRuntimeError]);
}
