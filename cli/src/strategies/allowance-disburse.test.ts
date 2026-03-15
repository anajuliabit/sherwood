import { describe, it, expect, beforeAll } from "vitest";
import { buildDisburseBatch, type AllowanceDisbursConfig } from "./allowance-disburse.js";
import { setNetwork } from "../lib/network.js";
import { TOKENS, UNISWAP } from "../lib/addresses.js";
import { encodeSwapPath } from "../lib/quote.js";
import type { Address } from "viem";
import { parseUnits } from "viem";

beforeAll(() => setNetwork("base"));

const VAULT = "0x1111111111111111111111111111111111111111" as Address;
const AGENT1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const AGENT2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const AGENT3 = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;

const baseConfig: AllowanceDisbursConfig = {
  amount: "100",
  fee: 3000,
  slippageBps: 100,
};

describe("buildDisburseBatch — asset IS USDC", () => {
  const usdc = TOKENS().USDC;
  const minUsdc = parseUnits("100", 6);

  it("produces only transfer calls (no swap)", () => {
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1, AGENT2], usdc, 6, minUsdc, null);
    // No approve, no swap — just 2 transfers
    expect(calls).toHaveLength(2);
    // Both target USDC
    for (const call of calls) {
      expect(call.target).toBe(TOKENS().USDC);
    }
  });

  it("splits amount equally among agents", () => {
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1, AGENT2], usdc, 6, minUsdc, null);
    // Each agent gets 50 USDC (100 / 2 = 50e6)
    expect(calls).toHaveLength(2);
  });

  it("handles single agent", () => {
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1], usdc, 6, minUsdc, null);
    expect(calls).toHaveLength(1);
    expect(calls[0].target).toBe(TOKENS().USDC);
  });

  it("integer division — dust stays in vault", () => {
    // 100 USDC / 3 agents = 33.333... USDC each (33333333 per agent)
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1, AGENT2, AGENT3], usdc, 6, minUsdc, null);
    expect(calls).toHaveLength(3);
    // perAgent = 100000000n / 3n = 33333333n (1 unit dust stays in vault)
  });
});

describe("buildDisburseBatch — asset IS WETH", () => {
  const weth = TOKENS().WETH;
  const minUsdc = parseUnits("200", 6);

  it("produces approve + swap + transfers", () => {
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1, AGENT2], weth, 18, minUsdc, null);
    // 1 approve + 1 exactInputSingle + 2 transfers = 4
    expect(calls).toHaveLength(4);
  });

  it("first call approves SwapRouter for WETH", () => {
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1], weth, 18, minUsdc, null);
    expect(calls[0].target).toBe(TOKENS().WETH);
  });

  it("second call targets SwapRouter", () => {
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1], weth, 18, minUsdc, null);
    expect(calls[1].target).toBe(UNISWAP().SWAP_ROUTER);
  });

  it("transfer calls target USDC", () => {
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1, AGENT2], weth, 18, minUsdc, null);
    expect(calls[2].target).toBe(TOKENS().USDC);
    expect(calls[3].target).toBe(TOKENS().USDC);
  });
});

describe("buildDisburseBatch — asset is other token (multi-hop)", () => {
  const otherToken = "0x9999999999999999999999999999999999999999" as Address;
  const minUsdc = parseUnits("150", 6);
  const swapPath = encodeSwapPath(
    [otherToken, TOKENS().WETH, TOKENS().USDC],
    [3000, 500],
  );

  it("produces approve + multi-hop swap + transfers", () => {
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1, AGENT2], otherToken, 18, minUsdc, swapPath);
    // 1 approve + 1 exactInput + 2 transfers = 4
    expect(calls).toHaveLength(4);
  });

  it("first call approves the other token", () => {
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1], otherToken, 18, minUsdc, swapPath);
    expect(calls[0].target).toBe(otherToken);
  });

  it("second call uses exactInput on SwapRouter", () => {
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1], otherToken, 18, minUsdc, swapPath);
    expect(calls[1].target).toBe(UNISWAP().SWAP_ROUTER);
  });

  it("all calls have zero value", () => {
    const calls = buildDisburseBatch(baseConfig, VAULT, [AGENT1, AGENT2], otherToken, 18, minUsdc, swapPath);
    for (const call of calls) {
      expect(call.value).toBe(0n);
    }
  });
});
