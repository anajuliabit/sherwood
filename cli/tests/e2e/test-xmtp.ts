/**
 * E2E test: XMTP migration to @xmtp/node-sdk (#141)
 *
 * 1. chat send — message delivered
 * 2. chat log — contains the message we sent
 * 3. chat members — non-empty list
 * 4. XMTP DB directory exists inside agent HOME
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { execSherwood } from "../../src/simulation/exec.js";
import { agentHomeDir } from "../../src/simulation/agent-home.js";
import type { SimConfig, SimState, SimLogger } from "./types.js";

const TEST_MSG = `e2e-xmtp-test-${Date.now()}`;

export async function testXmtp(config: SimConfig, state: SimState, logger?: SimLogger): Promise<void> {
  // Find an approved member with a syndicate
  const member = state.agents.find(a => a.approved && a.syndicateSubdomain);
  if (!member) throw new Error("No approved member with syndicate found in state");

  const home = agentHomeDir(config.baseDir, member.index);
  const subdomain = member.syndicateSubdomain!;

  console.log(`  Using agent ${member.index} (${member.address}), syndicate: ${subdomain}`);

  // ── Test 1: chat send ──
  execSherwood(
    home,
    ["chat", subdomain, "send", TEST_MSG],
    config, logger, member.index,
  );
  console.log("  ✓ chat send executed");

  // ── Test 2: chat log — our message should appear ──
  const logOut = execSherwood(
    home,
    ["chat", subdomain, "log"],
    config, logger, member.index,
  );

  if (!config.dryRun && !logOut.includes(TEST_MSG)) {
    throw new Error(
      `chat log does not contain sent message '${TEST_MSG}'.\n` +
      `Full output (first 500 chars): ${logOut.slice(0, 500)}`,
    );
  }
  console.log("  ✓ chat log contains sent message");

  // ── Test 3: chat members — non-empty ──
  const membersOut = execSherwood(
    home,
    ["chat", subdomain, "members"],
    config, logger, member.index,
  );

  if (!config.dryRun && (!membersOut || membersOut.trim().length === 0)) {
    throw new Error("chat members returned empty output — expected at least one member");
  }
  console.log("  ✓ chat members returned non-empty list");

  // ── Test 4: XMTP DB directory exists in agent HOME ──
  const xmtpDir = path.join(home, ".sherwood", "xmtp");
  if (!config.dryRun && !existsSync(xmtpDir)) {
    throw new Error(`XMTP DB directory not found at expected path: ${xmtpDir}`);
  }
  console.log(`  ✓ XMTP DB directory exists: ${xmtpDir}`);
}
