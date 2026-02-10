let pyodide = null;
let initPromise = null;

function postStatus(message) {
  self.postMessage({ type: "status", message });
}

async function initRuntime(payload) {
  const indexURL = payload?.pyodideIndexURL || "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/";
  const blackVersion = payload?.blackVersion || "25.1.0";

  postStatus("Loading Pyodide...");
  importScripts(indexURL + "pyodide.js");
  pyodide = await loadPyodide({ indexURL });

  postStatus("Loading micropip...");
  await pyodide.loadPackage("micropip");

  postStatus("Installing Black...");
  await pyodide.runPythonAsync(
    `import micropip
await micropip.install("black==${blackVersion}")`
  );

  postStatus("Initializing formatter...");
  await pyodide.runPythonAsync(
    `import sys
import black
from black import Mode, TargetVersion

def _as_opts_dict(opts):
    if opts is None:
        return {}

    # Pyodide receives JS objects as JsProxy; convert when possible.
    try:
        if hasattr(opts, "to_py"):
            opts = opts.to_py()
    except Exception:
        pass

    if isinstance(opts, dict):
        return opts

    try:
        return dict(opts)
    except Exception:
        return {}

def format_code(src, opts):
    opts = _as_opts_dict(opts)
    style = opts.get("style", "stable")
    preview = style in ("preview", "unstable")
    unstable = style == "unstable"

    tv = set()
    for v in opts.get("target_versions", []):
        try:
            tv.add(getattr(TargetVersion, v))
        except Exception:
            pass

    mode = Mode(
        target_versions=tv,
        line_length=int(opts.get("line_length", 88)),
        string_normalization=not bool(opts.get("skip_string_normalization", False)),
        is_pyi=bool(opts.get("is_pyi", False)),
        skip_source_first_line=bool(opts.get("skip_source_first_line", False)),
        magic_trailing_comma=not bool(opts.get("skip_magic_trailing_comma", False)),
        preview=preview,
        unstable=unstable
    )
    fast = bool(opts.get("fast", False))
    return black.format_file_contents(src, fast=fast, mode=mode)

_black_version = black.__version__
_python_version = sys.version`
  );

  const blackVer = pyodide.runPython("_black_version");
  const pyVer = pyodide.runPython("_python_version");

  self.postMessage({
    type: "ready",
    blackVersion: String(blackVer),
    pythonVersion: String(pyVer)
  });
}

async function ensureInit(payload) {
  if (!initPromise) initPromise = initRuntime(payload);
  return initPromise;
}

async function formatRequest(id, code, options) {
  try {
    await ensureInit();
    pyodide.globals.set("_SRC", code);
    pyodide.globals.set("_OPTS", options);
    const formatted = await pyodide.runPythonAsync("format_code(_SRC, _OPTS)");
    self.postMessage({ type: "formatted", id, formatted: String(formatted) });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    self.postMessage({ type: "error", id, error: msg });
  }
}

self.onmessage = async (event) => {
  const data = event.data || {};
  if (data.type === "init") {
    try {
      await ensureInit(data.payload);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      self.postMessage({ type: "error", error: msg });
    }
    return;
  }

  if (data.type === "format") {
    await formatRequest(data.id, data.payload?.code || "", data.payload?.options || {});
  }
};
