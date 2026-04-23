import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { initialLiveAppState } from "./defaultState";
import { useSoftboxRuntime } from "./adapter/runtime";
import doomEngineWasmUrl from "./assets/doom-engine/websockets-doom.wasm";
import bundledDoomWadUrl from "../DOOM.WAD";
import "./App.css";

type DoomFrameMessage =
  | { type: "doom-frame-ready" }
  | { type: "doom-running"; wadName: string }
  | { type: "doom-error"; message: string };

type DoomStatus = typeof initialLiveAppState.status;
type BundledWadStatus = "checking" | "available" | "missing";

const doomEngineScriptUrl = "https://silentspacemarine.com/websockets-doom.js";
const bundledDoomWadName = "DOOM.WAD";
const doomDefaultConfigText = `use_libsamplerate             0
aspect_ratio_correct          0
force_software_renderer       0
startup_delay                 2000
show_diskicon                 1
grabmouse                     0
fullscreen                    0
sfx_volume                    8
music_volume                  8
show_messages                 1
key_right                     25
key_left                      24
key_up                        17
key_down                      31
key_strafeleft                30
key_straferight               32
key_fire                      57
key_use                       18
key_strafe                    46
key_speed                     42
key_strafe_alt                46
key_speed_alt                 42
key_fullscreen                33
use_mouse                     1
use_joystick                  0
screenblocks                  10
detaillevel                   0
snd_channels                  8
snd_musicdevice               3
snd_sfxdevice                 3
snd_sbport                    0
snd_sbirq                     0
snd_sbdma                     0
snd_mport                     0
usegamma                      1
chatmacro0                    "No"
chatmacro1                    "I'm ready to kick butt!"
chatmacro2                    "I'm OK."
chatmacro3                    "I'm not looking too good!"
chatmacro4                    "Help!"
chatmacro5                    "You suck!"
chatmacro6                    "Next time, scumbag..."
chatmacro7                    "Come here!"
chatmacro8                    "I'll take care of it."
chatmacro9                    "Yes"
`;

function buildDoomFrameDoc() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Doom Engine Frame</title>
    <style>
      html, body {
        margin: 0;
        height: 100%;
        background: #000;
        color: #f1d4b8;
        font-family: monospace;
      }
      body {
        display: grid;
        place-items: center;
      }
      #viewport {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      #canvas {
        width: 100%;
        height: 100%;
        display: block;
        background: #000;
      }
      #status {
        position: absolute;
        left: 16px;
        bottom: 16px;
        padding: 8px 10px;
        background: rgba(0, 0, 0, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
    </style>
  </head>
  <body>
    <div id="viewport">
      <canvas id="canvas" oncontextmenu="event.preventDefault()" tabindex="0"></canvas>
      <div id="status">Waiting for WAD</div>
    </div>
    <script>
      (function () {
        const canvas = document.getElementById("canvas");
        const viewport = document.getElementById("viewport");
        const statusNode = document.getElementById("status");
        let gameStarted = false;
        let bootRequested = false;

        function post(type, payload) {
          window.parent.postMessage({ type, ...payload }, "*");
        }

        function setStatus(text) {
          statusNode.textContent = text;
        }

        function focusGame() {
          try {
            window.focus();
          } catch {}

          try {
            canvas.focus({ preventScroll: true });
          } catch {
            canvas.focus();
          }
        }

        function reportError(error) {
          const message = error instanceof Error ? error.message : String(error);
          setStatus("Boot failed");
          post("doom-error", { message });
        }

        async function loadBytesFromUrl(url, label) {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error("Failed to load " + label + ".");
          }
          return new Uint8Array(await response.arrayBuffer());
        }

        function handleRuntimeLog(text) {
          if (typeof text !== "string") {
            return;
          }

          if (text.includes("doom: 10, game started")) {
            gameStarted = true;
            setStatus("Running");
            focusGame();
            post("doom-running", { wadName: window.__softboxWadName || "doom1.wad" });
          }
        }

        async function bootFromSource(payload) {
          let wadBytes;
          let wadName;

          if (payload.file && typeof payload.file.arrayBuffer === "function") {
            wadBytes = new Uint8Array(await payload.file.arrayBuffer());
            wadName = payload.wadName || payload.file.name || "doom1.wad";
          } else if (payload.url) {
            wadBytes = await loadBytesFromUrl(payload.url, payload.wadName || "bundled WAD");
            wadName = payload.wadName || "doom1.wad";
          } else {
            throw new Error("Expected a WAD file or bundled WAD URL from the host app.");
          }

          const wasmBinary = await loadBytesFromUrl(${JSON.stringify(doomEngineWasmUrl)}, "Doom engine wasm");

          window.__softboxWadName = wadName;
          setStatus("Loading engine");

          window.Module = {
            arguments: [],
            noInitialRun: true,
            wasmBinary,
            preRun() {
              window.Module.FS.writeFile("doom1.wad", wadBytes);
              window.Module.FS.writeFile("default.cfg", ${JSON.stringify(doomDefaultConfigText)});
            },
            print(text) {
              console.log(text);
              handleRuntimeLog(text);
            },
            printErr(text) {
              console.error(text);
            },
            setStatus(text) {
              if (text) {
                setStatus(text);
              }
            },
            onRuntimeInitialized() {
              setStatus("Booting Doom");
              window.callMain([
                "-iwad",
                "doom1.wad",
                "-window",
                "-nogui",
                "-nomusic",
                "-config",
                "default.cfg",
                "-servername",
                "softbox",
              ]);
              window.setTimeout(focusGame, 0);
            },
            canvas,
            onAbort(reason) {
              reportError(reason);
            },
          };

          const script = document.createElement("script");
          script.src = ${JSON.stringify(doomEngineScriptUrl)};
          script.async = true;
          script.onerror = function () {
            reportError(new Error("Failed to load the Doom engine assets."));
          };
          document.body.appendChild(script);
        }

        window.addEventListener("message", async function (event) {
          if (!event.data || event.data.type !== "load-wad") {
            return;
          }

          if (bootRequested) {
            window.location.reload();
            return;
          }

          bootRequested = true;

          try {
            await bootFromSource(event.data);
          } catch (error) {
            reportError(error);
          }
        });

        window.onerror = function (_event, _source, _lineno, _colno, error) {
          reportError(error || "Unexpected Doom engine error.");
        };

        ["pointerdown", "mousedown", "click"].forEach(function (eventName) {
          viewport.addEventListener(eventName, function () {
            focusGame();
          });
        });

        post("doom-frame-ready");
      })();
    </script>
  </body>
</html>`;
}

function App() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const runtime = useSoftboxRuntime();
  const [frameReady, setFrameReady] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const [wadFile, setWadFile] = useState<File | null>(null);
  const [bundledWadStatus, setBundledWadStatus] = useState<BundledWadStatus>("checking");
  const [status, setStatus] = useState<DoomStatus>(runtime.initialState.status);
  const [lastError, setLastError] = useState<string | null>(runtime.initialState.lastError);

  useEffect(() => {
    runtime.publishState(initialLiveAppState);
  }, [runtime]);

  useEffect(() => {
    let cancelled = false;

    async function checkBundledWad() {
      try {
        const response = await fetch(bundledDoomWadUrl, { method: "HEAD" });
        if (!cancelled) {
          setBundledWadStatus(response.ok ? "available" : "missing");
        }
      } catch {
        if (!cancelled) {
          setBundledWadStatus("missing");
        }
      }
    }

    checkBundledWad();

    return () => {
      cancelled = true;
    };
  }, []);

  function focusDoomFrame() {
    const frame = iframeRef.current;

    if (!frame) {
      return;
    }

    try {
      frame.focus();
      frame.contentWindow?.focus();
    } catch {
      // Best effort only.
    }
  }

  useEffect(() => {
    function onMessage(event: MessageEvent<DoomFrameMessage>) {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      const data = event.data;

      if (!data || typeof data !== "object" || !("type" in data)) {
        return;
      }

      switch (data.type) {
        case "doom-frame-ready":
          setFrameReady(true);
          window.setTimeout(focusDoomFrame, 0);
          break;
        case "doom-running":
          setStatus("running");
          setLastError(null);
          window.setTimeout(focusDoomFrame, 0);
          runtime.publishState({
            status: "running",
            wadName: data.wadName,
            lastError: null,
          });
          break;
        case "doom-error":
          setStatus("error");
          setLastError(data.message);
          runtime.publishState({
            status: "error",
            wadName: wadFile?.name ?? (bundledWadStatus === "available" ? bundledDoomWadName : null),
            lastError: data.message,
          });
          runtime.reportError({ message: data.message });
          break;
      }
    }

    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [bundledWadStatus, runtime, wadFile]);

  useEffect(() => {
    if (!frameReady || !iframeRef.current?.contentWindow) {
      return;
    }

    if (!wadFile && bundledWadStatus !== "available") {
      return;
    }

    const wadName = wadFile?.name ?? bundledDoomWadName;

    runtime.publishState({
      status: "loading",
      wadName,
      lastError: null,
    });

    iframeRef.current.contentWindow.postMessage(
      wadFile
        ? {
            type: "load-wad",
            file: wadFile,
            wadName: wadFile.name,
          }
        : {
            type: "load-wad",
            url: bundledDoomWadUrl,
            wadName: bundledDoomWadName,
          },
      "*",
    );
  }, [bundledWadStatus, frameReady, runtime, wadFile, sessionKey]);

  function handleWadSelection(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];

    if (!nextFile) {
      return;
    }

    setFrameReady(false);
    setLastError(null);
    setStatus("loading");
    setWadFile(nextFile);
    setSessionKey((value) => value + 1);
    event.target.value = "";
  }

  function restartCurrentWad() {
    if (!wadFile && bundledWadStatus !== "available") {
      return;
    }

    setFrameReady(false);
    setLastError(null);
    setStatus("loading");
    setSessionKey((value) => value + 1);
  }

  const activeWadName = wadFile?.name ?? (bundledWadStatus === "available" ? bundledDoomWadName : null);
  const showSetupOverlay = bundledWadStatus === "missing" && !wadFile;
  const showLoadingOverlay = !showSetupOverlay && (bundledWadStatus === "checking" || status === "loading");
  const showErrorOverlay = status === "error" && Boolean(lastError);

  return (
    <main className="doom-app">
      <iframe
        key={sessionKey}
        ref={iframeRef}
        title="Doom Engine"
        className="doom-iframe"
        tabIndex={0}
        srcDoc={buildDoomFrameDoc()}
      />

      {showLoadingOverlay ? (
        <div className="doom-overlay">
          <div className="doom-card doom-card--compact">
            <p className="doom-kicker">Doom</p>
            <h1>{bundledWadStatus === "checking" ? "Checking for DOOM.WAD" : "Loading Doom"}</h1>
            <p>
              {bundledWadStatus === "checking"
                ? "Looking for a bundled IWAD in apps/doom."
                : `Booting ${activeWadName ?? bundledDoomWadName}...`}
            </p>
          </div>
        </div>
      ) : null}

      {showSetupOverlay ? (
        <div className="doom-overlay">
          <div className="doom-card">
            <p className="doom-kicker">Setup Required</p>
            <h1>Add your WAD to the Doom app.</h1>
            <p>
              Put your IWAD at <code>apps/doom/DOOM.WAD</code>.
            </p>
            <p>
              Then run <code>pnpm seed -- --app app_adfc5a25</code> so Softbox rebuilds the Doom app version.
            </p>
            <p>You can also load a WAD just for this browser session right now.</p>
            <label className="doom-button">
              <input type="file" accept=".wad,application/octet-stream" onChange={handleWadSelection} />
              <span>Load Temporary WAD</span>
            </label>
          </div>
        </div>
      ) : null}

      {showErrorOverlay ? (
        <div className="doom-overlay">
          <div className="doom-card">
            <p className="doom-kicker">Boot Failed</p>
            <h1>Doom did not start cleanly.</h1>
            <p>{lastError}</p>
            <div className="doom-actions">
              <button type="button" className="doom-button doom-button--button" onClick={restartCurrentWad}>
                Retry
              </button>
              <label className="doom-button">
                <input type="file" accept=".wad,application/octet-stream" onChange={handleWadSelection} />
                <span>Choose Another WAD</span>
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
