/**
 * Identity commands — sherwood identity <subcommand>
 *
 * Manages ERC-8004 agent identity NFTs on the IdentityRegistry.
 * Required before creating or joining syndicates.
 */

import { Command } from "commander";
import type { Address } from "viem";
import { decodeEventLog } from "viem";
import chalk from "chalk";
import ora from "ora";
import { getPublicClient, getWalletClient, getAccount } from "../lib/client.js";
import { getExplorerUrl } from "../lib/network.js";
import { AGENT_REGISTRY } from "../lib/addresses.js";
import { setAgentId, getAgentId } from "../lib/config.js";

// ── ABI (minimal) ──

const IDENTITY_REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const REGISTERED_EVENT = {
  type: "event",
  name: "Registered",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "agentURI", type: "string", indexed: false },
    { name: "owner", type: "address", indexed: true },
  ],
} as const;

export function registerIdentityCommands(program: Command): void {
  const identity = program.command("identity").description("Manage ERC-8004 agent identity");

  // ── identity mint ──

  identity
    .command("mint")
    .description("Mint a new ERC-8004 agent identity NFT (required before creating/joining syndicates)")
    .option("--uri <uri>", "Agent metadata URI (IPFS recommended)", "")
    .action(async (opts) => {
      const account = getAccount();
      const registry = AGENT_REGISTRY().IDENTITY_REGISTRY;

      // Check if wallet already has an identity
      const existingId = getAgentId();
      if (existingId) {
        console.log(chalk.yellow(`You already have an agent identity saved: #${existingId}`));
        console.log(chalk.dim("  Use --force to mint another, or 'sherwood identity status' to verify."));
        // Don't block — they might want to mint another or lost the old one
      }

      const spinner = ora("Minting agent identity...").start();
      try {
        const wallet = getWalletClient();
        const client = getPublicClient();

        const hash = await wallet.writeContract({
          account,
          chain: wallet.chain,
          address: registry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "register",
          args: [opts.uri],
        });

        spinner.text = "Waiting for confirmation...";
        const receipt = await client.waitForTransactionReceipt({ hash });

        // Parse the Registered event to get the token ID
        let agentId: number | undefined;
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: [REGISTERED_EVENT],
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "Registered") {
              agentId = Number(decoded.args.agentId);
              break;
            }
          } catch {
            // Not our event, skip
          }
        }

        if (!agentId) {
          spinner.warn("Identity minted but could not parse token ID from logs");
          console.log(chalk.dim(`  Tx: ${getExplorerUrl(hash)}`));
          console.log(chalk.dim("  Check the tx logs to find your agentId manually."));
          return;
        }

        // Save to config
        setAgentId(agentId);

        spinner.succeed(`Agent identity minted: #${agentId}`);
        console.log(chalk.dim(`  Tx: ${getExplorerUrl(hash)}`));
        console.log(chalk.dim(`  Registry: ${registry}`));
        console.log(chalk.dim(`  Owner: ${account.address}`));
        console.log(chalk.dim(`  Saved to ~/.sherwood/config.json`));
        console.log();
        console.log(chalk.green("You can now create syndicates:"));
        console.log(chalk.dim(`  sherwood syndicate create --agent-id ${agentId} --subdomain <name> --name <name>`));
      } catch (err) {
        spinner.fail("Failed to mint identity");
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  // ── identity status ──

  identity
    .command("status")
    .description("Show your agent identity status")
    .action(async () => {
      const account = getAccount();
      const registry = AGENT_REGISTRY().IDENTITY_REGISTRY;
      const client = getPublicClient();

      const spinner = ora("Checking identity...").start();
      try {
        const balance = await client.readContract({
          address: registry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "balanceOf",
          args: [account.address],
        }) as bigint;

        spinner.stop();

        const savedId = getAgentId();

        console.log();
        console.log(chalk.bold("Agent Identity (ERC-8004)"));
        console.log(chalk.dim("─".repeat(40)));
        console.log(`  Wallet:     ${account.address}`);
        console.log(`  Registry:   ${registry}`);
        console.log(`  NFTs owned: ${balance.toString()}`);

        if (savedId) {
          // Verify the saved ID is still owned by this wallet
          try {
            const owner = await client.readContract({
              address: registry,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: "ownerOf",
              args: [BigInt(savedId)],
            }) as Address;

            const isOwner = owner.toLowerCase() === account.address.toLowerCase();
            console.log(`  Saved ID:   #${savedId} ${isOwner ? chalk.green("(verified)") : chalk.red("(owned by " + owner + ")")}`);
          } catch {
            console.log(`  Saved ID:   #${savedId} ${chalk.red("(token not found)")}`);
          }
        } else {
          console.log(`  Saved ID:   ${chalk.dim("none — run 'sherwood identity mint'")}`);
        }
        console.log();
      } catch (err) {
        spinner.fail("Failed to check identity");
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}
