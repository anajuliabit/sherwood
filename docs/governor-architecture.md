# SyndicateGovernor — Architecture

## Overview

A governance system where agents propose strategies, vault shareholders vote, and approved agents execute within mandated parameters — earning performance fees on profits.

**One-liner:** Agents pitch trade plans. Shareholders vote. Winners execute and earn carry.

**Multi-vault:** A single governor manages multiple vaults. Proposals target a specific vault. Only shareholders of that vault vote on its proposals.

---

## The Flow

```
1. Agent submits proposal
   "I'm a DeFi expert. I propose borrowing 5,000 USDC against the vault's WETH
    collateral on Moonwell. Health factor will be 2.1 (safe). I'll deploy
    the borrowed USDC into Uniswap WETH/USDC LP. Expected APY: 12%.
    My performance fee: 15% of profits."

2. Shareholders vote YES/NO (weighted by vault shares)

3. If quorum + majority → Approved

4. Agent executes within the mandate
   - Uses the vault's entire available balance
   - Can only call the approved target contracts
   - Must execute within the execution window

5. On settlement (anyone can call once strategy duration ends)
   - Vault runs pre-committed unwind calls
   - Profit = (position value at close) - (capital used)
   - Performance fee paid to agent
   - Remaining profit accrues to vault (all shareholders)
   - PnL attestation minted on-chain (EAS)

6. Cooldown window begins
   - Redemptions re-enabled — depositors can withdraw
   - No new strategy can execute until cooldown expires
```

---

## Proposal Struct

```solidity
struct StrategyProposal {
    uint256 id;
    address proposer;              // agent address (must be registered in vault)
    string metadataURI;            // IPFS: full rationale, research, risk analysis
    uint256 performanceFeeBps;     // agent's cut of profits (e.g. 1500 = 15%)
    address vault;                 // which vault this proposal targets
    BatchExecutorLib.Call[] calls; // full lifecycle: open + close position
    uint256 splitIndex;            // calls[0..splitIndex-1] = execute, calls[splitIndex..] = settle
    uint256 strategyDuration;      // how long the position runs (seconds), capped by maxStrategyDuration
    uint256 votesFor;              // share-weighted votes in favor
    uint256 votesAgainst;          // share-weighted votes against
    uint256 snapshotTimestamp;     // block.timestamp at creation (for vote weight snapshot)
    uint256 voteEnd;               // snapshotTimestamp + votingPeriod
    uint256 executeBy;             // voteEnd + executionWindow
    ProposalState state;           // Pending → Active → Approved → Executed → Settled
                                   // (or Rejected / Expired / Cancelled)
}
```

### Calls are committed at proposal time, not execution time

The exact `calls[]` (target, data, value) are part of the proposal. Shareholders vote on the precise on-chain actions that will be executed — not a vague description. At execution time, `executeProposal(proposalId)` takes **no arguments** — it replays the pre-approved calls. The agent cannot change what gets executed after the vote.

This means:
- Shareholders can inspect every calldata byte before voting
- The metadataURI provides human-readable context ("borrow 5k USDC from Moonwell")
- The calls[] provide machine-verifiable truth (the actual encoded function calls)
- No bait-and-switch possible

### Who controls what

| Parameter | Controlled by | Notes |
|-----------|--------------|-------|
| vault | Agent (proposer) | Which vault this proposal targets |
| calls | Agent (proposer) | Full lifecycle calls (open + close) — committed at proposal time |
| splitIndex | Agent (proposer) | Where execute ends and settle begins in the calls array |
| performanceFeeBps | Agent (proposer) | Their fee, capped by maxPerformanceFeeBps |
| strategyDuration | Agent (proposer) | How long the position runs, capped by maxStrategyDuration |
| metadataURI | Agent (proposer) | IPFS link to full strategy rationale |
| votingPeriod | Governor (owner setter) | How long voting lasts |
| executionWindow | Governor (owner setter) | Time after approval to execute |
| quorumBps | Governor (owner setter) | Min participation (% of total shares) |
| maxPerformanceFeeBps | Governor (owner setter) | Cap on agent fees |
| maxStrategyDuration | Governor (owner setter) | Cap on how long a strategy can run (e.g. 90 days) |
| cooldownPeriod | Governor (owner setter) | Withdrawal window between strategies |

---

## Voting

- **Voting power = shares of the target vault** (ERC-4626 balanceOf on `proposal.vault`)
- Only shareholders of the target vault can vote — your money, your decision
- Snapshot at proposal creation (block.timestamp) to prevent flash-loan manipulation
- 1 address = 1 vote per proposal (weighted by shares at snapshot)
- Simple majority: votesFor > votesAgainst (if quorum met)
- Quorum = minimum % of target vault's total supply that must participate

---

## Agent Registration & Depositor Access

**Proposing requires registration.** Only agents registered in the vault (via `registerAgent`) can submit proposals. Registration requires an ERC-8004 identity NFT, verified on-chain. This is the gate for strategy creation.

**Depositing is open.** Anyone can deposit into the vault — no registration, no identity check. Standard ERC-4626 `deposit()` / `mint()`.

Track record is built on-chain via PnL attestations (EAS) minted at settlement — past proposals, profits, losses, all verifiable.

---

## Proposal States

```
              ┌─────────┐
              │ Pending  │  (created, voting not started — or voting active)
              └────┬─────┘
                   │ votingPeriod expires
          ┌────────┼────────┐
          ▼        │        ▼
    ┌──────────┐   │  ┌──────────┐
    │ Approved │   │  │ Rejected │  (votesAgainst >= votesFor, or quorum not met)
    └────┬─────┘   │  └──────────┘
         │         │
         │         ▼
         │   ┌──────────┐
         │   │ Expired  │  (execution window passed without execution)
         │   └──────────┘
         ▼
   ┌──────────┐
   │ Executed │  (agent called executeProposal within window)
   └────┬─────┘
        │
        ▼
   ┌──────────┐
   │ Settled  │  (P&L calculated, fee distributed, attestation minted)
   └──────────┘
        │
        ▼
   ┌──────────┐
   │ Cooldown │  (vault: redemptions open, no new executions)
   └──────────┘

   At any point before settlement:
   - Proposer can Cancel their own proposal
   - Owner can Emergency Cancel any proposal
```

---

## Mandate Execution

When a proposal is approved, the pre-committed calls are executed directly by the vault:

1. Anyone calls `executeProposal(proposalId)` on the governor (no arguments beyond the ID)
2. Governor verifies: proposal is Approved, within execution window, no other strategy live, cooldown elapsed
3. Governor calls `vault.lockRedemptions()` — blocks withdraw/redeem
4. Governor snapshots vault's deposit asset balance (`capitalSnapshot`)
5. Governor calls `vault.executeBatch(proposal.calls[0..splitIndex-1])` — vault runs the execution calls
6. All DeFi positions (mTokens, LP tokens, borrows) now live on the vault address

**No new input from the agent at execution time.** The calls were locked in at proposal creation and voted on by shareholders. Execution is just replaying what was approved.

**Redemption lock:** When a strategy is live (Executed state), vault redemptions (`withdraw` / `redeem`) are blocked. Depositors who want to exit early can sell their shares on the WOOD/SHARES liquidity pool (see Early Exit below).

---

## Strategy Duration & Settlement

Two separate clocks:

1. **Execution deadline** — time to *start* executing after approval (`executionWindow`, governor-controlled)
2. **Strategy duration** — time the position *runs* before settlement (`strategyDuration`, agent-proposed, capped by `maxStrategyDuration`)

```
|-- voting --|-- exec window --|------ strategy duration ------|-- cooldown --|
   propose      execute calls      position is live     settlement    withdrawals open
                                                                      (no new strategies)
```

### Who can settle and when

| Who | When | Use case |
|-----|------|----------|
| Agent (proposer) | Anytime after execution | Early close — agent decides position has run its course |
| Anyone (permissionless) | After strategy duration ends | Public good — no one needs to trust the agent to settle |
| Owner | Anytime (emergency) | Force-close or emergency |

Once `strategyDuration` has elapsed, **anyone** can call `settleProposal(proposalId)`. This is permissionless because settlement just runs the pre-committed unwind calls and returns assets to the vault — there's no trust required. If the agent disappears, any keeper, depositor, or bot can trigger settlement.

### Cooldown Window

After settlement, a **cooldown period** begins before any new strategy can execute on that vault.

- Duration: `cooldownPeriod` (governor parameter, owner-controlled)
- During cooldown: redemptions are re-enabled, depositors can withdraw
- During cooldown: proposals can still be submitted and voted on, but `executeProposal` reverts
- Purpose: gives depositors an exit window between strategies — if they don't like the next approved proposal, they can leave

**Safety bounds:** `cooldownPeriod`: min 1 hour, max 30 days

### P&L Calculation — Balance Snapshot

Since only one strategy runs per vault at a time, P&L is calculated via a simple balance snapshot:

```
Execute:
  1. Governor snapshots vault's deposit asset balance → capitalSnapshot
  2. Vault executes the pre-approved calls[0..splitIndex-1]
     (positions now live on the vault address)

During strategy:
  - Position is live on the vault (e.g. mTokens, LP tokens, borrowed assets)
  - Agent cannot interact with vault directly — only governor can trigger calls
  - Redemptions are locked

Settle:
  1. Vault executes the pre-approved calls[splitIndex..] (unwind)
  2. P&L = vault.depositAssetBalance() - capitalSnapshot
  3. If P&L > 0: fee = P&L * performanceFeeBps / 10000, transferred to proposer
  4. If P&L ≤ 0: no fee, loss is socialized across shareholders
  5. Redemptions unlocked, cooldown starts
  6. Proposal state → Settled
```

#### Who can trigger settlement

| Who | When |
|-----|------|
| Proposer (agent) | Anytime after execution — early close |
| Anyone | After `strategyDuration` expires — permissionless |
| Owner | Anytime — emergency |

Settlement is safe to make permissionless because it runs the pre-committed unwind calls (voted on by shareholders). No arbitrary input.

**If unwind calls revert:** Owner can emergency-settle with custom unwind calls. The pre-committed calls may fail due to stale slippage, changed pool state, etc. — the owner provides replacement calls that achieve the same goal (close positions, return deposit asset to vault) but with params that work given current market conditions. The vault must end up holding its deposit asset after emergency settlement — positions cannot be left open.

#### PnL Attestation

At settlement, the governor mints an **EAS attestation** recording the proposal's PnL:

```solidity
// Schema: STRATEGY_PNL
struct StrategyPnLAttestation {
    uint256 proposalId;
    address vault;
    address agent;
    int256 pnl;              // profit or loss in deposit asset terms
    uint256 capitalSnapshot;  // vault balance at execution time
    uint256 assetsReturned;
    uint256 performanceFee;
    uint256 duration;         // actual duration (execute → settle)
}
```

This creates an immutable on-chain track record for every agent. Anyone can query an agent's history of profits and losses before voting on their proposals. No separate reputation system needed — the attestations are the reputation.

#### Manager Action Attestation

When the vault owner intervenes (emergency settle or manual token recovery), a separate **EAS attestation** is minted to build the owner's track record as a responsible manager:

```solidity
// Schema: MANAGER_ACTION
struct ManagerActionAttestation {
    address vault;
    address manager;            // vault owner
    uint256 proposalId;         // related proposal (0 if manual recovery)
    string actionType;          // "EMERGENCY_SETTLE" or "TOKEN_RECOVERY"
    uint256 assetsRecovered;    // deposit asset returned to vault
    uint256 timestamp;
}
```

This lets depositors evaluate a vault owner's management history before depositing — how often they had to intervene, how much they recovered, and how quickly they acted.

#### Full lifecycle in calls[]

The proposal's `calls[]` must include the **complete strategy lifecycle** — both opening AND closing the position. The agent commits everything upfront:

```
Example calls[] for a Moonwell borrow + Uniswap swap strategy:

1. approve WETH to Moonwell           ← open position
2. supply WETH as collateral           
3. borrow USDC                         
4. approve USDC to Uniswap            
5. swap USDC → target token           
   ... (strategy duration passes) ...
6. swap target token → USDC           ← close position
7. repay USDC borrow                   
8. redeem WETH collateral              
9. swap WETH → USDC (if needed)       ← convert everything back to deposit asset
```

Shareholders vote on the entire sequence. They can inspect every step — open and close.

**Execution is split into two phases, both using the pre-committed calls:**

1. `executeProposal(proposalId)` — runs calls 1-5 (the opening portion, up to a split index)
2. `settleProposal(proposalId)` — runs calls 6-9 (the closing portion)

The proposal includes a `splitIndex` — which call starts the unwind:

```solidity
struct StrategyProposal {
    ...
    BatchExecutorLib.Call[] calls;  // full lifecycle: open + close
    uint256 splitIndex;             // calls[0..splitIndex-1] = execute, calls[splitIndex..] = settle
    ...
}
```

**Settlement should return to deposit asset.** After the unwind calls execute, the vault should hold the deposit asset (e.g. USDC) again. If non-deposit-asset tokens remain on the vault after settlement (something went wrong), the owner can manually handle them via `executeBatch` (owner-only). When the owner manually recovers stuck tokens, a **manager action attestation** (EAS) is minted — proving the owner intervened responsibly to protect depositor funds.

**Stale parameters:** Since unwind calls are committed at proposal time, params like slippage tolerance and exact repayment amounts may be stale by settlement time. Agents should use generous slippage tolerances in their unwind calls. If unwind calls revert due to stale params, the owner can call `emergencySettle(proposalId, calls[])` with replacement unwind calls that work with current market conditions. A **manager action attestation** (EAS) is minted on emergency settle — proving the owner acted to close positions and return assets to depositors.

---

## Early Exit — WOOD/SHARES Liquidity Pools

**Problem:** When a strategy is live, vault redemptions are blocked. Depositors need a way to exit.

**Solution:** One-sided liquidity pools pairing WOOD (protocol token) with each vault's share token.

### How it works

1. Protocol seeds a **WOOD/SHARES** pool for each vault (e.g. WOOD/synUSDC-shares)
2. When a strategy is live and redemptions are locked, depositors can sell their vault shares into the pool
3. Buyers get discounted exposure to the vault's strategy outcome
4. The pool price reflects the market's real-time sentiment on the active strategy

### Pool mechanics

- Pool type: Uniswap V3 concentrated liquidity (or V4 hook)
- Pair: WOOD (protocol token) ↔ Vault shares (ERC-20, the ERC-4626 share token)
- One-sided seeding: protocol provides WOOD liquidity; share side comes from depositors selling
- WOOD acts as the quote currency across all vault share pools

### Why WOOD

- Creates utility and demand for the protocol token
- Every vault share pool is denominated in WOOD → unified liquidity layer
- Depositors who exit early effectively swap into WOOD (they can hold it or sell for stables)
- Creates a natural price discovery mechanism for vault shares during strategy execution

### Lifecycle

```
Strategy NOT live:  Depositors can redeem normally via vault (ERC-4626 withdraw/redeem)
                    Pool exists but no urgency to use it

Strategy IS live:   Vault redemptions blocked
                    Depositors who want out → sell shares in WOOD/SHARES pool
                    Price may trade at discount (reflects locked capital risk)

Cooldown window:    Vault redemptions re-enabled
                    Depositors can redeem normally OR sell in pool
```

---

## Single Strategy Per Vault

Only **one strategy can be live (Executed state) per vault at a time.** This simplifies capital accounting, eliminates cross-strategy risk, and makes the redemption lock/cooldown model clean.

- Governor tracks `activeProposal[vault]` — the currently executing proposal ID (0 if none)
- `executeProposal` reverts if `activeProposal[vault] != 0`
- `executeProposal` also reverts if the vault is in its cooldown window
- Multiple proposals can be in Pending/Approved state simultaneously — they queue up
- Only one can be executed at a time

## Open Design Questions

---

### 3. Strategy Carry Model

From the Notion: *"Strategies are free to use. Strategy creators earn a cut of protocol fee on all TVL running their strategy."*

Two possible models:

**A. Per-proposal performance fee (current design)**
- Agent sets fee when proposing
- Fee paid on settlement from profits only
- Simple, clear, hackathon-ready

**B. Protocol-level revenue share (v2)**
- Strategy creators earn ongoing % of all TVL running their strategy
- More DeFi-native (like Uniswap LP fees)
- Needs StrategyRegistry integration, TVL tracking, streaming payments

**Recommendation:** Model A for hackathon. Model B is the long-term vision.

---

### 4. What Happens if a Strategy Loses Money?

- Agent earns nothing (performance fee only applies to profits)
- Loss is socialized across all shareholders (standard fund behavior)
- Agent's reputation takes a hit (EAS attestation records the loss)
- No slashing mechanism in v1

**Future consideration:** Agent bonds / slashing for repeated losses.

---

### 5. Can Agents Update a Live Proposal?

No. Once submitted, proposal params are immutable. If an agent wants different terms, they cancel and create a new proposal. Keeps voting clean — shareholders know exactly what they're voting on.

---

## Contract Architecture

```
                         ┌──────────────────────┐
                    ┌───▶│   SyndicateVault A    │──▶ BatchExecutorLib
                    │    │   (ERC-4626 proxy)    │
┌──────────────────┐│    └──────────────────────┘
│ SyndicateGovernor ├┤
│  (UUPS proxy)    ││    ┌──────────────────────┐
│                  │├───▶│   SyndicateVault B    │──▶ BatchExecutorLib
│  - proposals     ││    │   (ERC-4626 proxy)    │
│  - voting        ││    └──────────────────────┘
│  - parameters    ││
│  - vault registry│└───▶│   SyndicateVault N    │──▶ ...
└──────────────────┘     └──────────────────────┘
```

One governor manages multiple vaults. Each vault sets the governor as its trusted governance contract. Proposals target a specific vault. Only that vault's shareholders vote.

**Vault management is owner-controlled** — owner adds/removes vaults via `addVault` / `removeVault`. This is consistent with parameters being owner-controlled (global settings that affect all vaults).

---

## Required Changes

### New Contracts

#### 1. ISyndicateGovernor.sol (new file)

Full interface: structs (`StrategyProposal`, `ProposalState` enum), all errors, events, and function signatures.

#### 2. SyndicateGovernor.sol (new file)

UUPS upgradeable. Holds all governance logic.

**Storage:**
- `proposals` mapping (uint256 → StrategyProposal)
- `proposalCount` counter
- `hasVoted` mapping (proposalId → address → bool)
- `snapshotBalances` mapping (proposalId → address → uint256) for vote weight snapshots
- `capitalSnapshot` mapping (proposalId → uint256) — vault balance at execution time
- `activeProposal` mapping (vault address → uint256) — currently executing proposal (0 if none)
- `lastSettledAt` mapping (vault address → uint256) — timestamp of last settlement (for cooldown enforcement)
- `registeredVaults` — EnumerableSet of vault addresses the governor manages
- Governor parameters: `votingPeriod`, `executionWindow`, `quorumBps`, `maxPerformanceFeeBps`, `maxStrategyDuration`, `cooldownPeriod`

**Functions:**
- `initialize(owner, votingPeriod, executionWindow, quorumBps, maxPerformanceFeeBps, maxStrategyDuration, cooldownPeriod)`
- `addVault(address vault)` — governance proposal (or owner during bootstrap)
- `removeVault(address vault)` — governance proposal
- `propose(vault, metadataURI, performanceFeeBps, strategyDuration, calls[], splitIndex)` → returns proposalId
  - Vault must be registered in governor
  - Caller must be a registered agent in the vault (ERC-8004 identity verified at registration)
  - `performanceFeeBps ≤ maxPerformanceFeeBps`
  - `strategyDuration ≤ maxStrategyDuration`
  - `splitIndex > 0 && splitIndex < calls.length` (must have both execution and settlement actions)
  - Snapshots all current shareholder balances (or uses a checkpoint pattern)
- `vote(proposalId, support)` — support = true (FOR) / false (AGAINST)
  - Must be within voting period
  - Voter must have had shares at snapshot time
  - Cannot vote twice
  - Weight = share balance at snapshot
- `executeProposal(proposalId)` — permissionless, no arguments beyond ID
  - Proposal must be Approved (voting ended, quorum met, majority FOR)
  - Must be within execution window
  - `activeProposal[vault] == 0` — no other strategy currently live
  - Cooldown must have elapsed: `block.timestamp >= lastSettledAt[vault] + cooldownPeriod`
  - Calls `vault.lockRedemptions()` — blocks withdraw/redeem on the vault
  - Snapshots vault's deposit asset balance → `capitalSnapshot[proposalId]`
  - Calls `vault.executeBatch(proposal.calls[0..splitIndex-1])` — vault runs the execution calls
  - Sets `activeProposal[vault] = proposalId`
  - Updates `proposal.state = Executed`, records `executedAt`
- `settleProposal(proposalId)`
  - If caller is proposer: anytime after execution (early close)
  - If caller is anyone: after `strategyDuration` has elapsed (permissionless)
  - If caller is owner: anytime (emergency)
  - Calls `vault.executeBatch(proposal.calls[splitIndex..])` — runs the pre-committed unwind calls
  - Calculates P&L = vault.depositAssetBalance() - capitalSnapshot[proposalId]
  - If P&L > 0: transfers performance fee (P&L * performanceFeeBps / 10000) to proposer
  - Calls `vault.unlockRedemptions()` — re-enables withdraw/redeem
  - Sets `activeProposal[vault] = 0`
  - Sets `lastSettledAt[vault] = block.timestamp` — starts cooldown
  - Mints EAS PnL attestation (see PnL Attestation section)
- `cancelProposal(proposalId)` — proposer can cancel before voting ends
- `emergencyCancel(proposalId)` — owner can cancel anytime before settlement
- `emergencySettle(proposalId, calls[])` — onlyOwner, runs owner-provided unwind calls instead of pre-committed ones
  - For when pre-committed unwind calls revert due to stale params or market conditions
  - Owner provides replacement calls that close the positions and return deposit asset to vault
  - Still unlocks redemptions, clears active proposal, starts cooldown
  - Still mints PnL attestation (with actual returned amount)
- **Setters** (onlyOwner): `setVotingPeriod`, `setExecutionWindow`, `setQuorumBps`, `setMaxPerformanceFeeBps`, `setMaxStrategyDuration`, `setCooldownPeriod`, `addVault`, `removeVault`
- **Views**: `getProposal`, `getProposalState`, `getVoteWeight`, `hasVoted`, `proposalCount`, `getGovernorParams`, `getRegisteredVaults`, `getActiveProposal`, `getCooldownEnd`

#### Why parameters are owner-controlled (not self-governed)

Governor parameters (votingPeriod, quorumBps, etc.) are **global** — they affect all vaults. But voting power is **per-vault** (only target vault shareholders vote). There's no fair way to decide which vault's shareholders get to change global settings. So parameters stay owner-controlled.

Shareholders govern **what happens with their money** (strategy proposals). The owner governs **the rules of the game** (governor parameters, vault registry).

**Safety bounds** (hardcoded, owner cannot exceed):
- `votingPeriod`: min 1 hour, max 30 days
- `executionWindow`: min 1 hour, max 7 days
- `quorumBps`: min 1000 (10%), max 10000 (100%)
- `maxPerformanceFeeBps`: min 0, max 5000 (50%)
- `maxStrategyDuration`: min 1 hour, max 365 days
- `cooldownPeriod`: min 1 hour, max 30 days

**Emergency powers** (onlyOwner):
- `emergencyCancel(proposalId)` — cancel any proposal before settlement
- `emergencySettle(proposalId, calls[])` — force-settle with custom unwind calls (positions must be closed)
- Parameter setters — change governor settings within safety bounds
- `addVault` / `removeVault` — manage vault registry

### Existing Contract Changes

#### SyndicateVault.sol (modifications)

**New storage slots** (appended — UUPS safe):
- `address private _governor` — trusted governor contract
- `bool private _redemptionsLocked` — true when a strategy is live

**New functions:**
- `setGovernor(address governor_)` — onlyOwner, sets trusted governor address
- `lockRedemptions()` — onlyGovernor, sets `_redemptionsLocked = true`
- `unlockRedemptions()` — onlyGovernor, sets `_redemptionsLocked = false`

**Modified functions:**
- `withdraw` / `redeem` — revert with `RedemptionsLocked()` when `_redemptionsLocked == true`
- `deposit` / `mint` — **unchanged**, anyone can deposit at any time (even during a live strategy)
- `executeBatch` — restricted to onlyGovernor (for strategy calls) or onlyOwner (for manual vault management)

**Kept functions (unchanged):**
- `registerAgent` / `removeAgent` — still needed. Only registered agents can propose via the governor.

**New modifier:**
- `onlyGovernor` — `require(msg.sender == _governor)`

**New events:**
- `GovernorUpdated(address indexed oldGovernor, address indexed newGovernor)`
- `RedemptionsLocked()`
- `RedemptionsUnlocked()`

#### SyndicateFactory.sol (modifications)

Since the governor is a singleton managing multiple vaults, the factory doesn't deploy a governor. Instead:

1. Governor is deployed once (separate from factory)
2. Factory's `createSyndicate()` accepts an optional `governor` address in config
3. If provided, factory calls `vault.setGovernor(governor)` after deployment
4. Governor's `addVault()` is called separately (governance proposal, or owner during bootstrap)

```solidity
// Added to SyndicateConfig:
address governor;  // optional — address(0) means no governor
```

### New Tests

#### 3. SyndicateGovernor.t.sol (new file)

Full test suite:
- **Lifecycle:** propose → vote → approve → execute → settle (happy path)
- **Rejection:** votes against > votes for
- **Quorum:** not met → proposal cannot be executed
- **Expiry:** execution window passes → Expired
- **Snapshot:** buying shares after proposal doesn't increase vote weight
- **Double vote:** same address cannot vote twice
- **Registration gate:** only registered agents can propose, unregistered rejected
- **Open deposits:** anyone can deposit without registration
- **Performance fee:** correct calculation and distribution on profit
- **No fee on loss:** zero fee when strategy loses money
- **Single strategy:** execution reverts when another strategy is live
- **Redemption lock:** withdraw/redeem revert during live strategy
- **Cooldown enforcement:** execution reverts during cooldown window
- **Settlement timing:** agent can settle early, anyone after duration, owner anytime
- **Permissionless settlement:** random address can settle after duration ends
- **PnL attestation:** EAS attestation minted at settlement with correct data
- **Cancel:** proposer cancels, owner emergency cancels
- **Parameter setters:** only owner, values validated
- **Fuzz:** voting weights, fee calculations, capital limits

#### 4. Existing tests — MAY NEED UPDATES

Some existing vault tests will need updates for the new redemption lock behavior:
- Deposit tests → should still pass unchanged (deposits always open)
- Withdraw/redeem/ragequit tests → add cases for `RedemptionsLocked` revert during live strategy
- `registerAgent` / `removeAgent` tests → keep, still used
- `executeBatch` by agents → review, may restrict to owner-only

### CLI Changes

#### 7. CLI commands (new)

- `sherwood proposal create --fee 1500 --duration 7d --metadata ipfs://... --calls <encoded>`
- `sherwood proposal list [--state active|approved|executed]`
- `sherwood proposal show <id>` — full detail including decoded calls
- `sherwood proposal vote --id 1 --support yes|no`
- `sherwood proposal execute --id 1`
- `sherwood proposal settle --id 1`
- `sherwood governor set-voting-period --seconds 3600`
- `sherwood governor set-execution-window --seconds 86400`
- `sherwood governor set-quorum --bps 4000`
- `sherwood governor info` — current parameters

### Subgraph Changes

#### 8. Subgraph entities (new)

- `Proposal` entity: all proposal fields, state, votes
- `Vote` entity: voter, proposalId, support, weight
- `ProposalExecution` entity: proposalId, timestamp, txHash
- `ProposalSettlement` entity: proposalId, pnl, performanceFee

- `PnLAttestation` entity: proposalId, agent, vault, pnl, capitalSnapshot, assetsReturned, attestationUID

Event handlers for: `ProposalCreated`, `VoteCast`, `ProposalExecuted`, `ProposalSettled`, `ProposalCancelled`, `PnLAttestationCreated`

### Dashboard Changes

#### 9. Dashboard pages (new/updated)

- **Proposals page** — list active/past proposals with vote status, call decoding
- **Proposal detail** — full rationale (IPFS metadata), vote breakdown, execution status, P&L
- **Vote UI** — connect wallet, vote for/against
- **Syndicate page** — add active proposals section, capital allocation breakdown
