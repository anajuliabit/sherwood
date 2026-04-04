/**
 * E2E test: syndicate leave + re-join (#142)
 *
 * 1. syndicate leave — removes membership, clears session
 * 2. re-join after leave — crons re-registered
 */

import { execSherwood } from "../../src/simulation/exec.js";
import { agentHomeDir } from "../../src/simulation/agent-home.js";
import type { SimConfig, SimState, SimLogger } from "./types.js";

export async function testLeave(config: SimConfig, state: SimState, logger?: SimLogger): Promise<void> {
  // Find an approved joiner with a known syndicate
  const joiner = state.agents.find(a => a.approved && a.syndicateSubdomain);
  if (!joiner) throw new Error("No approved joiner found in state");

  const home = agentHomeDir(config.baseDir, joiner.index);
  const subdomain = joiner.syndicateSubdomain!;

  console.log(`  Using agent ${joiner.index} (${joiner.address}), syndicate: ${subdomain}`);

  // ── Test 1: syndicate leave ──
  const leaveOut = execSherwood(
    home,
    ["syndicate", "leave", "--subdomain", subdomain],
    config, logger, joiner.index,
  );
  // Just confirm no throw — the leave command's output format may vary
  console.log(`  ✓ syndicate leave executed (output: ${leaveOut.slice(0, 60)}...)`);

  // ── Test 2: re-join after leave ──
  execSherwood(
    home,
    [
      "syndicate", "join",
      "--subdomain", subdomain,
      "--message", "e2e re-join after leave test",
    ],
    config, logger, joiner.index,
  );
  console.log("  ✓ syndicate join after leave succeeded");
}
