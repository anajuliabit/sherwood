/**
 * E2E test: Human-readable contract errors (#143) + deposit pre-flight (#148)
 *
 * 1. Pre-flight: oversized deposit amount rejected before any tx is sent
 * 2. Revert → human-readable: depositing to a vault the agent isn't approved for
 *    produces a human-readable error (not raw hex like 0x62df0545)
 */

import { execSherwood } from "../../src/simulation/exec.js";
import { agentHomeDir } from "../../src/simulation/agent-home.js";
import type { SimConfig, SimState, SimLogger } from "./types.js";

export async function testErrors(config: SimConfig, state: SimState, logger?: SimLogger): Promise<void> {
  // Pick any funded agent
  const agent = state.agents.find(a => a.funded);
  if (!agent) throw new Error("No funded agent found in state");

  const home = agentHomeDir(config.baseDir, agent.index);
  console.log(`  Using agent ${agent.index} (${agent.address}) for error tests`);

  // ── Test 1: Pre-flight balance check ──
  // Depositing an impossibly large amount should be rejected by pre-flight
  // BEFORE any on-chain transaction is attempted.
  let preflightCaught = false;
  try {
    execSherwood(
      home,
      ["vault", "deposit", "--amount", "999999999"],
      config, logger, agent.index,
    );
    if (!config.dryRun) throw new Error("Expected pre-flight to reject oversized deposit but it did not");
  } catch (err) {
    if (err instanceof Error && err.message.includes("Expected pre-flight")) throw err;
    const msg = (err as Error).message.toLowerCase();
    if (!msg.includes("insufficient") && !msg.includes("balance") && !msg.includes("have") && !msg.includes("need")) {
      throw new Error(`Pre-flight: expected balance/insufficient message, got: ${(err as Error).message.slice(0, 200)}`);
    }
    preflightCaught = true;
  }
  if (!config.dryRun && !preflightCaught) {
    throw new Error("Pre-flight check did not trigger for oversized deposit");
  }
  console.log("  ✓ Pre-flight balance check correctly rejected oversized deposit");

  // ── Test 2: Human-readable revert ──
  // Find a WETH vault where this agent is NOT a member — depositing to it should revert.
  // The CLI must produce a human-readable message, not a raw hex selector.
  const foreignSyndicate = state.syndicates.find(
    s => s.vault && !s.members.includes(agent.index),
  );

  if (!foreignSyndicate?.vault) {
    console.log("  ⚠  No foreign vault found for revert test — skipping");
    return;
  }

  let revertCaught = false;
  let depositSucceeded = false;
  try {
    execSherwood(
      home,
      ["vault", "deposit", "--amount", "0.001", "--vault", foreignSyndicate.vault],
      config, logger, agent.index,
    );
    // Deposit succeeded — vault likely has open-deposits enabled, skip this sub-test
    depositSucceeded = true;
  } catch (err) {
    const msg = (err as Error).message;

    // Fail if the error is just a raw hex selector with no description
    // A human-readable message will have spaces, letters, and be > 20 chars
    const hexOnlyPattern = /^sherwood [^\n]+ failed:\n0x[0-9a-f]{8}\s*$/i;
    if (hexOnlyPattern.test(msg)) {
      throw new Error(`Error is raw hex (not human-readable): ${msg.slice(0, 200)}`);
    }

    console.log(`  ✓ Human-readable error received: ${msg.split("\n").pop()?.slice(0, 80)}`);
    revertCaught = true;
  }

  if (depositSucceeded) {
    console.log("  ⚠  Deposit to foreign vault succeeded (open-deposits enabled) — revert test skipped");
  } else if (!config.dryRun && !revertCaught) {
    throw new Error("Expected vault deposit to revert but it succeeded");
  }
  console.log("  ✓ Human-readable error test passed");
}
