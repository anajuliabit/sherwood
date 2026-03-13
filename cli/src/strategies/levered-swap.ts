/**
 * Levered Swap Strategy
 *
 * The agent's autonomous loop:
 * 1. Research: Query Messari for market intelligence (signal, metrics, news)
 * 2. Decide: Analyze data, identify opportunity, pick token + size
 * 3. Execute: Deposit collateral → Borrow → Swap into target token (atomic batch)
 * 4. Monitor: Continuously check position health + market conditions
 * 5. Unwind: Hit profit target or risk threshold → Sell → Repay → Withdraw
 *
 * All intelligence lives here. The on-chain BatchExecutor is a dumb pipe.
 */

import type { Address } from "viem";
import {
  encodeFunctionData,
  parseUnits,
  formatUnits,
} from "viem";
import type { BatchCall } from "../lib/batch.js";
import { MOONWELL, UNISWAP, TOKENS } from "../lib/addresses.js";

// ── Strategy Config ──

export interface LeveredSwapConfig {
  /** Collateral amount in USDC (human-readable, e.g. "10000") */
  collateralAmount: string;
  /** Borrow amount in USDC (human-readable) */
  borrowAmount: string;
  /** Target token to buy */
  targetToken: Address;
  /** Uniswap pool fee tier */
  fee: 500 | 3000 | 10000;
  /** Max slippage in basis points (e.g. 100 = 1%) */
  slippageBps: number;
  /** Profit target in basis points (e.g. 2000 = 20%) */
  profitTargetBps: number;
  /** Stop loss in basis points (e.g. 1000 = 10%) */
  stopLossBps: number;
}

// ── ABIs (minimal, what BatchExecutor needs to encode calls) ──

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const MTOKEN_ABI = [
  {
    name: "mint",
    type: "function",
    inputs: [{ name: "mintAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "borrow",
    type: "function",
    inputs: [{ name: "borrowAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "repayBorrow",
    type: "function",
    inputs: [{ name: "repayAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "redeemUnderlying",
    type: "function",
    inputs: [{ name: "redeemAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const COMPTROLLER_ABI = [
  {
    name: "enterMarkets",
    type: "function",
    inputs: [{ name: "mTokens", type: "address[]" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
] as const;

const SWAP_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

// ── Build Entry Batch (Deposit → Borrow → Swap) ──

export function buildEntryBatch(
  config: LeveredSwapConfig,
  executorAddress: Address,
  amountOutMinimum: bigint, // Computed by CLI from Uniswap quote
): BatchCall[] {
  const collateral = parseUnits(config.collateralAmount, 6); // USDC = 6 decimals
  const borrow = parseUnits(config.borrowAmount, 6);

  const calls: BatchCall[] = [
    // 1. Approve mUSDC to pull USDC from executor
    {
      target: TOKENS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [MOONWELL.mUSDC, collateral],
      }),
      value: 0n,
    },
    // 2. Deposit USDC as collateral (mint mTokens)
    {
      target: MOONWELL.mUSDC,
      data: encodeFunctionData({
        abi: MTOKEN_ABI,
        functionName: "mint",
        args: [collateral],
      }),
      value: 0n,
    },
    // 3. Enter market (enable as collateral for borrowing)
    {
      target: MOONWELL.COMPTROLLER,
      data: encodeFunctionData({
        abi: COMPTROLLER_ABI,
        functionName: "enterMarkets",
        args: [[MOONWELL.mUSDC]],
      }),
      value: 0n,
    },
    // 4. Borrow USDC against collateral
    {
      target: MOONWELL.mUSDC,
      data: encodeFunctionData({
        abi: MTOKEN_ABI,
        functionName: "borrow",
        args: [borrow],
      }),
      value: 0n,
    },
    // 5. Approve SwapRouter to pull borrowed USDC
    {
      target: TOKENS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [UNISWAP.SWAP_ROUTER, borrow],
      }),
      value: 0n,
    },
    // 6. Swap USDC → target token
    {
      target: UNISWAP.SWAP_ROUTER,
      data: encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: TOKENS.USDC,
            tokenOut: config.targetToken,
            fee: config.fee,
            recipient: executorAddress, // Tokens stay in executor
            amountIn: borrow,
            amountOutMinimum,
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
      value: 0n,
    },
  ];

  return calls;
}

// ── Build Exit Batch (Swap Back → Repay → Withdraw) ──

export function buildExitBatch(
  config: LeveredSwapConfig,
  executorAddress: Address,
  tokenBalance: bigint, // How much of the target token to sell
  amountOutMinimum: bigint, // Min USDC from selling the token
  borrowBalance: bigint, // Current borrow balance to repay
): BatchCall[] {
  const collateral = parseUnits(config.collateralAmount, 6);

  const calls: BatchCall[] = [
    // 1. Approve SwapRouter to pull target tokens
    {
      target: config.targetToken,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [UNISWAP.SWAP_ROUTER, tokenBalance],
      }),
      value: 0n,
    },
    // 2. Swap target token → USDC
    {
      target: UNISWAP.SWAP_ROUTER,
      data: encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: config.targetToken,
            tokenOut: TOKENS.USDC,
            fee: config.fee,
            recipient: executorAddress,
            amountIn: tokenBalance,
            amountOutMinimum,
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
      value: 0n,
    },
    // 3. Approve mUSDC to pull USDC for repayment
    {
      target: TOKENS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [MOONWELL.mUSDC, borrowBalance],
      }),
      value: 0n,
    },
    // 4. Repay borrow
    {
      target: MOONWELL.mUSDC,
      data: encodeFunctionData({
        abi: MTOKEN_ABI,
        functionName: "repayBorrow",
        args: [borrowBalance],
      }),
      value: 0n,
    },
    // 5. Withdraw collateral
    {
      target: MOONWELL.mUSDC,
      data: encodeFunctionData({
        abi: MTOKEN_ABI,
        functionName: "redeemUnderlying",
        args: [collateral],
      }),
      value: 0n,
    },
  ];

  return calls;
}

// TODO: buildMonitorLoop() — continuous position health + market check
// Uses Messari Signal API for sentiment shifts
// Uses Messari Metrics API for price movement
// Checks Moonwell getAccountLiquidity for health factor
// Triggers exit when profit target or stop loss hit

// TODO: getQuote() — use Uniswap SDK to get amountOutMinimum
// @uniswap/smart-order-router or @uniswap/v3-sdk
// Returns: amountOut, priceImpact, route path
// CLI applies slippageBps to amountOut for amountOutMinimum

// TODO: getMessariSignal() — query Messari Signal API for token sentiment
// POST https://api.messari.io/ai/v2/chat/completions
// or GET https://api.messari.io/signal/v1/... for sentiment data
// x402 auth: send request, handle 402, sign payment, retry

// TODO: Multi-hop routing for tokens without direct USDC pair
// Use SWAP_EXACT_IN_MULTI with encoded path from Uniswap SDK
