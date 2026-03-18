# CLI Governance Commands — Design Doc

Design for `sherwood proposal` and `sherwood governor` command groups. These commands expose the SyndicateGovernor contract's proposal lifecycle, voting, settlement, and parameter management to CLI users.

## Prerequisites

- `SYNDICATE_GOVERNOR_ABI` in `cli/src/lib/abis.ts` (done)
- `GOVERNOR` address in `cli/src/lib/addresses.ts` (done, pending redeploy)
- `cli/src/lib/governor.ts` — new helper module (to be created)

## Command: `sherwood proposal create`

Agent submits a strategy proposal with pre-committed execute + settle calls.

```
sherwood proposal create \
  --vault <addr> \
  --metadata-uri <ipfs://...> \
  --performance-fee <bps> \
  --duration <seconds|7d|24h> \
  --calls <path-to-json> \
  --split-index <n> \
  [--testnet]
```

**Flags:**
| Flag | Required | Description |
|------|----------|-------------|
| `--vault` | yes | Vault address the proposal targets |
| `--metadata-uri` | yes | IPFS URI with strategy rationale (name, description, risk) |
| `--performance-fee` | yes | Agent's fee in bps (e.g. 1500 = 15%, capped by governor) |
| `--duration` | yes | Strategy duration. Accepts seconds or human format (`7d`, `24h`, `1h`) |
| `--calls` | yes | Path to JSON file with Call[] array (target, data, value) |
| `--split-index` | yes | Index where execute calls end and settle calls begin |

**Call JSON format:**
```json
[
  { "target": "0x...", "data": "0x...", "value": "0" },
  { "target": "0x...", "data": "0x...", "value": "0" }
]
```

Calls before `splitIndex` run at execution time (open positions). Calls from `splitIndex` onward run at settlement (close positions).

**Flow:**
1. Validate caller is a registered agent on the vault
2. Parse and validate calls JSON
3. Display proposal summary for review
4. Call `governor.propose(vault, metadataURI, performanceFeeBps, strategyDuration, calls, splitIndex)`
5. Print proposalId and voting period end time

## Command: `sherwood proposal list`

List proposals for a vault.

```
sherwood proposal list [--vault <addr>] [--state <filter>] [--testnet]
```

**Flags:**
| Flag | Required | Description |
|------|----------|-------------|
| `--vault` | no | Filter by vault (default: configured vault) |
| `--state` | no | Filter by state: `pending`, `approved`, `executed`, `settled`, `all` (default: `all`) |

**Implementation:** Query subgraph for `Proposal` entities filtered by vault/state. Fallback to on-chain iteration via `governor.proposalCount()` + `governor.getProposal(id)`.

**Output table:**
```
ID  Agent     State     Votes (For/Against)  Fee    Duration  Created
1   0xab...   Pending   1200/300             15%    7d        2026-03-18
2   0xcd...   Executed  5000/100             10%    30d       2026-03-15
```

## Command: `sherwood proposal show <id>`

Full detail view of a single proposal.

```
sherwood proposal show <id> [--testnet]
```

**Output:**
- Proposal metadata (from IPFS if available)
- State, timestamps (created, vote end, execution deadline, executed, settled)
- Vote breakdown (for/against, quorum status)
- Decoded calls (show target names if known protocols like Moonwell, Uniswap)
- Capital snapshot (if executed)
- P&L and fees (if settled)

## Command: `sherwood proposal vote`

Cast a vote on a pending proposal.

```
sherwood proposal vote --id <proposalId> --support <yes|no> [--testnet]
```

**Flow:**
1. Load proposal, verify state is Pending and within voting period
2. Check caller has voting power (vault shares at snapshot)
3. Display proposal summary + vote weight
4. Confirm with user
5. Call `governor.vote(proposalId, support)`

## Command: `sherwood proposal execute`

Execute an approved proposal (anyone can call).

```
sherwood proposal execute --id <proposalId> [--testnet]
```

**Flow:**
1. Verify proposal is Approved and within execution window
2. Verify no other strategy is active on the vault
3. Verify cooldown has elapsed
4. Call `governor.executeProposal(proposalId)`
5. Print capital snapshot and redemption lock status

## Command: `sherwood proposal settle`

Settle an executed proposal. Routes to the appropriate settlement path.

```
sherwood proposal settle --id <proposalId> [--calls <path-to-json>] [--testnet]
```

**Routing logic:**
- If caller is the proposer (agent) → `settleByAgent(proposalId, calls)` (calls required)
- If strategy duration has elapsed → `settleProposal(proposalId)` (permissionless, no calls needed)
- If caller is vault owner and duration elapsed → `emergencySettle(proposalId, calls)` (with custom calls)

**Output:** P&L, fees distributed, redemptions unlocked confirmation.

## Command: `sherwood proposal cancel`

Cancel a proposal before execution.

```
sherwood proposal cancel --id <proposalId> [--testnet]
```

**Flow:**
- Proposer can cancel if state is Pending/Approved
- Vault owner can emergency cancel at any non-settled state

## Command: `sherwood governor info`

Display current governor parameters and status.

```
sherwood governor info [--testnet]
```

**Output:**
```
Governor Parameters
  Voting Period:         1 day
  Execution Window:      1 day
  Quorum:                40%
  Max Performance Fee:   30%
  Max Strategy Duration: 30 days
  Cooldown Period:       1 day

Registered Vaults: 3
  0xabc... (sherwood)
  0xdef... (alpha-seekers)
  0x123... (yield-hunters)
```

## Command: `sherwood governor set-*`

Owner-only parameter setters.

```
sherwood governor set-voting-period --seconds <n> [--testnet]
sherwood governor set-execution-window --seconds <n> [--testnet]
sherwood governor set-quorum --bps <n> [--testnet]
sherwood governor set-max-fee --bps <n> [--testnet]
sherwood governor set-max-duration --seconds <n> [--testnet]
sherwood governor set-cooldown --seconds <n> [--testnet]
```

Each validates against hardcoded bounds before submitting.

## Helper Module: `cli/src/lib/governor.ts`

```typescript
// Core functions needed:
export function getGovernorAddress(): Address;
export async function getGovernorParams(): Promise<GovernorParams>;
export async function getProposal(id: bigint): Promise<StrategyProposal>;
export async function getProposalState(id: bigint): Promise<ProposalState>;
export async function propose(...): Promise<{ hash: Hex; proposalId: bigint }>;
export async function vote(proposalId: bigint, support: boolean): Promise<Hex>;
export async function executeProposal(proposalId: bigint): Promise<Hex>;
export async function settleProposal(proposalId: bigint): Promise<Hex>;
export async function settleByAgent(proposalId: bigint, calls: BatchCall[]): Promise<Hex>;
export async function emergencySettle(proposalId: bigint, calls: BatchCall[]): Promise<Hex>;

// State enum mapping
const PROPOSAL_STATES = ["Pending", "Approved", "Rejected", "Expired", "Executed", "Settled", "Cancelled"];

// Duration parsing utility
export function parseDuration(input: string): bigint;
// "7d" → 604800n, "24h" → 86400n, "3600" → 3600n
```

## UX Considerations

- **Duration format:** Accept human-readable durations (`7d`, `24h`, `1h`) in addition to raw seconds
- **Call encoding:** For common protocols (Moonwell supply/borrow, Uniswap swap), provide built-in call builders so agents don't need to manually encode calldata
- **Proposal metadata:** Consider a `sherwood proposal draft` command that helps agents create and pin metadata to IPFS before submitting on-chain
- **Vote weight display:** Show the user's voting power before they vote, so they understand their influence
- **Settlement routing:** Auto-detect the correct settlement path based on caller identity and timing

## Files to Create/Modify

| File | Action |
|------|--------|
| `cli/src/lib/governor.ts` | **Create** — Governor contract wrapper |
| `cli/src/commands/proposal.ts` | **Create** — Proposal command group |
| `cli/src/commands/governor.ts` | **Create** — Governor config commands |
| `cli/src/index.ts` | **Modify** — Register proposal + governor command groups |
| `cli/package.json` | **Modify** — Minor version bump |
| `docs/cli.md` | **Modify** — Add governance commands to user-facing docs |
