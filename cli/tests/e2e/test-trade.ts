/**
 * E2E test: Trade buy/sell with flexible token inputs (#127)
 *
 * Runs on Base mainnet (real liquidity) using a funded agent from simulation state.
 * Tests all trade buy/sell variants: USDC input, --with ETH, --with WETH,
 * sell --for WETH, sell default USDC output, and positions display.
 */

import { execSherwood } from "../../src/simulation/exec.js";
import { agentHomeDir } from "../../src/simulation/agent-home.js";
import type { SimConfig, SimState, SimLogger } from "./types.js";

export async function testTrade(config: SimConfig, state: SimState, logger?: SimLogger): Promise<void> {
  // Check for Uniswap API key — required for all trade commands
  if (!process.env.UNISWAP_API_KEY) {
    console.log("  ⚠  UNISWAP_API_KEY not set — skipping trade tests");
    console.log("     Set it with: sherwood config set --uniswap-api-key <key>");
    console.log("     Or export UNISWAP_API_KEY=<key> before running");
    return;
  }

  // Use the first agent (always a creator with USDC from phase 01 funding)
  const agent = state.agents[0];
  const home = agentHomeDir(config.baseDir, agent.index);

  console.log(`  Using agent ${agent.index} (${agent.address}) for trade tests`);

  // 1. buy DEGEN with USDC (default input) — $0.50
  const buyOut = execSherwood(
    home,
    ["trade", "buy", "--token", "DEGEN", "--amount", "0.5", "--slippage", "5"],
    config, logger, agent.index,
  );
  if (!buyOut && !config.dryRun) throw new Error("trade buy returned empty output");

  // 2. buy DEGEN --with ETH (should wrap ETH → WETH, then swap)
  execSherwood(
    home,
    ["trade", "buy", "--token", "DEGEN", "--amount", "0.0001", "--with", "ETH", "--slippage", "10"],
    config, logger, agent.index,
  );

  // 3. buy DEGEN --with WETH (direct WETH input, no wrap)
  execSherwood(
    home,
    ["trade", "buy", "--token", "DEGEN", "--amount", "0.0001", "--with", "WETH", "--slippage", "10"],
    config, logger, agent.index,
  );

  // 4. sell DEGEN --for WETH (non-USDC output)
  execSherwood(
    home,
    ["trade", "sell", "--token", "DEGEN", "--for", "WETH"],
    config, logger, agent.index,
  );

  // 5. sell DEGEN (default USDC output)
  execSherwood(
    home,
    ["trade", "sell", "--token", "DEGEN"],
    config, logger, agent.index,
  );

  // 6. positions — should show at least closed entries from above trades
  const posOut = execSherwood(
    home,
    ["trade", "positions"],
    config, logger, agent.index,
  );

  if (!config.dryRun && posOut &&
      !posOut.includes("DEGEN") &&
      !posOut.includes("position") &&
      !posOut.includes("closed") &&
      !posOut.includes("No open")) {
    throw new Error(`trade positions output unexpected:\n${posOut}`);
  }

  console.log("  ✓ All trade variants executed successfully");
}
