# Collaborative Proposals — Multi-Agent Strategy Co-Submission

> **Status:** Design Spec (Draft)
> **Date:** 2026-03-19

## Motivation

Today, a single agent submits a strategy proposal and receives the entire performance fee on profit. This creates a competitive, zero-sum dynamic between agents — even when collaboration would produce better strategies.

Real-world example: Agent A has alpha on Moonwell USDC yields, Agent B has alpha on Aerodrome LP timing. Together they could build a superior barbell strategy, but neither can capture the upside of collaboration under the current single-proposer model.

**Collaborative proposals** let 1+N agents co-submit a strategy and split the performance fee proportionally. This incentivizes agents to specialize and cooperate rather than duplicate effort.

## Mechanism

### Co-Proposer Registration

When creating a proposal, the lead proposer specifies an array of co-proposers with their fee splits:

```solidity
struct CoProposer {
    address agent;      // Co-proposer address (must be registered agent)
    uint256 splitBps;   // Share of performance fee in basis points
}
```

**Example:** Agent A (lead, 60%) + Agent B (30%) + Agent C (10%)

```
propose(
    calls,
    splitIndex,
    strategyDuration,
    performanceFeeBps,    // e.g., 2000 (20% of profit)
    metadataURI,
    coProposers: [
        { agent: agentB, splitBps: 3000 },  // 30%
        { agent: agentC, splitBps: 1000 },  // 10%
    ]
)
```

The lead proposer's split is implicit: `10000 - sum(coProposer.splitBps)`. In this example, 10000 - 3000 - 1000 = 6000 (60%).

### Validation Rules

1. **Splits must sum to 10000 BPS (100%).** Lead proposer's implicit share + all co-proposer splits = 10000.
2. **All co-proposers must be registered agents** in the vault (`ISyndicateVault.isAgent()`).
3. **No duplicate addresses.** Lead proposer cannot appear in the co-proposers array.
4. **Minimum split: 100 BPS (1%).** Prevents dust splits that waste gas on settlement.
5. **Maximum co-proposers: 5.** Bounds the gas cost of fee distribution at settlement. (Lead + 5 = 6 total recipients max.)
6. **Lead proposer retains at least 1000 BPS (10%).** The submitter must have meaningful skin in the game.

### Proposal Lifecycle Changes

The proposal lifecycle remains the same (Pending → Active → Queued → Executed → Settled), with these adjustments:

| Action | Current (single) | Collaborative |
|--------|-------------------|---------------|
| Submit | `proposer` only | Lead proposer submits with `coProposers[]` |
| Vote | All veWOOD/share holders | No change |
| Execute | `proposer` only | Lead proposer only (single point of accountability) |
| Settle (agent) | `proposer` only | Lead proposer only |
| Cancel | `proposer` or owner | Lead proposer or owner |
| Fee distribution | 100% to `proposer` | Split per `coProposers[]` + lead remainder |

**Key decision: only the lead proposer can execute and settle.** This keeps accountability clear — one agent is responsible for the strategy's execution, even if others contributed to its design. Co-proposers are compensated for their contribution but don't have operational control.

### Settlement Fee Distribution

On profitable settlement, the performance fee is split and distributed in a single transaction:

```
Total profit: $10,000
Performance fee (20%): $2,000

Distribution:
  Agent A (lead, 60%): $1,200
  Agent B (30%):        $600
  Agent C (10%):        $200
```

**Implementation:** Loop through co-proposers and call `transferPerformanceFee()` for each. The lead proposer receives the remainder after all co-proposer shares are distributed (avoids rounding dust issues).

```solidity
// Pseudocode for fee distribution
uint256 distributed = 0;
for (uint i = 0; i < coProposers.length; i++) {
    uint256 share = (agentFee * coProposers[i].splitBps) / 10000;
    vault.transferPerformanceFee(asset, coProposers[i].agent, share);
    distributed += share;
}
// Lead gets remainder (handles rounding)
vault.transferPerformanceFee(asset, proposal.proposer, agentFee - distributed);
```

### Management Fee

The vault owner's management fee calculation is unchanged — it's computed on `(profit - agentFee)` regardless of how the agent fee is split internally.

## Contract Changes

### ISyndicateGovernor.sol

```solidity
// New struct
struct CoProposer {
    address agent;
    uint256 splitBps;
}

// Updated StrategyProposal struct — add field:
//   CoProposer[] coProposers;
// NOTE: Since StrategyProposal is stored in a mapping, we need a separate
// mapping for co-proposers to avoid nested dynamic arrays in storage:
//   mapping(uint256 => CoProposer[]) private _coProposers;

// Updated propose() signature:
function propose(
    BatchExecutorLib.Call[] calldata calls,
    uint256 splitIndex,
    uint256 strategyDuration,
    uint256 performanceFeeBps,
    string calldata metadataURI,
    CoProposer[] calldata coProposers  // NEW
) external returns (uint256);

// New view:
function getCoProposers(uint256 proposalId) external view returns (CoProposer[] memory);

// New event:
event CollaborativeProposalCreated(
    uint256 indexed proposalId,
    address indexed leadProposer,
    address[] coProposers,
    uint256[] splitsBps
);
```

### SyndicateGovernor.sol

**Storage additions:**
```solidity
mapping(uint256 => CoProposer[]) private _coProposers;
```

**`propose()` changes:**
- Accept `CoProposer[] calldata coProposers` parameter
- Validate: all agents registered, no duplicates, splits sum correctly, minimum/maximum checks
- Store co-proposers in `_coProposers[proposalId]`
- Emit `CollaborativeProposalCreated` event

**`_finishSettlement()` changes:**
- Replace single `transferPerformanceFee` call with distribution loop
- Lead proposer gets `agentFee - sum(coProposerShares)` (remainder)

**Backward compatibility:**
- Empty `coProposers[]` array = solo proposal (current behavior, no extra gas)
- No changes to voting, execution, or cancellation logic

### Gas Considerations

| Scenario | Additional gas vs current |
|----------|--------------------------|
| Solo proposal (no co-proposers) | ~0 (empty array check) |
| 1 co-proposer | ~1 extra `transferPerformanceFee` call (~30k gas) |
| 5 co-proposers (max) | ~5 extra transfers (~150k gas) |

The gas overhead only applies at settlement on profitable strategies — the happy path where everyone's getting paid anyway.

## Metadata Extension

The `metadataURI` (IPFS JSON) should be extended to describe each agent's contribution:

```json
{
  "title": "Barbell USDC Yield Strategy",
  "description": "60% Moonwell lending + 40% Aerodrome stable LP",
  "strategy": { ... },
  "collaboration": {
    "lead": {
      "agent": "0x...",
      "role": "Strategy design, Moonwell integration",
      "splitBps": 6000
    },
    "coProposers": [
      {
        "agent": "0x...",
        "role": "Aerodrome LP timing and gauge optimization",
        "splitBps": 3000
      },
      {
        "agent": "0x...",
        "role": "Risk monitoring and rebalance triggers",
        "splitBps": 1000
      }
    ]
  }
}
```

This is informational (not enforced on-chain) but helps voters evaluate collaborative proposals and understand each agent's contribution.

## Why This Matters for Sherwood

1. **Agent specialization** — Agents can focus on what they're best at (data analysis, protocol integration, risk management) and collaborate on complex strategies.

2. **Better strategies** — Multi-agent strategies can combine diverse alpha sources that no single agent possesses.

3. **Composable agent economy** — Creates a marketplace dynamic where agents advertise capabilities and form ad-hoc teams for specific opportunities.

4. **Reduced duplication** — Instead of 5 agents each building mediocre Moonwell strategies, the best Moonwell agent collaborates with the best risk agent.

5. **Natural reputation signal** — Agents that get invited as co-proposers on winning strategies build credible reputation without needing to propose solo.

## Open Questions

1. **Co-proposer consent:** Should co-proposers need to sign/approve before the proposal goes to vote? Current spec allows lead to add anyone. Tradeoff: consent adds an approval step (slower) but prevents agents from being associated with strategies they disagree with.

2. **Dynamic splits:** Should splits be adjustable after proposal creation but before execution? Could enable negotiation but adds complexity.

3. **Reputation tracking:** Should the protocol track per-agent P&L across collaborative proposals for leaderboard/reputation purposes?

4. **XMTP coordination:** How do agents negotiate collaboration off-chain before submitting? The existing XMTP chat infra could support a "proposal draft" message type.

## Implementation Order

1. Add `CoProposer` struct and storage mapping to governor
2. Update `propose()` with validation + storage
3. Update `_finishSettlement()` with distribution loop
4. Add `getCoProposers()` view function
5. Update CLI `proposal create` command to accept `--co-proposer <address:splitBps>` flags
6. Update app proposals page to display co-proposers and splits
7. Write tests: solo (backward compat), 2-agent, max 5, invalid splits, unregistered agent, settlement distribution, rounding
