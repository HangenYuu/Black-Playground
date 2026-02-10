import { Editor } from "@monaco-editor/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { decodeState, encodeState } from "./lib/share";
import { BlackOptions, PlaygroundState, StyleMode } from "./lib/types";

const STORAGE_KEY = "black_playground_state_v1";

const DEFAULT_CODE = `from seven_dwwarfs import Grumpy, Happy, Sleepy, Bashful, Sneezy, Dopey, Doc
x = {  'a':37,'b':42,

'c':927}

x = 123456789.123456789E123456789

if very_long_variable_name is not None and \
 very_long_variable_name.field > 0 or \
 very_long_variable_name.is_debug:
 z = 'hello '+'world'
else:
 world = 'world'
 a = 'hello {}'.format(world)
 f = rf'hello {world}'
if (this
and that): y = 'hello ''world'#FIXME: https://github.com/psf/black/issues/26
class Foo  (     object  ):
  def f    (self   ):
    return       37*-2
  def g(self, x,y=42):
      return y
def f  (   a: List[ int ]) :
  return      37-a[42-u :  y**3]
def very_important_function(template: str,*variables,file: os.PathLike,debug:bool=False,):
    """Applies \`variables\` to the \`template\` and writes to \`file\`."""
    with open(file, "w") as f:
     ...
# fmt: off
custom_formatting = [
    0,  1,  2,
    3,  4,  5,
    6,  7,  8,
]
# fmt: on
regular_formatting = [
    0,  1,  2,
    3,  4,  5,
    6,  7,  8,
]
`;

const defaultOptions: BlackOptions = {
  line_length: 88,
  target_versions: [],
  fast: false,
  skip_source_first_line: false,
  skip_string_normalization: false,
  skip_magic_trailing_comma: false,
  is_pyi: false,
  style: "stable"
};

const targetVersionOptions = [
  { label: "3.3", value: "PY33" },
  { label: "3.4", value: "PY34" },
  { label: "3.5", value: "PY35" },
  { label: "3.6", value: "PY36" },
  { label: "3.7", value: "PY37" },
  { label: "3.8", value: "PY38" },
  { label: "3.9", value: "PY39" },
  { label: "3.10", value: "PY310" },
  { label: "3.11", value: "PY311" },
  { label: "3.12", value: "PY312" },
  { label: "3.13", value: "PY313" }
];

function normalizeOptions(input: Partial<BlackOptions> | undefined): BlackOptions {
  const o = input || {};
  const style: StyleMode = o.style === "preview" || o.style === "unstable" ? o.style : "stable";
  return {
    line_length: typeof o.line_length === "number" && Number.isFinite(o.line_length) ? o.line_length : 88,
    target_versions: Array.isArray(o.target_versions) ? o.target_versions.filter((v) => typeof v === "string") : [],
    fast: !!o.fast,
    skip_source_first_line: !!o.skip_source_first_line,
    skip_string_normalization: !!o.skip_string_normalization,
    skip_magic_trailing_comma: !!o.skip_magic_trailing_comma,
    is_pyi: !!o.is_pyi,
    style
  };
}

function safeParseStoredState(): PlaygroundState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaygroundState;
    if (!parsed || typeof parsed !== "object") return null;
    const code = typeof parsed.code === "string" ? parsed.code : DEFAULT_CODE;
    const options = normalizeOptions(parsed.options);
    return { code, options };
  } catch {
    return null;
  }
}

export default function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [options, setOptions] = useState<BlackOptions>(defaultOptions);
  const [formatted, setFormatted] = useState("");
  const [autoFormat, setAutoFormat] = useState(true);

  const [runtimeStatus, setRuntimeStatus] = useState("Starting...");
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [blackVersion, setBlackVersion] = useState<string | null>(null);
  const [pythonVersion, setPythonVersion] = useState<string | null>(null);

  const [formatBusy, setFormatBusy] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const latestHandledIdRef = useRef(0);

  useEffect(() => {
    const shared = decodeState(window.location.hash);
    if (shared) {
      setCode(typeof shared.code === "string" ? shared.code : DEFAULT_CODE);
      setOptions(normalizeOptions(shared.options));
      return;
    }
    const stored = safeParseStoredState();
    if (stored) {
      setCode(stored.code);
      setOptions(stored.options);
    }
  }, []);

  useEffect(() => {
    try {
      const state: PlaygroundState = { code, options };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [code, options]);

  useEffect(() => {
    const workerUrl = new URL(`${import.meta.env.BASE_URL}py-worker.js`, window.location.href);
    const worker = new Worker(workerUrl, { type: "classic" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data || {};
      if (msg.type === "status") {
        setRuntimeStatus(String(msg.message || ""));
        return;
      }
      if (msg.type === "ready") {
        setRuntimeReady(true);
        setRuntimeStatus("Ready");
        setBlackVersion(String(msg.blackVersion || ""));
        setPythonVersion(String(msg.pythonVersion || ""));
        return;
      }
      if (msg.type === "formatted") {
        const id = Number(msg.id || 0);
        if (id < latestHandledIdRef.current) return;
        latestHandledIdRef.current = id;
        setFormatted(String(msg.formatted || ""));
        setFormatBusy(false);
        setFormatError(null);
        return;
      }
      if (msg.type === "error") {
        const id = typeof msg.id === "number" ? msg.id : null;
        if (id !== null && id < latestHandledIdRef.current) return;
        setFormatBusy(false);
        setFormatError(String(msg.error || "Unknown error"));
      }
    };

    worker.postMessage({
      type: "init",
      payload: {
        pyodideIndexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/",
        blackVersion: "25.1.0"
      }
    });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const inputEditorOptions = useMemo(() => {
    return {
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      wordWrap: "on"
    };
  }, []);

  const outputEditorOptions = useMemo(() => {
    return {
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      readOnly: true
    };
  }, []);

  const sendFormat = (src: string, opts: BlackOptions) => {
    const worker = workerRef.current;
    if (!worker || !runtimeReady) return;
    const id = ++requestIdRef.current;
    setFormatBusy(true);
    worker.postMessage({
      type: "format",
      id,
      payload: { code: src, options: opts }
    });
  };

  useEffect(() => {
    if (!runtimeReady || !autoFormat) return;
    const t = window.setTimeout(() => {
      sendFormat(code, options);
    }, 350);
    return () => window.clearTimeout(t);
  }, [code, options, runtimeReady, autoFormat]);

  useEffect(() => {
    if (!runtimeReady) return;
    if (formatted === "") sendFormat(code, options);
  }, [runtimeReady]);

  const toggleTarget = (value: string) => {
    setOptions((prev) => {
      const exists = prev.target_versions.includes(value);
      const next = exists ? prev.target_versions.filter((v) => v !== value) : [...prev.target_versions, value];
      return { ...prev, target_versions: next };
    });
  };

  const copyFormatted = async () => {
    try {
      await navigator.clipboard.writeText(formatted || "");
    } catch {}
  };

  const copyShareLink = async () => {
    try {
      const encoded = encodeState({ code, options });
      const url = new URL(window.location.href);
      url.hash = encoded;
      await navigator.clipboard.writeText(url.toString());
      window.location.hash = encoded;
    } catch {}
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-zinc-900/60 px-4 py-2 ring-1 ring-zinc-700/50 backdrop-blur">
              <div className="text-lg font-semibold tracking-tight">Black Playground</div>
              <div className="text-xs text-zinc-400">
                {blackVersion ? `Black ${blackVersion}` : "Black loading"}{" "}
                {pythonVersion ? `· ${pythonVersion.split(" ")[0]} ${pythonVersion.split(" ")[1]}` : ""}
              </div>
            </div>
            <div className="rounded-xl bg-zinc-900/60 px-4 py-2 text-xs text-zinc-300 ring-1 ring-zinc-700/50 backdrop-blur">
              <div className="font-medium">{runtimeReady ? "Formatter ready" : "Loading formatter"}</div>
              <div className="text-zinc-400">{runtimeStatus}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
              onClick={() => sendFormat(code, options)}
              disabled={!runtimeReady || formatBusy}
            >
              {formatBusy ? "Formatting..." : "Format"}
            </button>
            <button
              className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
              onClick={copyFormatted}
              disabled={!formatted}
            >
              Copy output
            </button>
            <button
              className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
              onClick={copyShareLink}
            >
              Copy share link
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-zinc-700/50 backdrop-blur md:grid-cols-3">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Style</div>
            <select
              className="w-full rounded-lg bg-zinc-950/60 px-3 py-2 text-sm ring-1 ring-zinc-700/60 focus:outline-none"
              value={options.style}
              onChange={(e) => setOptions((p) => ({ ...p, style: e.target.value as StyleMode }))}
            >
              <option value="stable">Stable</option>
              <option value="preview">Preview</option>
              <option value="unstable">Unstable</option>
            </select>
            <div className="flex items-center gap-2 text-sm">
              <input id="autoFormat" type="checkbox" checked={autoFormat} onChange={(e) => setAutoFormat(e.target.checked)} />
              <label htmlFor="autoFormat" className="text-zinc-300">
                Auto format
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Options</div>
            <div className="flex items-center gap-2">
              <div className="w-32 text-sm text-zinc-300">Line length</div>
              <input
                type="number"
                className="w-full rounded-lg bg-zinc-950/60 px-3 py-2 text-sm ring-1 ring-zinc-700/60 focus:outline-none"
                value={options.line_length}
                min={1}
                max={500}
                onChange={(e) => setOptions((p) => ({ ...p, line_length: Number(e.target.value || 88) }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2 text-zinc-300">
                <input type="checkbox" checked={options.fast} onChange={(e) => setOptions((p) => ({ ...p, fast: e.target.checked }))} />
                Fast
              </label>
              <label className="flex items-center gap-2 text-zinc-300">
                <input type="checkbox" checked={options.is_pyi} onChange={(e) => setOptions((p) => ({ ...p, is_pyi: e.target.checked }))} />
                Stub mode
              </label>
              <label className="flex items-center gap-2 text-zinc-300">
                <input
                  type="checkbox"
                  checked={options.skip_source_first_line}
                  onChange={(e) => setOptions((p) => ({ ...p, skip_source_first_line: e.target.checked }))}
                />
                Skip first line
              </label>
              <label className="flex items-center gap-2 text-zinc-300">
                <input
                  type="checkbox"
                  checked={options.skip_string_normalization}
                  onChange={(e) => setOptions((p) => ({ ...p, skip_string_normalization: e.target.checked }))}
                />
                Keep string style
              </label>
              <label className="flex items-center gap-2 text-zinc-300">
                <input
                  type="checkbox"
                  checked={options.skip_magic_trailing_comma}
                  onChange={(e) => setOptions((p) => ({ ...p, skip_magic_trailing_comma: e.target.checked }))}
                />
                Disable magic comma
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Target versions</div>
            <div className="flex flex-wrap gap-2">
              {targetVersionOptions.map((tv) => {
                const active = options.target_versions.includes(tv.value);
                return (
                  <button
                    key={tv.value}
                    className={
                      active
                        ? "rounded-lg bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-900"
                        : "rounded-lg bg-zinc-950/60 px-2 py-1 text-xs font-semibold text-zinc-200 ring-1 ring-zinc-700/60 hover:bg-zinc-900/60"
                    }
                    onClick={() => toggleTarget(tv.value)}
                    type="button"
                  >
                    {tv.label}
                  </button>
                );
              })}
              <button
                className="rounded-lg bg-zinc-950/60 px-2 py-1 text-xs font-semibold text-zinc-200 ring-1 ring-zinc-700/60 hover:bg-zinc-900/60"
                onClick={() => setOptions((p) => ({ ...p, target_versions: [] }))}
                type="button"
              >
                Auto
              </button>
            </div>
          </div>
        </div>

        {formatError ? <div className="mb-3 rounded-xl bg-red-950/40 p-3 text-sm text-red-200 ring-1 ring-red-800/40">{formatError}</div> : null}

        <div className="h-[70vh] min-h-[420px] overflow-hidden rounded-2xl bg-zinc-900/40 ring-1 ring-zinc-700/50">
          <div className="grid h-full grid-cols-1 divide-y divide-zinc-700/40 md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="h-full">
              <div className="border-b border-zinc-700/40 bg-zinc-900/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Input
              </div>
              <Editor
                height="calc(100% - 33px)"
                width="100%"
                language="python"
                theme="vs-dark"
                value={code}
                options={inputEditorOptions}
                onChange={(value) => setCode(value ?? "")}
              />
            </div>
            <div className="h-full">
              <div className="border-b border-zinc-700/40 bg-zinc-900/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Formatted output
              </div>
              <Editor
                height="calc(100% - 33px)"
                width="100%"
                language="python"
                theme="vs-dark"
                value={formatted}
                options={outputEditorOptions}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
