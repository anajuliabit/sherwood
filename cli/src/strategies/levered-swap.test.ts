import { describe, it, expect, beforeAll } from "vitest";
import { buildEntryBatch, buildExitBatch, type LeveredSwapConfig } from "./levered-swap.js";
import { setNetwork } from "../lib/network.js";
import { TOKENS, MOONWELL, UNISWAP } from "../lib/addresses.js";
import type { Address } from "viem";
import { parseEther, parseUnits } from "viem";

// Use mainnet addresses for testing (all non-zero)
beforeAll(() => setNetwork("base"));

const VAULT = "0x1111111111111111111111111111111111111111" as Address;
const TARGET_TOKEN = "0x2222222222222222222222222222222222222222" as Address;

const config: LeveredSwapConfig = {
  collateralAmount: "1.0",
  borrowAmount: "1000",
  targetToken: TARGET_TOKEN,
  fee: 3000,
  slippageBps: 100,
  profitTargetBps: 2000,
  stopLossBps: 1000,
};

describe("buildEntryBatch", () => {
  const minAmountOut = parseUnits("900", 18); // some token with 18 decimals
  const borrowDecimals = 6; // USDC

  it("returns exactly 6 calls", () => {
    const calls = buildEntryBatch(config, VAULT, minAmountOut, borrowDecimals);
    expect(calls).toHaveLength(6);
  });

  it("targets correct contracts in order", () => {
    const calls = buildEntryBatch(config, VAULT, minAmountOut, borrowDecimals);
    // 1. approve WETH → mWETH
    expect(calls[0].target).toBe(TOKENS().WETH);
    // 2. mint mWETH
    expect(calls[1].target).toBe(MOONWELL().mWETH);
    // 3. enterMarkets on comptroller
    expect(calls[2].target).toBe(MOONWELL().COMPTROLLER);
    // 4. borrow USDC from mUSDC
    expect(calls[3].target).toBe(MOONWELL().mUSDC);
    // 5. approve USDC → SwapRouter
    expect(calls[4].target).toBe(TOKENS().USDC);
    // 6. swap on SwapRouter
    expect(calls[5].target).toBe(UNISWAP().SWAP_ROUTER);
  });

  it("all calls have zero value", () => {
    const calls = buildEntryBatch(config, VAULT, minAmountOut, borrowDecimals);
    for (const call of calls) {
      expect(call.value).toBe(0n);
    }
  });

  it("encodes collateral as 18-decimal WETH", () => {
    const calls = buildEntryBatch(config, VAULT, minAmountOut, borrowDecimals);
    // The approve call data should contain 1e18 (1.0 WETH)
    const expected = parseEther("1.0");
    // approve(mWETH, 1e18) — amount is in the calldata
    expect(calls[0].data).toContain(expected.toString(16).toLowerCase());
  });

  it("encodes borrow as 6-decimal USDC", () => {
    const calls = buildEntryBatch(config, VAULT, minAmountOut, borrowDecimals);
    // borrow(1000e6) — 1000 USDC with 6 decimals = 1000000000
    const expected = parseUnits("1000", 6);
    expect(calls[3].data).toContain(expected.toString(16).padStart(64, "0").toLowerCase());
  });
});

describe("buildExitBatch", () => {
  const tokenBalance = parseUnits("500", 18);
  const minUsdcOut = parseUnits("900", 6);
  const borrowBalance = parseUnits("1005", 6); // borrow + interest

  it("returns exactly 5 calls", () => {
    const calls = buildExitBatch(config, VAULT, tokenBalance, minUsdcOut, borrowBalance);
    expect(calls).toHaveLength(5);
  });

  it("targets correct contracts in order", () => {
    const calls = buildExitBatch(config, VAULT, tokenBalance, minUsdcOut, borrowBalance);
    // 1. approve target → SwapRouter
    expect(calls[0].target).toBe(TARGET_TOKEN);
    // 2. swap target → USDC
    expect(calls[1].target).toBe(UNISWAP().SWAP_ROUTER);
    // 3. approve USDC → mUSDC
    expect(calls[2].target).toBe(TOKENS().USDC);
    // 4. repayBorrow on mUSDC
    expect(calls[3].target).toBe(MOONWELL().mUSDC);
    // 5. redeemUnderlying on mWETH
    expect(calls[4].target).toBe(MOONWELL().mWETH);
  });

  it("all calls have zero value", () => {
    const calls = buildExitBatch(config, VAULT, tokenBalance, minUsdcOut, borrowBalance);
    for (const call of calls) {
      expect(call.value).toBe(0n);
    }
  });
});

describe("zero-address guard", () => {
  it("buildEntryBatch throws on testnet (Moonwell not deployed)", () => {
    setNetwork("base-sepolia");
    expect(() =>
      buildEntryBatch(config, VAULT, parseUnits("900", 18), 6),
    ).toThrow("Moonwell is not deployed");
    setNetwork("base"); // restore
  });

  it("buildExitBatch throws on testnet (Moonwell not deployed)", () => {
    setNetwork("base-sepolia");
    expect(() =>
      buildExitBatch(config, VAULT, parseUnits("500", 18), parseUnits("900", 6), parseUnits("1000", 6)),
    ).toThrow("Moonwell is not deployed");
    setNetwork("base"); // restore
  });
});
