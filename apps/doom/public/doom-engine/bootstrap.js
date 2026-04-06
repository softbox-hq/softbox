(function () {
  const origin = window.location.origin;
  const canvas = document.getElementById("canvas");
  const statusNode = document.getElementById("status");
  let gameStarted = false;
  let bootRequested = false;

  function post(type, payload) {
    window.parent.postMessage({ type, ...payload }, origin);
  }

  function setStatus(text) {
    statusNode.textContent = text;
  }

  function reportError(error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("Boot failed");
    post("doom-error", { message });
  }

  function handleRuntimeLog(text) {
    if (typeof text !== "string") {
      return;
    }

    if (text.includes("doom: 10, game started")) {
      gameStarted = true;
      setStatus("Running");
      post("doom-running", { wadName: window.__softboxWadName || "doom1.wad" });
    }
  }

  async function bootFromFile(file) {
    if (!file || typeof file.arrayBuffer !== "function") {
      throw new Error("Expected a WAD file from the host app.");
    }

    const wadBytes = new Uint8Array(await file.arrayBuffer());
    window.__softboxWadName = file.name;
    setStatus("Loading engine");

    window.Module = {
      arguments: [],
      noInitialRun: true,
      locateFile(path) {
        return new URL(path, window.location.href).toString();
      },
      preRun() {
        window.Module.FS.writeFile("doom1.wad", wadBytes);
        window.Module.FS.createPreloadedFile("", "default.cfg", "default.cfg", true, true);
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
      },
      canvas,
      onAbort(reason) {
        reportError(reason);
      },
    };

    const script = document.createElement("script");
    script.src = "./websockets-doom.js";
    script.async = true;
    script.onerror = function () {
      reportError(new Error("Failed to load the Doom engine assets."));
    };
    document.body.appendChild(script);
  }

  window.addEventListener("message", async function (event) {
    if (event.origin !== origin) {
      return;
    }

    if (!event.data || event.data.type !== "load-wad") {
      return;
    }

    if (bootRequested) {
      window.location.reload();
      return;
    }

    bootRequested = true;

    try {
      await bootFromFile(event.data.file);
    } catch (error) {
      reportError(error);
    }
  });

  window.onerror = function (_event, _source, _lineno, _colno, error) {
    reportError(error || "Unexpected Doom engine error.");
  };

  post("doom-frame-ready");
})();
