import { describe, expect, test } from "bun:test";
import {
  formatStatus,
  formatStatusTail,
  isDeepSeekBalancePayload,
  parseProviderUsage,
  usageKindForProvider,
} from "../src/usage";

describe("custom statusline provider usage", () => {
  test("aggregates remaining capacity across accounts", () => {
    const parsed = parseProviderUsage({
      capacity: {
        "openai-codex": [
          { window: "5h", accounts: 2, remainingAccounts: 1.5 },
          { window: "7d", accounts: 2, remainingAccounts: 0.8 },
        ],
        "google-antigravity": [
          { window: "5h", accounts: 1, remainingAccounts: 0.999 },
          { window: "7d", accounts: 1, remainingAccounts: 0.58 },
        ],
      },
    });

    expect(parsed.chatgpt).toEqual({ fiveHour: 75, weekly: 40 });
    expect(parsed.gemini).toEqual({ fiveHour: 99.9, weekly: 57.99999999999999 });
  });

  test("maps only supported current-model providers", () => {
    expect(usageKindForProvider("openai-codex")).toBe("chatgpt");
    expect(usageKindForProvider("google-antigravity")).toBe("gemini");
    expect(usageKindForProvider("google-gemini-cli")).toBe("gemini");
    expect(usageKindForProvider("deepseek")).toBe("deepseek");
    expect(usageKindForProvider("anthropic")).toBeUndefined();
  });

  test("formats only the selected provider snapshot", () => {
    expect(formatStatus({ chatgpt: { fiveHour: 97, weekly: 58 } })).toBe(
      "5h:97% / 7d:58%",
    );
  });

  test("renders exact directory before provider usage", () => {
    expect(
      formatStatusTail(
        "/Users/lichen/Documents/omp/2026-09-22/151643",
        "5h:78% / 7d:56%",
      ),
    ).toBe(" 151643 · 5h:78% / 7d:56%");
  });

  test("formats quotas as remaining percentages and DeepSeek balance", () => {
    expect(
      formatStatus({
        chatgpt: { fiveHour: 97, weekly: 58 },
        gemini: { fiveHour: 99.9, weekly: 100 },
        deepseek: {
          is_available: true,
          balance_infos: [
            {
              currency: "CNY",
              total_balance: "110.00",
              granted_balance: "10.00",
              topped_up_balance: "100.00",
            },
          ],
        },
      }),
    ).toBe("5h:97% / 7d:58%  │  5h:100% / 7d:100%  │  ¥110");
  });

  test("rejects malformed DeepSeek responses", () => {
    expect(
      isDeepSeekBalancePayload({
        is_available: true,
        balance_infos: [{ currency: "CNY", total_balance: 1 }],
      }),
    ).toBe(false);
  });
});
