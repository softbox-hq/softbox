import { useEffect, useRef, type RefObject } from "react";
import { liveManifestSchema } from "@shared/manifest";
import {
  liveAppStateSchema,
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
    };
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
        return;
      }
      if (activeMountRef.current?.versionId === activeVersion._id) {
        return;
      }

      const activeLayer = ensureLayer(host, "active");
      const manifest = await loadManifest(activeVersion.manifestUrl);
      const module = await importLiveApp(manifest.entryUrl);
      const initialState = liveAppStateSchema.parse(JSON.parse(activeVersion.stateJson));
      if (cancelled) {
        await module.unmount();
        return;
      }

      await module.mount({
        root: activeLayer,
        initialState,
        publishState: (state) => {
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

      if (activeMountRef.current && activeMountRef.current.versionId !== activeVersion._id) {
        await activeMountRef.current.module.unmount();
      }

      activeMountRef.current = {
        versionId: activeVersion._id,
        module,
        layer: activeLayer,
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
  }, [activeVersion, hostRef, publishState, reportRuntimeError]);

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
      const initialState = liveAppStateSchema.parse(JSON.parse(version.stateJson));

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

        activeLayer.innerHTML = "";
        await module.mount({
          root: activeLayer,
          initialState,
          publishState: (state) => {
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
