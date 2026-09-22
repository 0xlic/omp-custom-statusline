import { basename } from "node:path";

export interface CapacityWindow {
  window?: string;
  durationMs?: number;
  accounts?: number;
  remainingAccounts?: number;
}

export interface UsagePayload {
  capacity?: Record<string, CapacityWindow[]>;
}

export interface DeepSeekBalanceInfo {
  currency: "CNY" | "USD" | string;
  total_balance: string;
  granted_balance?: string;
  topped_up_balance?: string;
}

export interface DeepSeekBalancePayload {
  is_available: boolean;
  balance_infos: DeepSeekBalanceInfo[];
}

export interface ProviderUsageSnapshot {
  chatgpt?: { fiveHour?: number; weekly?: number };
  gemini?: { fiveHour?: number; weekly?: number };
  deepseek?: DeepSeekBalancePayload;
}
export type UsageKind = "chatgpt" | "gemini" | "deepseek";

const CHATGPT_PROVIDERS = ["openai-codex"];
const GEMINI_PROVIDERS = ["google-antigravity", "google-gemini-cli"];

export function usageKindForProvider(provider: string): UsageKind | undefined {
  if (CHATGPT_PROVIDERS.includes(provider)) return "chatgpt";
  if (GEMINI_PROVIDERS.includes(provider)) return "gemini";
  if (provider === "deepseek") return "deepseek";
  return undefined;
}

function percentRemaining(
  capacity: UsagePayload["capacity"],
  providers: readonly string[],
  windowIds: readonly string[],
): number | undefined {
  if (!capacity) return undefined;

  let accountCount = 0;
  let remaining = 0;
  for (const provider of providers) {
    for (const item of capacity[provider] ?? []) {
      const window = item.window?.toLowerCase();
      if (!window || !windowIds.includes(window)) continue;
      if (
        typeof item.accounts !== "number" ||
        item.accounts <= 0 ||
        typeof item.remainingAccounts !== "number"
      ) {
        continue;
      }
      accountCount += item.accounts;
      remaining += item.remainingAccounts;
    }
  }

  if (accountCount === 0) return undefined;
  return Math.max(0, Math.min(100, (remaining / accountCount) * 100));
}

export function parseProviderUsage(payload: UsagePayload): Pick<
  ProviderUsageSnapshot,
  "chatgpt" | "gemini"
> {
  const chatgpt = {
    fiveHour: percentRemaining(payload.capacity, CHATGPT_PROVIDERS, ["5h"]),
    weekly: percentRemaining(payload.capacity, CHATGPT_PROVIDERS, ["7d", "weekly"]),
  };
  const gemini = {
    fiveHour: percentRemaining(payload.capacity, GEMINI_PROVIDERS, ["5h"]),
    weekly: percentRemaining(payload.capacity, GEMINI_PROVIDERS, ["7d", "weekly"]),
  };

  return {
    chatgpt:
      chatgpt.fiveHour === undefined && chatgpt.weekly === undefined
        ? undefined
        : chatgpt,
    gemini:
      gemini.fiveHour === undefined && gemini.weekly === undefined
        ? undefined
        : gemini,
  };
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value)}%`;
}

function formatQuota(
  quota: { fiveHour?: number; weekly?: number } | undefined,
): string | undefined {
  if (!quota) return undefined;
  return `5h:${formatPercent(quota.fiveHour)} / 7d:${formatPercent(quota.weekly)}`;
}

function formatMoney(value: string, currency: string): string {
  const numeric = Number(value);
  const amount = Number.isFinite(numeric)
    ? numeric.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : value;
  const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${amount}`;
}

export function formatStatus(snapshot: ProviderUsageSnapshot): string {
  const parts = [
    formatQuota(snapshot.chatgpt),
    formatQuota(snapshot.gemini),
  ].filter((part): part is string => Boolean(part));

  const balances = snapshot.deepseek?.balance_infos
    ?.filter((balance) => balance.total_balance !== undefined)
    .map((balance) => formatMoney(balance.total_balance, balance.currency));
  if (balances?.length) parts.push(balances.join("+"));

  return parts.join("  │  ");
}

export function formatStatusTail(cwd: string, providerUsage: string): string {
  return [` ${basename(cwd)}`, providerUsage].filter(Boolean).join(" · ");
}

export function isDeepSeekBalancePayload(
  value: unknown,
): value is DeepSeekBalancePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<DeepSeekBalancePayload>;
  return (
    typeof payload.is_available === "boolean" &&
    Array.isArray(payload.balance_infos) &&
    payload.balance_infos.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.currency === "string" &&
        typeof item.total_balance === "string",
    )
  );
}
