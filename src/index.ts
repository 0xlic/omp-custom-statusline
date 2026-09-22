import type {
  ProviderUsageSnapshot,
  UsageKind,
  UsagePayload,
} from "./usage";
import {
  formatStatus,
  formatStatusTail,
  isDeepSeekBalancePayload,
  parseProviderUsage,
  usageKindForProvider,
} from "./usage";

interface StatusUI {
  setStatus(key: string, text: string | undefined): void;
}

interface ExtensionContext {
  hasUI: boolean;
  cwd: string;
  ui: StatusUI;
  models: {
    current(): { provider: string } | undefined;
  };
  setInterval(
    callback: () => void | Promise<void>,
    milliseconds: number,
  ): unknown;
  clearTimer(timer: unknown): void;
}

interface ExtensionAPI {
  setLabel(label: string): void;
  on(
    event: "session_start" | "session_shutdown" | "turn_end",
    handler: (event: unknown, context: ExtensionContext) => void | Promise<void>,
  ): void;
}

const STATUS_KEY = "custom-statusline";
const CHILD_MARKER = "OMP_CUSTOM_STATUSLINE_CHILD";
const DEFAULT_REFRESH_MS = 60_000;
const MIN_REFRESH_MS = 30_000;
const COMMAND_TIMEOUT_MS = 20_000;
const MODEL_WATCH_MS = 250;

function refreshInterval(): number {
  const configured = Number(process.env.OMP_CUSTOM_STATUSLINE_REFRESH_MS);
  return Number.isFinite(configured) && configured >= MIN_REFRESH_MS
    ? configured
    : DEFAULT_REFRESH_MS;
}

async function runOmpJson<T>(args: string[]): Promise<T> {
  const processHandle = Bun.spawn(["omp", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, [CHILD_MARKER]: "1" },
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `omp exited with code ${exitCode}`);
  }
  return JSON.parse(stdout) as T;
}

async function getDeepSeekToken(): Promise<string | undefined> {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    const processHandle = Bun.spawn(["omp", "token", "deepseek"], {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, [CHILD_MARKER]: "1" },
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    });
    const [token, exitCode] = await Promise.all([
      new Response(processHandle.stdout).text(),
      processHandle.exited,
    ]);
    return exitCode === 0 && token.trim() ? token.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function fetchDeepSeekBalance(): Promise<
  ProviderUsageSnapshot["deepseek"]
> {
  const token = await getDeepSeekToken();
  if (!token) return undefined;

  const response = await fetch("https://api.deepseek.com/user/balance", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`DeepSeek balance returned ${response.status}`);
  const payload: unknown = await response.json();
  if (!isDeepSeekBalancePayload(payload)) {
    throw new Error("DeepSeek balance returned an unexpected response");
  }
  return payload;
}

async function loadSnapshot(kind: UsageKind): Promise<ProviderUsageSnapshot> {
  if (kind === "deepseek") {
    const deepseek = await fetchDeepSeekBalance();
    if (!deepseek) throw new Error("No DeepSeek credential is available");
    return { deepseek };
  }

  const usage = parseProviderUsage(
    await runOmpJson<UsagePayload>(["usage", "--json"]),
  );
  const snapshot: ProviderUsageSnapshot =
    kind === "chatgpt" ? { chatgpt: usage.chatgpt } : { gemini: usage.gemini };
  if (!snapshot[kind]) {
    throw new Error(`No ${kind} usage is available`);
  }
  return snapshot;
}

export default function customStatusline(pi: ExtensionAPI): void {
  if (process.env[CHILD_MARKER] === "1") return;

  pi.setLabel("Custom Statusline");
  let refreshTimer: unknown;
  let modelWatchTimer: unknown;
  let activeProvider: string | undefined;
  let providerUsage = "";
  let refreshPromise:
    | { provider: string; promise: Promise<string> }
    | undefined;

  const render = (context: ExtensionContext): string => {
    const status = formatStatusTail(context.cwd, providerUsage);
    context.ui.setStatus(STATUS_KEY, status || undefined);
    return status;
  };

  const refresh = async (context: ExtensionContext): Promise<string> => {
    if (!context.hasUI) return "";
    const provider = context.models.current()?.provider;
    const kind = provider ? usageKindForProvider(provider) : undefined;
    if (!provider || !kind) {
      providerUsage = "";
      return render(context);
    }

    if (!refreshPromise || refreshPromise.provider !== provider) {
      const promise = loadSnapshot(kind)
        .then((snapshot) => {
          if (context.models.current()?.provider === provider) {
            providerUsage = formatStatus(snapshot);
            return render(context);
          }
          return "";
        })
        .finally(() => {
          if (refreshPromise?.promise === promise) refreshPromise = undefined;
        });
      refreshPromise = { provider, promise };
    }
    return refreshPromise.promise;
  };

  pi.on("session_start", async (_event, context) => {
    if (!context.hasUI) return;
    activeProvider = context.models.current()?.provider;
    render(context);
    try {
      await refresh(context);
    } catch {
      providerUsage = "Usage unavailable";
      render(context);
    }
    refreshTimer = context.setInterval(async () => {
      try {
        await refresh(context);
      } catch {
        // Keep the last good value during transient provider failures.
      }
    }, refreshInterval());
    modelWatchTimer = context.setInterval(async () => {
      const provider = context.models.current()?.provider;
      if (provider === activeProvider) return;

      activeProvider = provider;
      providerUsage = "";
      render(context);
      try {
        await refresh(context);
      } catch {
        if (context.models.current()?.provider === provider) {
          providerUsage = "Usage unavailable";
          render(context);
        }
      }
    }, MODEL_WATCH_MS);
  });

  pi.on("turn_end", (_event, context) => {
    if (context.hasUI) render(context);
  });

  pi.on("session_shutdown", (_event, context) => {
    if (refreshTimer !== undefined) context.clearTimer(refreshTimer);
    if (modelWatchTimer !== undefined) context.clearTimer(modelWatchTimer);
  });

}
