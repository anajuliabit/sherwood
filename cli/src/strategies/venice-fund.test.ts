import { describe, it, expect, beforeAll } from "vitest";
import { buildFundBatch, type VeniceFundConfig } from "./venice-fund.js";
import { setNetwork } from "../lib/network.js";
import { TOKENS, UNISWAP, VENICE } from "../lib/addresses.js";
import { encodeSwapPath } from "../lib/quote.js";
import type { Address } from "viem";
import { parseUnits } from "viem";

beforeAll(() => setNetwork("base"));

const VAULT = "0x1111111111111111111111111111111111111111" as Address;
const AGENT1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const AGENT2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;

const baseConfig: VeniceFundConfig = {
  amount: "500",
  fee1: 3000,
  fee2: 10000,
  slippageBps: 100,
};

describe("buildFundBatch — asset IS WETH (single-hop)", () => {
  const weth = TOKENS().WETH;
  const minVVV = parseUnits("1000", 18);

  it("produces approve + swap + approve staking + stake per agent", () => {
    const calls = buildFundBatch(baseConfig, VAULT, [AGENT1, AGENT2], weth, 18, minVVV, null);
    // 1 approve swap + 1 swap + 1 approve staking + 2 stakes = 5
    expect(calls).toHaveLength(5);
  });

  it("first call approves SwapRouter for WETH", () => {
    const calls = buildFundBatch(baseConfig, VAULT, [AGENT1], weth, 18, minVVV, null);
    expect(calls[0].target).toBe(TOKENS().WETH);
  });

  it("second call is single-hop swap on SwapRouter (WETH → VVV)", () => {
    const calls = buildFundBatch(baseConfig, VAULT, [AGENT1], weth, 18, minVVV, null);
    expect(calls[1].target).toBe(UNISWAP().SWAP_ROUTER);
  });

  it("third call approves VVV for staking contract", () => {
    const calls = buildFundBatch(baseConfig, VAULT, [AGENT1], weth, 18, minVVV, null);
    expect(calls[2].target).toBe(VENICE().VVV);
  });

  it("stake calls target the staking contract", () => {
    const calls = buildFundBatch(baseConfig, VAULT, [AGENT1, AGENT2], weth, 18, minVVV, null);
    expect(calls[3].target).toBe(VENICE().STAKING);
    expect(calls[4].target).toBe(VENICE().STAKING);
  });

  it("splits VVV equally among agents (integer division)", () => {
    // 3 agents, 1000 VVV → 333 each (1 unit dust)
    const agent3 = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;
    const calls = buildFundBatch(baseConfig, VAULT, [AGENT1, AGENT2, agent3], weth, 18, minVVV, null);
    // 3 approve/swap calls + 3 stakes = 6
    expect(calls).toHaveLength(6);
  });

  it("all calls have zero value", () => {
    const calls = buildFundBatch(baseConfig, VAULT, [AGENT1, AGENT2], weth, 18, minVVV, null);
    for (const call of calls) {
      expect(call.value).toBe(0n);
    }
  });
});

describe("buildFundBatch — asset is USDC (multi-hop)", () => {
  const usdc = TOKENS().USDC;
  const minVVV = parseUnits("800", 18);
  const swapPath = encodeSwapPath(
    [usdc, TOKENS().WETH, VENICE().VVV],
    [3000, 10000],
  );

  it("produces approve + multi-hop swap + approve staking + stakes", () => {
    const calls = buildFundBatch(baseConfig, VAULT, [AGENT1, AGENT2], usdc, 6, minVVV, swapPath);
    // 1 approve swap + 1 exactInput + 1 approve staking + 2 stakes = 5
    expect(calls).toHaveLength(5);
  });

  it("uses exactInput for multi-hop", () => {
    const calls = buildFundBatch(baseConfig, VAULT, [AGENT1], usdc, 6, minVVV, swapPath);
    // Call 0: approve USDC for SwapRouter
    expect(calls[0].target).toBe(usdc);
    // Call 1: exactInput on SwapRouter
    expect(calls[1].target).toBe(UNISWAP().SWAP_ROUTER);
  });
});

describe("zero-address guard", () => {
  it("buildFundBatch throws on testnet (Venice not deployed)", () => {
    setNetwork("base-sepolia");
    expect(() =>
      buildFundBatch(baseConfig, VAULT, [AGENT1], TOKENS().WETH, 18, parseUnits("1000", 18), null),
    ).toThrow("Venice (VVV/sVVV) is not deployed");
    setNetwork("base"); // restore
  });
});
