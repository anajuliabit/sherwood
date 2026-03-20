# Contracts

Solidity smart contracts for Sherwood, built with Foundry and OpenZeppelin (UUPS upgradeable). Contracts deploy on Base and Robinhood L2. See [Deployments](deployments.md) for the full chain matrix.

## Architecture

```
                   ┌──────────────┐
                   │   Factory    │ ── deploys vault proxies, registers with governor
                   │  (UUPS)     │
                   └──────┬───────┘
                          │ deploys + registers
              ┌───────────▼───────────┐         ┌─────────────────────┐
              │    SyndicateVault     │◄────────►│  SyndicateGovernor  │
              │    (ERC1967 Proxy)    │ execute/ │  (ERC1967 Proxy)    │
              │                      │ settle   │                     │
              │  delegatecall ──────►│          │  inherits           │
              │  BatchExecutorLib    │          │  GovernorParameters  │
              └──────────────────────┘          └─────────────────────┘
```

The vault is the identity — all DeFi positions (Moonwell supply/borrow, Uniswap swaps, Venice staking) live on the vault address. Agents execute through the vault via delegatecall into a shared stateless library. The governor manages proposal lifecycle, voting, and settlement across all registered vaults.

## Contracts

### SyndicateVault

ERC-4626 vault with ERC20Votes for governance weight. Extends `ERC4626Upgradeable`, `ERC20VotesUpgradeable`, `OwnableUpgradeable`, `PausableUpgradeable`, `UUPSUpgradeable`, `ERC721Holder`.

**Permissions:**
- **Layer 1 (onchain):** Syndicate caps (`maxPerTx`, `maxDailyTotal`, `maxBorrowRatio`) + per-agent caps + target allowlist
- **Layer 2 (offchain):** Agent-side off-chain policies

**Key functions:**
- `executeBatch(calls)` — delegatecalls to BatchExecutorLib. Enforces caps and target allowlist.
- `executeGovernorBatch(calls)` — governor-only batch execution for proposal strategies
- `simulateBatch(calls)` — dry-run via `eth_call`, returns success/failure per call without submitting onchain
- `registerAgent(agentId, agentAddress)` — registers agent with ERC-8004 identity verification
- `transferPerformanceFee(token, to, amount)` — governor-only fee distribution after settlement
- `deposit(assets, receiver)` / `redeem(shares, receiver, owner)` — standard ERC-4626 LP entry/exit
- `redemptionsLocked()` — returns true while a governor proposal is actively executing

**Inflation protection:** Dynamic `_decimalsOffset()` returns `asset.decimals()` (6 for USDC), adding virtual shares to prevent first-depositor share price manipulation. Vault shares are 12-decimal tokens (6 USDC + 6 offset).

**Storage:**
- `_agents` mapping — agent wallet address → `AgentConfig` (agentId, agentAddress, active)
- `_agentSet` — `EnumerableSet` of agent addresses
- `_approvedDepositors` — `EnumerableSet` of whitelisted depositor addresses
- `_openDeposits` — bool toggle for permissionless deposits
- `_governor` — trusted governor address
- `_managementFeeBps` — vault owner's profit share (basis points)

### SyndicateGovernor

Proposal lifecycle, voting, execution, settlement, and collaborative proposals. Inherits `GovernorParameters` (abstract) for all parameter management and timelock logic.

**Proposal lifecycle:** Draft → Pending → Approved/Rejected/Expired → Executed → Settled/Cancelled

**Key functions:**
- `propose(vault, metadataURI, performanceFeeBps, strategyDuration, executeCalls, settlementCalls, coProposers, minSettlementBalance)` — create proposal with separate opening/closing call arrays
- `vote(proposalId, voteType)` — cast vote weighted by ERC20Votes snapshot
- `executeProposal(proposalId)` — execute approved proposal's `executeCalls` through the vault
- `settleByAgent(proposalId, calls)` — agent settles, enforces no-loss + `minSettlementBalance`
- `settleProposal(proposalId)` — permissionless after strategy duration, uses pre-committed `settlementCalls`
- `emergencySettle(proposalId, calls)` — vault owner after duration, custom calls (escape hatch)
- `cancelProposal(proposalId)` / `emergencyCancel(proposalId)` — proposer or vault owner cancel
- `approveCollaboration(proposalId)` / `rejectCollaboration(proposalId)` — co-proposer consent

**Separate `executeCalls` / `settlementCalls`:** Proposals store opening and closing calls in two distinct arrays. No `splitIndex` — impossible to misindex.

**`minSettlementBalance`:** Optional proposer-committed floor for vault balance after settlement. Enforced only in `settleByAgent()` — escape hatches (`settleProposal`/`emergencySettle`) are exempt. This is an absolute value, not relative to capital snapshot.

**Collaborative proposals:** Proposers can include co-proposers with fee splits. Co-proposers must approve within the collaboration window before the proposal advances to voting.

**Storage:**
- `_proposals` mapping — proposal ID → `StrategyProposal` struct
- `_executeCalls` / `_settlementCalls` — separate call arrays per proposal
- `_capitalSnapshots` — vault balance at execution time
- `_minSettlementBalance` — proposer-committed settlement floor per proposal
- `_activeProposal` — current live proposal per vault (one at a time)
- `_registeredVaults` — `EnumerableSet` of registered vault addresses
- `_coProposers` / `coProposerApprovals` / `collaborationDeadline` — collaborative proposal state

### GovernorParameters

Abstract contract inherited by SyndicateGovernor. Contains all governance constants, 9 parameter setters, validation helpers, and the timelock mechanism.

**Timelock pattern:** All governance parameter changes are queued with a configurable delay (6h–7d). Owner calls the setter (queues the change), waits for the delay, then calls `finalizeParameterChange(paramKey)` to apply. Parameters are re-validated at finalize time. Owner can `cancelParameterChange(paramKey)` at any time.

**9 timelocked parameters:**
| Parameter | Bounds |
|-----------|--------|
| Voting period | 1h – 30d |
| Execution window | 1h – 7d |
| Quorum (bps) | 10% – 100% |
| Max performance fee (bps) | 0% – 50% |
| Min strategy duration | 1h – 30d |
| Max strategy duration | 1h – 30d |
| Cooldown period | 1h – 30d |
| Collaboration window | 1h – 7d |
| Max co-proposers | 1 – 10 |

### SyndicateFactory

UUPS upgradeable factory. Deploys vault proxies (ERC1967), registers them with the governor, and optionally registers ENS subnames. Verifies ERC-8004 identity on creation (skipped when registries are `address(0)`, e.g. on Robinhood L2).

**Config setters (owner-only):** `setExecutorImpl`, `setVaultImpl`, `setEnsRegistrar`, `setAgentRegistry`, `setGovernor`

**Storage:**
- `syndicates[]` — syndicate ID → struct (vault, creator, metadata, subdomain, active)
- `vaultToSyndicate` — reverse lookup from vault address
- `subdomainToSyndicate` — reverse lookup from ENS subdomain
- `governor` — shared governor address

### BatchExecutorLib

Shared stateless library (62 lines). Vault delegatecalls into it to execute batches of protocol calls (supply, borrow, swap, stake). Each call's target must be in the vault's allowlist.

### StrategyRegistry

Onchain registry of strategy implementations. Permissionless registration with creator tracking (for future carry fees). UUPS upgradeable.

## Deployed Addresses

See [Deployments](deployments.md) for the complete multi-chain address table, feature matrix, and token availability.

## Testing

216 tests across 5 test suites.

```bash
cd contracts
forge build        # compile
forge test         # run all tests
forge test -vvv    # verbose with traces
forge fmt          # format before committing
```

**SyndicateGovernor:** Proposal lifecycle, voting, execution, three settlement paths, parameter timelock (queue/finalize/cancel), `minSettlementBalance` enforcement, collaborative proposals (consent, rejection, deadline expiry), cooldown, quorum, fuzz testing.

**SyndicateVault:** ERC-4626 deposits/withdrawals/redemptions, agent registration with ERC-8004 verification, batch execution with target allowlist, depositor whitelist, inflation attack mitigation, governor batch execution, pause/unpause, simulation, fuzz testing.

**SyndicateFactory:** Syndicate creation with ENS subname registration, ERC-8004 verification on create, UUPS upgrade, config setters, metadata updates, deactivation, proxy storage isolation, subdomain availability, no-registry deployment (Robinhood L2).

**SyndicateGovernorIntegration:** End-to-end flows with real vault interactions — propose → vote → execute → settle, Moonwell/Uniswap fork tests.

**CollaborativeProposals:** Multi-agent co-proposer workflows — consent, rejection, fee splits, deadline enforcement.

## Deployment

Base Sepolia:
```bash
forge script script/testnet/Deploy.s.sol:DeployTestnet \
  --rpc-url base_sepolia \
  --account sherwood-agent \
  --broadcast
```

Robinhood L2 testnet (no ENS, no ERC-8004 — registries set to `address(0)`):
```bash
forge script script/robinhood-testnet/Deploy.s.sol:DeployRobinhoodTestnet \
  --rpc-url robinhood_testnet \
  --account sherwood-agent \
  --broadcast
```

Deployment records saved in `contracts/chains/{chainId}.json`.

## Storage Layout (UUPS Safety)

All three core contracts (Vault, Governor, Factory) are UUPS upgradeable. When modifying any of them:

- Always append new storage variables at the end (before `__gap`)
- Never reorder or remove existing slots
- Reduce `__gap` by the number of slots added
- Verify with `forge inspect <ContractName> storage-layout`
