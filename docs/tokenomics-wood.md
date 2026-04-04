# WOOD Token Incentive Program — ve(3,3) for Syndicates

> **Status:** Design Spec (v3 — Final)
> **Author:** Ally (AI CEO)
> **Date:** 2026-03-18
> **Revised:** 2026-03-26 (economic simulation, bribe layer, regulatory, parameter updates, liquid WOOD allocations, fees to treasury)

## Overview

A vote-escrow tokenomics system inspired by Aerodrome/Velodrome's ve(3,3) model, adapted for Sherwood syndicates. Users lock WOOD tokens to vote for syndicates they want to incentivize. Epoch rewards (WOOD emissions) flow to voted syndicates and are streamed into each syndicate vault's rewards buffer for vault depositors/strategies. Vote incentives (bribes) flow back to voters. Trading fees from `shareToken/WOOD` pools are retained by the protocol to fund new pool seeding.

## Tokens

| Token | Standard | Purpose |
|-------|----------|---------|
| `$WOOD` | ERC-20 (LayerZero OFT) | Utility token — emitted as rewards, traded, locked for governance. Natively bridgeable to any LZ-supported chain. |
| `$veWOOD` | ERC-721 (veNFT) | Governance NFT — represents locked WOOD with time-weighted voting power |

## Core Mechanism

```
                    ┌─────────────────────────────┐
                    │    WOOD Emissions (Minter)   │
                    │    each epoch (7 days)        │
                    └──────────┬──────────────────┘
                               │
                    proportional to veWOOD votes
                               │
                    ┌──────────▼──────────────────┐
                    │   Syndicate Gauges           │
                    │   (one per syndicate)         │
                    └──────┬────────────┬─────────┘
                           │            │
              90-100% to vault    0-10% to LPs
              rewards buffer     (weeks 1-12 only)
                           │            │
                    ┌──────▼────────────▼─────────┐
                    │   Vault Depositors / LPs      │
                    │   (WOOD claims on-chain)       │
                    └──────────────────────────────┘

    Meanwhile:

    ┌─────────────────────┐    ┌─────────────────────┐
    │ Uniswap V3 LP Fees  │    │  Vote Incentives     │
    │ (shareToken/WOOD)    │    │  (bribes, any ERC-20)│
    └─────────┬───────────┘    └─────────┬───────────┘
              │                          │
              ▼                          ▼
    ┌─────────────────────┐    ┌─────────────────────┐
    │  Protocol Treasury   │    │   veWOOD Voters      │
    │  (seeds new pools)   │    │   (pro-rata to votes)│
    └─────────────────────┘    └─────────────────────┘
```

## The Flywheel

```
Lock WOOD → veWOOD → vote for syndicates
       ↓
Voted syndicates get WOOD emissions → streamed to vault rewards buffer
       ↓
Vault depositors claim WOOD on-chain (pro-rata via ERC20Votes checkpoints)
       ↓
More vault TVL + strategy activity → higher shareToken utility and trading
       ↓
LPs earn swap fees + bootstrapping emissions (weeks 1-12)
       ↓
Trading fees → protocol treasury (seeds new syndicate pools)
       ↓
Vote incentives (bribes) → veWOOD voters who voted for that syndicate
       ↓
Higher voter + depositor yield → more people lock WOOD / deposit into vaults
       ↓
Agents bribe voters to attract emissions → additional voter yield
       ↓
WOOD price ↑ → emissions more valuable → more votes/deposits → repeat
```

## Detailed Design

### 1. Vote-Escrow Locking (VotingEscrow.sol)

Users lock WOOD for a chosen duration (4 weeks — 1 year) and receive a veWOOD NFT.

**Voting power scales linearly with lock duration:**
- 100 WOOD locked 1 year → 100 veWOOD voting power
- 100 WOOD locked 6 months → 50 veWOOD voting power
- 100 WOOD locked 4 weeks → ~7.69 veWOOD voting power

**Minimum lock: 4 weeks.** Shorter locks (e.g., 1 week) allow mercenary capital to farm epoch boundaries with minimal commitment. A 4-week minimum ensures voters have meaningful skin in the game while remaining accessible. (Validated via simulation — see `docs/wood-simulation.ts`.)

**Voting power decays linearly** as the lock approaches expiry, incentivizing longer locks.

**Auto-Max Lock:** Optional flag per veNFT — treated as 1-year lock with no decay. Can be toggled on/off.

**Additional deposits:** Users can add more WOOD to an existing veNFT at any time.

**Lock extension:** Users can extend their lock duration (but never decrease it).

**Why 1 year (not 4)?** Aerodrome uses a 4-year maximum lock. Sherwood consciously chose 1 year for three reasons: (1) faster capital rotation — syndicate strategies have shorter time horizons than DEX liquidity mining, (2) lower commitment barrier — governance participation should be accessible, not require 4-year vesting-equivalent conviction, and (3) alignment with the 1-year emission schedule — the bootstrapping period and the maximum lock expire together, giving early participants a clear exit window while preventing long-tail mercenary dynamics.

### 2. Epoch Voting (Voter.sol)

**Epoch:** 7-day period, Thursday 00:00 UTC → Wednesday 23:59 UTC.

Each epoch, veWOOD holders allocate their voting power across one or more syndicates:
- A veNFT can split votes across multiple syndicates (e.g., 60% Syndicate A, 40% Syndicate B)
- Votes are cast once per epoch — changing votes resets the allocation
- Voting power is snapshot at vote time (decaying veWOOD balance)
- **Minimum quorum:** At least 10% of total veWOOD supply must vote for gauge results to be valid. If quorum is not met, the previous epoch's allocation carries forward. This prevents a tiny minority from controlling emission direction during low-engagement periods.

**Eligible syndicates:** Any syndicate registered in the SyndicateFactory with an active vault and a `shareToken/WOOD` Uniswap V3 pool.

**Bootstrapping new syndicates:** New syndicates face a chicken-and-egg problem — they need a WOOD pool to be eligible for votes, but need TVL/reputation to justify liquidity. To solve this:
- **Genesis Pool Program:** The protocol treasury seeds initial `shareToken/WOOD` liquidity (single-sided WOOD) for the first N syndicates (e.g., first 10). This comes from the 50M genesis liquidity allocation.
- **Minimum TVL gate:** After the genesis cohort, new syndicates must reach a minimum vault TVL (e.g., $10k USD equivalent) before the protocol creates their gauge pool. This filters low-quality syndicates.
- **Self-bootstrap:** Syndicate agents can always create their own pool permissionlessly and request gauge registration from governance.

### 3. WOOD Emissions (Minter.sol)

WOOD is minted each epoch and distributed to syndicate gauges proportionally to votes.

**Emission schedule (3 phases):**

| Phase | Epochs | Rate Change | Description |
|-------|--------|-------------|-------------|
| Take-off | 1–8 | +3%/week | Rapid growth, bootstrap liquidity |
| Cruise | 9–44 | -1%/week | Gradual decay as protocol matures |
| WOOD Fed | 45+ | Voter-controlled | veWOOD voters decide: +0.35%, -0.35%, or hold (capped ±5% from baseline per epoch) |

**Hard supply cap:** `MAX_SUPPLY = 1,000,000,000` (1B tokens). ~500M initial supply + ~500M emission budget = 1B total. When `totalSupply + amount > MAX_SUPPLY`, the Minter mints only the difference (`MAX_SUPPLY - totalSupply`) instead of reverting — the cap is reached gracefully. Once `totalMintable() == 0`, emissions stop permanently.

**Initial emissions:** 5M WOOD/week (1% of initial supply).

**Projected emission milestones** (from simulation):

| Week | Emission/wk | Cumulative | Total Supply | Inflation |
|------|-------------|------------|--------------|-----------|
| 1 | 5.0M | 5.0M | 505M | 1% |
| 8 | 6.2M (peak) | 44.5M | 544.5M | 9% |
| 14 | 5.8M | 80.1M | 580.1M | 16% |
| 26 | 5.1M | 145.2M | 645.2M | 29% |
| 52 | 4.0M | 262.0M | 762.0M | 52% |
| 45 | ~3.5M → WOOD Fed | ~250M | ~750M | ~50% |

**Inflation note:** Year 1 cumulative emissions (~262M) grow total supply by ~52%. This is more conservative than Aerodrome's launch, giving the flywheel more time to develop organic demand before sell pressure peaks. The circuit breakers provide additional downside protection if needed.

**WOOD Fed guardrails:** To prevent whales from voting to keep emissions permanently high (diluting newcomers):

- **Vote options per epoch:** veWOOD voters choose one of three actions: `INCREASE` (+0.35%), `DECREASE` (-0.35%), or `HOLD` (0%). The winning option is the one with the most voting power. Each INCREASE/DECREASE vote shifts the emission rate by ±0.35% of the current rate, capped at ±5% per 4-week rolling window. This was verified against the economic simulation.
- **Baseline:** Simple average of the previous 8 epochs' emission rates.
- **Cap:** The current emission rate cannot deviate more than ±5% from the baseline in absolute terms. Example: if baseline is 8M WOOD/week, emission rate is bounded to [7.6M, 8.4M].
- **Compounding limit:** Even with `INCREASE` winning every epoch for 52 weeks, the ±5% cap relative to the rolling baseline means the rate can only drift gradually. Simulation shows: starting at 8.6M/week, 52 consecutive `INCREASE` votes at +0.35%/epoch produces a max rate of ~10.3M/week (~20% above starting point, since 8.6M × 1.0035^52 ≈ 10.3M), not exponential growth.

```
emission[N] = emission[N-1] * (1 + winningVote)
baseline[N] = avg(emission[N-1], emission[N-2], ..., emission[N-8])
constraint: baseline[N] * 0.95 ≤ emission[N] ≤ baseline[N] * 1.05
```

**Team allocation:** 5% of weekly emissions to team/protocol treasury.

**veWOOD rebase (anti-dilution):**
```
rebase = weeklyEmissions × (1 - veWOOD.totalSupply / WOOD.totalSupply)² × 0.5
```
Distributed to veWOOD holders proportionally to locked amounts, protecting against dilution. At 40% lock rate, rebase covers approximately 50% of dilution for locked holders vs. full dilution for unlocked holders (see simulation §2).

### 4. Syndicate Gauges (SyndicateGauge.sol)

One gauge per syndicate. Receives WOOD emissions proportional to votes.

**Gauge cap:** No single syndicate can receive more than **25% of total epoch emissions**, regardless of vote share. Excess votes above the cap are redistributed proportionally to other gauges.

> **Why 25% instead of 35%:** Simulation showed that at 35%, three colluding whales can capture 105% (i.e., all) of emissions. At 25%, three colluding whales capture at most 75%, leaving 25% for the remaining ecosystem. This also requires a minimum of 4 syndicates to fully distribute emissions, ensuring a healthier ecosystem.

**Who earns emissions:**
- The syndicate vault rewards buffer (for vault depositors/strategies)
- Gauge streams epoch emissions into the VaultRewardsDistributor; depositors claim on-chain via ERC20Votes checkpoints

**LP bootstrapping emissions (weeks 1-12 only):**

During the first 12 weeks, a declining share of gauge emissions is directed to `shareToken/WOOD` LPs to bootstrap pool depth:

| Weeks | LP Share | Depositor Share |
|-------|----------|-----------------|
| 1–4 | 10% | 90% |
| 5–8 | 7% | 93% |
| 9–12 | 3% | 97% |
| 13+ | 0% | 100% |

This costs approximately 9M WOOD total (6.4% of first 12 weeks' emissions) — a modest investment to solve the cold-start liquidity problem. After week 12, LPs earn only Uniswap swap fees (no scheduled WOOD emissions).

### 5. Uniswap V3 Pools (shareToken/WOOD)

Each syndicate vault produces share tokens (e.g., `swUSDC`, `swETH`). For each syndicate participating in the incentive program, a Uniswap V3 pool is created:

**Pool:** `shareToken/WOOD`

**Primary price discovery: WOOD/WETH pool.** A deep WOOD/WETH pool on Uniswap V3 serves as the canonical market for WOOD price discovery (similar to AERO/WETH for Aerodrome).

- **Fee tier:** 0.3% (3000) — standard for medium-liquidity pairs
- **Initial depth:** Protocol seeds ~20M WOOD + equivalent WETH from genesis allocation as a full-range position
- **Position management:** Protocol-owned, managed by multisig. No active rebalancing — full-range position provides passive liquidity at all prices

**Per-syndicate pools: shareToken/WOOD.** These pools serve two critical functions:
1. **Early exit for depositors.** Vault redemptions are locked during active proposals (`redemptionsLocked()`). The shareToken/WOOD pool provides a secondary market where depositors can sell their share tokens without waiting for strategy settlement.
2. **Gauge eligibility.** A syndicate must have a shareToken/WOOD pool to participate in the incentive program.

**Bootstrapping shareToken/WOOD pools (single-sided WOOD):**

The protocol seeds WOOD-only into a tick range above the current price. This works because there is real demand on the other side — **depositors who need early exit while redemptions are locked**:

```
1. Protocol seeds WOOD into pool (tick range above current price)
2. Depositor holds shareTokens but vault redemptions are locked
3. Depositor sells shareTokens into pool → gets WOOD
4. Pool absorbs shareTokens, releases WOOD → price moves into range
5. Depositor sells WOOD on WOOD/WETH pair → exits to WETH/stables
6. Pool is now two-sided, organic trading continues
```

This is not a fallback mechanism — it is the primary bootstrapping approach. The protocol only needs to provide WOOD; depositors bring the shareToken side through natural early-exit demand.

**Protocol-owned position management:**
- **Range selection:** Set tick range 20-50% above the initial shareToken/WOOD price (derived from vault NAV and WOOD/WETH price). Wide enough to absorb early trades without going out of range.
- **Rebalancing:** No active rebalancing. If WOOD price moves significantly and the range goes out of range, the multisig can create a new position at the current price using treasury WOOD. The old position holds shareTokens accumulated from trades (which can be redeemed from the vault when no proposals are active).
- **Owned by:** Protocol multisig. Position NFTs are held by the multisig, not by the FeeCollector contract.

**Community LPs:** The LP bootstrapping emissions (weeks 1-12) incentivize external LPs to deepen liquidity and tighten spreads, reducing slippage for depositors exiting via the secondary market.

**Fee tier:** 1% (10000) or 0.3% (3000) — configurable per pool, higher fee for less liquid pairs.

**Fee capture:**
- Uniswap V3 LP fees accumulate in the positions
- `FeeCollector` contract claims fees from protocol-owned LP positions at epoch flip
- Collected fees are retained by the protocol treasury to fund new pool seeding — this makes pool creation self-sustaining rather than draining the finite genesis liquidity allocation
- Simulation showed voter APR from trading fees is <5% at realistic volumes — bribes are the real voter incentive, so routing fees to treasury has negligible impact on voter economics

**LP earnings scope:** LPs in `shareToken/WOOD` pools earn Uniswap swap fees + bootstrapping emissions (weeks 1-12 only).

**Pool depth beyond week 12 (quiet-period liquidity):**

After LP bootstrapping emissions end at week 12, pool depth is sustained by five complementary mechanisms:

1. **Protocol-Owned Liquidity (POL).** The protocol treasury retains its genesis-seeded LP positions permanently. These are not withdrawn after bootstrapping — they provide a baseline depth floor for every syndicate pool. As fee revenue accumulates, the treasury can deepen positions for high-activity pools. Target: protocol-owned positions cover ≥50% of typical weekly trade volume in each pool.

2. **Perpetual LP incentive (post-bootstrapping).** After week 12, 1% of weekly gauge emissions are reserved as a standing LP incentive across all active shareToken/WOOD pools (split pro-rata by pool TVL). This is small enough to avoid meaningful depositor dilution but sufficient to retain committed LPs who tighten spreads. Governance (WOOD Fed, Phase 5) can adjust this between 0-2% based on observed pool health.

3. **NAV arbitrage as natural demand.** Each shareToken has an intrinsic value (vault NAV per share). When the shareToken/WOOD pool price diverges from NAV — which happens naturally as vault strategies settle — arbitrageurs buy the cheap side. This creates recurring two-sided volume independent of proposal cycles. The deeper the vault TVL, the more reliable this arbitrage flow becomes.

4. **Speculative trading on syndicate performance.** ShareTokens are effectively equity-like claims on syndicate strategy performance. Traders who anticipate strong upcoming proposals (or want exposure to a syndicate's track record) will buy shareTokens via the pool. This speculative demand is highest around proposal announcements but persists as a baseline for well-performing syndicates.

5. **Buyback-and-lock as recurring buy pressure.** The fee-funded buyback mechanism (§Supply Reduction) purchases WOOD on the WOOD/WETH pool using 20% of protocol fee revenue. This creates consistent WOOD buy pressure every epoch, which propagates to shareToken/WOOD pools via cross-pool arbitrage. During quiet periods with low organic volume, buyback flow becomes a proportionally larger share of activity — acting as a natural stabilizer.

**Monitoring:** If any shareToken/WOOD pool's 7-day average depth falls below 2× the median weekly trade volume, the protocol treasury should deepen its position in that pool. This is a multisig operational action, not an on-chain trigger.

### 6. Fee Collection (FeeCollector.sol)

At each epoch boundary:

1. `FeeCollector` harvests accrued Uniswap V3 swap fees from protocol-owned LP positions across all syndicates
2. Collected fees (shareToken + WOOD from both sides of each pair) are sent to the protocol treasury
3. Treasury uses accumulated fees to seed `shareToken/WOOD` pools for new syndicates, reducing reliance on the finite genesis liquidity allocation

This makes pool creation **self-sustaining**: trading activity in existing pools funds liquidity for new ones.

### 7. Vault Rewards Distribution (On-Chain Pro-Rata)

Scheduled WOOD emissions for a voted syndicate are paid into the `VaultRewardsDistributor` contract. Depositors claim their share directly on-chain — no off-chain infrastructure or trusted publishers needed.

**Mechanism:**

The SyndicateVault inherits ERC20Votes, which provides checkpointed balance snapshots. The distributor reads these checkpoints to compute each depositor's share at the epoch boundary:

```solidity
function claimRewards(address vault, uint256 epoch) external {
    uint256 epochTimestamp = epochBoundary(epoch);
    uint256 depositorShares = vault.getPastVotes(msg.sender, epochTimestamp);
    uint256 totalShares = vault.getPastTotalSupply(epochTimestamp);
    uint256 reward = epochRewardPool[vault][epoch] * depositorShares / totalShares;

    // Mark claimed, transfer WOOD
    require(!claimed[vault][epoch][msg.sender], "already claimed");
    claimed[vault][epoch][msg.sender] = true;
    WOOD.transfer(msg.sender, reward);
}
```

**Why on-chain instead of Merkle:**
- **Fully trustless.** No trusted root publisher, no dispute window, no off-chain infrastructure.
- **Immediate claims.** Depositors can claim as soon as the epoch flips — no 24h delay.
- **Gas is cheap on Base.** Each claim is ~3 storage reads + 1 transfer. At Base gas prices (~0.001 gwei), this costs fractions of a cent per claim.
- **Same pattern as bribes.** VoteIncentive uses the same on-chain pro-rata approach for voter claims — consistent UX across both claim types.

**Claim window:** Rewards are claimable for 52 epochs (1 year) after the epoch they were earned. Unclaimed rewards after expiry are returned to the protocol treasury.

### 8. Vote Incentives — VoteIncentive.sol (Bribe Layer)

**Why this is essential:** Simulation shows that at realistic trading volumes ($500K/week per syndicate), voter APR from trading fees alone is likely <5%. In every successful ve(3,3) deployment (Aerodrome, Velodrome, Curve), the bribe marketplace is the primary economic engine for voter returns. Without it, locking WOOD is not economically attractive.

**Mechanism:**

Syndicate agents (or anyone) can deposit ERC-20 tokens as incentives to attract veWOOD votes to their syndicate. Voters who direct emissions to that syndicate earn a pro-rata share of the incentives.

**Contract interface:**
```solidity
interface IVoteIncentive {
    /// @notice Deposit incentive tokens for a syndicate in the current or next epoch
    /// @param syndicateId The syndicate to incentivize
    /// @param token The ERC-20 token to deposit as incentive
    /// @param amount The amount of tokens to deposit
    function depositIncentive(uint256 syndicateId, address token, uint256 amount) external;

    /// @notice Claim earned incentives for a specific syndicate and epoch
    /// @param syndicateId The syndicate voted for
    /// @param epoch The epoch number
    /// @param tokens Array of incentive token addresses to claim
    function claimIncentives(uint256 syndicateId, uint256 epoch, address[] calldata tokens) external;

    /// @notice View pending incentives for a voter
    function pendingIncentives(address voter, uint256 syndicateId, uint256 epoch, address token)
        external view returns (uint256);
}
```

**Rules:**
- **Any ERC-20 accepted:** USDC, WOOD, WETH, or any token. Depositors choose.
- **Deposit deadline:** Incentives for epoch N must be deposited before epoch N starts (i.e., during epoch N-1). This gives voters the full voting window to evaluate available incentives before allocating votes. Follows Aerodrome's proven approach — depositing during the same epoch creates a timing game where last-second bribes disadvantage voters.
- **On-chain pro-rata distribution:** Incentives are split among voters proportional to their voting power allocated to that syndicate. Computed on-chain at claim time using `Voter.sol` vote checkpoints — same pattern as vault rewards (no Merkle trees, no off-chain infra).
- **Claim timing:** Incentives become claimable after epoch N ends.
- **Integration with Voter.sol:** VoteIncentive reads vote allocations from `Voter.sol` to determine pro-rata shares. No additional on-chain voting required.

**Expected dynamics:**
- Syndicate agents bribe voters to attract emissions → higher TVL → better strategy performance → higher agent fees. This creates a self-reinforcing loop where agents spend a portion of their earnings to grow their syndicate.
- Third parties (protocols, DAOs) can bribe for emissions to syndicates that hold their tokens, creating cross-protocol incentive alignment.
- The bribe market provides price discovery for the "cost of emissions" — a key health metric for the protocol.

**Bribe bootstrapping (epochs 1-12):** The protocol treasury seeds 7.5M WOOD (~10% of treasury allocation) as bribes during the first 12 epochs to demonstrate voter APR from day one. Distributed evenly across active syndicates. This solves the cold-start problem where voters see zero bribe yield and don't lock. After epoch 12, the bribe market must sustain itself through agent and protocol bribes.

## Fee Architecture Integration

WOOD adds three new revenue streams alongside the existing vault-asset fee waterfall. They are **additive**, not replacements:

### 1. Strategy Profits (vault asset) — existing, unchanged

> Source: `SyndicateGovernor._distributeFees()`

```
Gross Profit (from strategy settlement)
  ├─ Protocol Fee (0-10%) → protocolFeeRecipient
  ├─ Agent Fee (bps) → proposer + co-proposers
  ├─ Management Fee (bps) → vault owner
  └─ Remainder → vault (depositors)
```

### 2. WOOD Emissions — new

```
Minter (weekly)
  ├─ 5% → team/protocol treasury
  ├─ Rebase → veWOOD holders (anti-dilution)
  └─ Gauges → VaultRewardsDistributor → depositors (on-chain pro-rata claims)
```

### 3. Trading Fees (shareToken + WOOD) — new

```
Uniswap V3 protocol-owned LP positions
  → FeeCollector (at epoch flip)
  → Protocol treasury (seeds new syndicate pools)
```

### 4. Vote Incentives / Bribes (any ERC-20) — new

```
Anyone deposits incentives
  → VoteIncentive (per syndicate per epoch)
  → veWOOD voters (pro-rata to voting power)
```

> **WOOD emissions do NOT reduce or replace `protocolFeeBps` revenue.** Protocol fee is taken from strategy profits (vault asset). WOOD emissions are a separate incentive layer. Future governance may decide to use protocol fee revenue to buy back WOOD from the market.

**Who earns what:**

| Participant | Vault Asset Profits | WOOD Emissions | Trading Fees | Bribes |
|-------------|:---:|:---:|:---:|:---:|
| Vault depositors | Remainder after fees | On-chain pro-rata claims | — | — |
| Vault owner | Management fee | — | — | — |
| Agent (proposer) | Performance fee | — | — | — |
| Protocol treasury | Protocol fee | 5% of emissions | Collected for pool seeding | — |
| veWOOD voters | — | Rebase (anti-dilution) | — | Pro-rata |
| LPs | — | Weeks 1-12 only | Swap fees (kept by LPs) | — |

## Token Distribution

### Initial Supply: 500M WOOD

| Allocation | Amount | % | Form |
|------------|--------|---|------|
| Genesis liquidity | 50M | 10% | WOOD (for pool bootstrapping) |
| Early voter rewards (epoch 1-4) | 40M | 8% | WOOD (bootstrap voting) |
| Protocol treasury | 75M | 15% | WOOD (held in multisig) |
| Team | 75M | 15% | WOOD (1mo cliff + 6mo linear vest) |
| Early syndicate creators | 15M | 3% | WOOD (airdrop to existing agents) |
| Community / grants | 85M | 17% | WOOD (distributed via governance) |
| Future partnerships | 60M | 12% | WOOD (held in treasury) |
| Public sale / LBP | 75M | 15% | WOOD |
| Protocol reserve | 25M | 5% | WOOD (emergency fund) |

**All allocations are distributed as liquid WOOD.** Recipients choose whether to lock into veWOOD for governance power. No one is forced into a lock — voting participation is opt-in.

**Team vesting:** 1-month cliff, then linear vesting over 6 months (26 weeks). After vesting, team members hold liquid WOOD and can sell, lock, or hold at their discretion.

**Team vesting rationale:** The 1-month cliff + 6-month linear vest is intentionally compressed vs. comparable projects (typical: 1yr cliff + 2-3yr vest) because: (a) the founding team is small and operational liquidity needs are real during launch, (b) a longer vest would misalign incentives during the critical 0-6 month growth phase where team velocity matters most, (c) the 15% team allocation at a compressed vest is partially offset by the multi-year emission budget that rewards long-term contributors. Consider extending to 1yr cliff + 1yr linear if regulatory or investor pressure requires it.

**Insider governance power depends on voluntary locking.** Unlike the previous design where insiders received pre-locked veWOOD (guaranteeing 33% voting power from day 1), insiders now must choose to lock. This means insider voting power is earned, not granted — and comes with the same lock commitment as everyone else.

### Emission Schedule (Projected)

```
Week 1:   5.0M WOOD
Week 8:   6.2M WOOD (peak, after +3%/week take-off)
Week 26:  5.1M WOOD (cruise decay)
Week 52:  4.0M WOOD
Week 45:  ~3.5M WOOD → WOOD Fed activates
Year 2:   Voter-controlled (est. 2.5-4M/week)
```

## Contracts

| Contract | Description | Key Dependencies |
|----------|-------------|-----------------|
| `WoodToken.sol` | ERC-20 (LayerZero OFT) with hard 1B supply cap; only Minter can mint | LZ OFT, OpenZeppelin |
| `VotingEscrow.sol` | Lock WOOD → veWOOD NFT, voting power with linear decay | ERC721, ReentrancyGuard |
| `Voter.sol` | Epoch voting for syndicates, gauge creation/management | VotingEscrow, SyndicateFactory |
| `SyndicateGauge.sol` | Per-syndicate emission receiver, streams WOOD to vault + LPs | Voter, Vault |
| `Minter.sol` | Emission schedule (compressed 1yr: take-off→cruise→WOOD Fed ±0.35%/epoch), epoch flipping, rebase calculation. Caps at `WoodToken.totalMintable()`. | WoodToken, Voter, VotingEscrow |
| `FeeCollector.sol` | Harvests Uniswap V3 swap fees from protocol-owned LP positions to treasury | Uniswap V3 NonfungiblePositionManager |
| `VoteIncentive.sol` | Bribe marketplace — deposit incentives for voters | Voter, VotingEscrow |
| `VaultRewardsDistributor.sol` | On-chain pro-rata WOOD claims using vault ERC20Votes checkpoints | SyndicateGauge, Vault |
| `RewardsDistributor.sol` | veWOOD rebase (anti-dilution) distribution | VotingEscrow, Minter |

## Uniswap V3 Integration Details

### Deployed Contracts (Base Mainnet)

| Contract | Address |
|----------|---------|
| UniswapV3Factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| NonfungiblePositionManager | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` |
| SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| QuoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` |

### Pool Creation Flow

**Primary WOOD/WETH pool (one-time):**
1. Call `UniswapV3Factory.createPool(WOOD, WETH, 3000)` (0.3% fee tier)
2. Call `pool.initialize(sqrtPriceX96)` — set initial WOOD/WETH ratio (derived from LBP/public sale price)
3. Seed full-range position: ~20M WOOD + equivalent WETH from genesis allocation via `NonfungiblePositionManager.mint()`
4. Position NFT held by protocol multisig — no active rebalancing needed for full-range

**Per-syndicate shareToken/WOOD pools:**
1. **Create pool:** Call `UniswapV3Factory.createPool(shareToken, WOOD, feeTier)`
2. **Initialize price:** Call `pool.initialize(sqrtPriceX96)` — set initial shareToken/WOOD ratio (derived from vault NAV and WOOD/WETH price)
3. **Seed liquidity (single-sided WOOD):**
   - Calculate tick range above current price (pool acts as limit sell for WOOD)
   - Call `NonfungiblePositionManager.mint()` with WOOD only
   - Pool becomes two-sided as depositors sell shareTokens for early exit
4. **Register gauge:** Call `Voter.createGauge(syndicateId, pool, nftTokenId)`

### Fee Harvesting

Uniswap V3 fees accrue inside position NFTs. To collect:
```solidity
NonfungiblePositionManager.collect(CollectParams({
    tokenId: lpNftId,
    recipient: feeCollector,
    amount0Max: type(uint128).max,
    amount1Max: type(uint128).max
}))
```

`FeeCollector` calls this for all protocol-owned positions at epoch flip, then forwards collected fees to the protocol treasury for pool seeding.

## Epoch Lifecycle

```
Thursday 00:00 UTC — Epoch N starts
│
├── Minter.flipEpoch()
│   ├── Mint WOOD emissions for epoch N
│   ├── Distribute to gauges (proportional to epoch N-1 votes)
│   ├── Gauges stream emissions into each voted vault's VaultRewardsDistributor
│   ├── Mint veWOOD rebase
│   └── Collect fees from epoch N-1 → protocol treasury
│
├── Users vote for syndicates (any time during epoch)
├── Vote incentive deposits for epoch N+1 accepted (visible to voters planning next epoch)
├── Vault depositors claim WOOD rewards on-chain (pro-rata via ERC20Votes checkpoints)
├── LPs provide liquidity for swap fees (+ bootstrapping emissions weeks 1-12)
├── Voters claim epoch N-1 bribe incentives
│
Wednesday 23:59 UTC — Epoch N ends
```

## Security Considerations

1. **Reentrancy:** VotingEscrow handles NFTs and token transfers — use ReentrancyGuard on all external calls
2. **Flash loan attacks:** Voting power based on locked balance (not transferable), immune to flash loans
3. **Checkpoint manipulation:** Use block.timestamp checkpoints for vote weight snapshots
4. **Fee collection atomicity:** FeeCollector must handle failed collections gracefully (one position failing shouldn't block others)
5. **Checkpoint integrity:** VaultRewardsDistributor and VoteIncentive rely on ERC20Votes checkpoints for pro-rata calculations. Ensure `getPastVotes()` and `getPastTotalSupply()` cannot be manipulated by deposits/withdrawals in the same block as epoch boundary. Use `block.timestamp` checkpoints (not block numbers) for consistency.
6. **Overflow:** veWOOD voting power calculation uses time math — careful with uint256 overflow at boundaries
7. **Oracle manipulation:** WOOD/WETH pool price can be manipulated via flash loans or large trades. **Never use spot pool price on-chain.** Any contract that needs WOOD price must use a TWAP (time-weighted average price) over a minimum 30-minute window via Uniswap V3's `observe()`. This applies to: initial shareToken/WOOD price derivation, TVL calculations, and any future buyback mechanism.
8. **Bribe token safety:** VoteIncentive must use SafeERC20 and handle fee-on-transfer / rebasing tokens gracefully (or explicitly reject them)
9. **Gauge cap enforcement:** Cap must be enforced at distribution time (not just at vote time) to prevent manipulation via late voting
10. **Access control:** All pausable contracts use a 2-of-3 multisig as pause guardian. Minter emergency pause is callable by the pause guardian. Unpausing requires a higher threshold (3-of-5 protocol multisig) to prevent premature restart.
11. **Gas costs for checkpoint claims:** In worst case, a depositor with many position changes (frequent transfers) may have expensive `getPastVotes()` lookups. ERC20Votes uses binary search over checkpoints — cost is O(log n) per lookup, acceptable for typical depositor behavior (<100 checkpoints per year). If gas becomes an issue, depositors can consolidate positions.
12. **Upgradeability:** All WOOD contracts are deployed as **immutable** (not UUPS upgradeable). VotingEscrow holds locked tokens — upgradeability would introduce rug risk. If a critical bug is found, the migration path is: (a) pause affected contract, (b) deploy new contract, (c) snapshot state, (d) users migrate via a claim mechanism on the new contract. This is the same approach used by Curve and Aerodrome.

## Regulatory Considerations

> **This section is not legal advice. It identifies risks and recommends actions.**

### Howey Test Analysis (US Securities Law)

The four-prong Howey test for whether WOOD could be classified as a security:

| Prong | Assessment | Risk |
|-------|-----------|------|
| **Investment of money** | Users buy or earn WOOD, then lock it | Met |
| **Common enterprise** | Token value tied to protocol success (horizontal commonality) | Likely met |
| **Expectation of profits** | Voters receive trading fees, bribes, and rebase | Arguably met |
| **Solely from efforts of others** | Voters actively direct emissions (governance function); not passive | **Key mitigating factor** |

**Mitigations already in the design:**
- veWOOD is non-transferable (locked NFT) — not freely tradeable like typical securities
- Voting is active participation (governance work), not passive investment
- WOOD Fed gives voters direct control over monetary policy
- No dividends — fee distribution is tied to active voting, not passive holding

**Remaining risks:**
- Team + treasury hold 33% of initial WOOD — concentrated ownership even if not locked
- Emissions schedule is set by protocol, not purely by voter action (until WOOD Fed at week 45)
- Public sale / LBP could be viewed as a securities offering

### Jurisdictional Notes

| Jurisdiction | Key Regulation | Consideration |
|-------------|---------------|---------------|
| **US (SEC)** | Howey test, Securities Act | Most conservative. Avoid marketing WOOD as investment. Geographic restrictions on public sale. |
| **EU (MiCA)** | Markets in Crypto-Assets Regulation | Utility token classification requires clear non-investment utility. White paper requirements. |
| **Singapore (MAS)** | Payment Services Act | Digital payment token vs capital markets product distinction. |
| **Cayman/BVI** | Common token issuer domicile | Consider for legal entity structure. |

### Recommendations

1. **Engage securities counsel** before any token generation event (TGE) or public sale
2. **Geographic restrictions** — consider excluding US persons from public sale/LBP
3. **SAFT structure** — use Simple Agreement for Future Tokens for any pre-sale allocation
4. **Sufficient decentralization** — accelerate the transition to WOOD Fed (voter-controlled emissions) and minimize team governance power over time
5. **Utility-first messaging** — position WOOD as a governance/coordination token, not an investment vehicle
6. **No profit language** — avoid terms like "yield", "returns", "APR" in marketing materials; use "voting rewards", "incentives", "governance participation"

## Economic Simulation

An interactive economic simulation is available at `docs/wood-simulation.ts`. Run it to validate parameter choices:

```bash
npx tsx docs/wood-simulation.ts              # full 104-week simulation
npx tsx docs/wood-simulation.ts --csv        # output CSV files for analysis
npx tsx docs/wood-simulation.ts --weeks 52   # 1-year simulation
```

**Key simulation findings:**

1. **Inflation:** Year 1 emissions (~262M) grow total supply by ~52%. Conservative relative to Aerodrome's launch, giving the flywheel more time to develop.
2. **Rebase protection:** At 40% lock rate, veWOOD holders absorb ~50% less dilution than unlocked holders.
3. **Voter fees alone are insufficient:** At $500K/week trading volume per syndicate, voter APR from fees is <5%. The bribe layer is essential.
4. **Gauge cap at 25%:** Three colluding whales capture at most 75% of emissions (vs. 105% at 35%). Four syndicates minimum to distribute all emissions.
5. **Insider voting power depends on voluntary locking.** All allocations are liquid WOOD — insider governance power is no longer guaranteed. At week 26:

| Insider lock rate | 20% ext lock | 30% ext lock | 40% ext lock |
|---|:---:|:---:|:---:|
| 50% of insider WOOD locked | 49.6% ✓ | 39.6% ✓ | 33.0% ✓ |
| 75% locked | 59.6% ⚠ | 49.6% ✓ | 42.4% ✓ |
| 100% locked | 66.3% ⚠ | 56.7% ⚠ | 49.6% ✓ |

At 75% insider lock + 30% external lock, insiders drop below 50% by week 26 and reach 23.5% by week 104.

6. **LP bootstrapping cost:** ~4.5M WOOD over 12 weeks — modest and effective.
7. **WOOD Fed compounding:** Even with 52 consecutive INCREASE votes, emission rate drifts only 0.52% total — the ±5% rolling baseline cap is very effective at preventing runaway inflation.
8. **Bear scenario stress test** (<10% lock rate, zero bribes, $2M TVL, $0.005 WOOD):
   - Circuit breakers auto-cut emissions by 50% (lock rate + price triggers)
   - Depositor APR still 33% at $2M TVL (attractive enough to retain capital)
   - Voter APR 63% from seeded bribes alone
   - Treasury runway: 1.3 years at bear spend rate
   - **Verdict: protocol survives and can hibernate until market recovers**

## Open Questions

1. **WOOD token launch mechanism:** Options evaluated:

   **Option A: Fjord Foundry LBP (recommended)**
   - Price starts high, decays over 2-3 days until buyers step in — natural price discovery
   - Anti-whale: early large buys get punished as price decays further
   - Supports Base natively. $1.1B+ raised across 717 launches. Arcadia Finance launched on Base via Fjord ($289K raised, DeFi protocol)
   - 75M WOOD public sale allocation sold via LBP → proceeds (WETH) + remaining WOOD seed the permanent WOOD/WETH Uniswap pool
   - Platform fee ~1-2%. Creates a marketing event (countdown, community engagement)

   **Option B: Direct Uniswap V3 pool bootstrap**
   - Deploy WoodToken, create WOOD/WETH pool, seed with genesis allocation. People buy by swapping WETH.
   - Simplest approach. Zero platform fees. Pool stays permanently.
   - No price discovery mechanism — team picks initial price. Bots/MEV will snipe first block.
   - No marketing event. Risk of mispricing (too low = insiders capture upside, too high = no buyers)

   **Option C: Flaunch (Base-native launchpad)**
   - Memecoin launchpad on Base using Uniswap V4. 30-min no-sell rule, progressive bid wall.
   - Base-native, popular, built-in buy support. But positioned as memecoin platform — wrong signal for a governance token with real utility. Flaunch takes all trading fees.

   **Decision: TBD**
2. ~~**Gauge cap:**~~ **Resolved** — 25% cap per syndicate (reduced from 35% based on simulation).
3. ~~**Minimum lock duration:**~~ **Resolved** — 4 weeks minimum (increased from 1 week to prevent mercenary farming).
4. ~~**Syndicate eligibility:**~~ **Resolved** — Genesis Pool Program for first 10 syndicates, then minimum TVL gate (see §2).
5. **Multi-chain:** Base only initially, or plan for L2 expansion?
6. ~~**Merkle root publisher:**~~ **Resolved** — Replaced Merkle with on-chain pro-rata claims using ERC20Votes checkpoints. No trusted publisher needed.
7. **Audit:** 9 contracts with complex interactions require comprehensive audit before mainnet.

## Phased Deployment Plan

Do not ship all 9 contracts at once. Each phase should be audited, deployed, and stabilized before proceeding.

### Phase 0: Pre-launch
- Deploy `WoodToken.sol` (LayerZero OFT — requires LZ endpoint configuration on Base)
- Execute initial distribution (team WOOD vesting, treasury, genesis liquidity)
- Run LBP or public sale
- **Note:** ve(3,3) infrastructure (VotingEscrow, Voter, Gauges) stays on Base; only the WOOD token itself is multichain via LayerZero OFT.
- **Gate:** Token is live and liquid on at least one DEX

### Phase 1: Core Locking & Voting
- Deploy `VotingEscrow.sol`, `Voter.sol`, `Minter.sol`
- Enable WOOD locking and syndicate voting
- Emissions begin flowing to gauges
- **Gate:** At least 5 syndicates with active gauges, >20% of supply locked
- **If gate not met within 8 weeks — Path A:** Increase early voter rewards (pull forward from epoch 5+ allocation), reduce minimum TVL gate for new syndicates to attract more participants.
- **If gate still not met by week 16 — Path B:** Enter maintenance mode. Reduce emissions to 25% of scheduled rate. Delay Phase 2 indefinitely. The protocol continues operating with basic locking and voting but does not proceed to gauge economics until organic demand justifies it. This prevents throwing more emissions at a market that isn't ready.

### Phase 2: Gauge Economics
- Deploy `SyndicateGauge.sol`, `VaultRewardsDistributor.sol`
- Emissions flow through gauges into vault rewards buffers
- Depositors claim WOOD rewards on-chain (pro-rata via ERC20Votes checkpoints)
- LP bootstrapping emissions active (weeks 1-12 of this phase)
- **Gate:** Depositor claims working for 4+ epochs, reward math verified

### Phase 3: Fee Collection & Rebase
- Deploy `FeeCollector.sol`, `RewardsDistributor.sol`
- Trading fees collected to protocol treasury for pool seeding
- veWOOD rebase (anti-dilution) activated
- **Gate:** Fee collection reliable for 4+ epochs, rebase mathematically verified

### Phase 4: Bribe Market
- Deploy `VoteIncentive.sol`
- Agents and third parties can deposit vote incentives
- Full flywheel operational
- **Gate:** Bribe deposits observed, voter APR meaningfully above fee-only APR

### Phase 5: WOOD Fed
- Activate voter-controlled emission rate adjustments (~week 45)
- Protocol transitions from fixed schedule to community governance
- **Gate:** Sufficient decentralization metrics met (>60% of veWOOD voting power held by non-insiders)

**Emergency infrastructure:** All contracts include OpenZeppelin Pausable. The Minter has an emergency pause that halts emissions if a critical vulnerability is discovered.

## Downside Scenario Planning

### Scenario: WOOD price decline

**What breaks:** Emissions become less valuable → depositors sell instead of hold → agents reduce bribes → voters unlock → further decline. The flywheel reverses.

**Graduated circuit breakers (enforced in Minter contract via 30-day TWAP):**

| Price Drop (from 30-day TWAP peak) | Emission Reduction | Effect |
|-------------------------------------|-------------------|--------|
| -30% | 25% reduction | Early warning — slow the bleed |
| -50% | 50% reduction | Significant cut — preserve token value |
| -70% | 75% reduction (conservation mode) | Minimal emissions to keep system alive |
| -80% | Pause guardian can halt emissions | Full stop — resume when price recovers above -50% or after 4 epochs |

These trigger automatically based on WOOD/WETH 30-day TWAP. No governance vote needed.

**Hysteresis on recovery:** To prevent emission oscillation around threshold boundaries, reductions lift at a higher recovery point than the trigger. The -30% tier triggers at -30% but only lifts when price recovers to -20%. Similarly: -50% lifts at -40%, -70% lifts at -60%. This 10% buffer prevents whipsaw where emissions toggle on/off every epoch.

**Treasury backstop:** Protocol treasury can use accumulated trading fees + protocol reserve to provide WOOD/WETH buy support (not a price guarantee — a liquidity floor).

### Scenario: Lock rate falls below 10%

**What breaks:** Governance is captured by a tiny minority. Emissions decisions are unrepresentative.

**Circuit breakers:**
1. Phase 1 gate already prevents proceeding with <20% lock rate
2. If lock rate drops below 10% post-launch, emission rate automatically reduces by 50% until lock rate recovers above 15%. This is enforced in the Minter contract, not by governance vote.

### Scenario: No syndicates attract meaningful bribes

**What breaks:** Voter returns are limited to rebase only. Locking becomes unattractive.

**Response:** This means the protocol is too early for a token incentive layer. The phased deployment handles this — Phase 4 gate requires "bribe deposits observed." If bribes don't materialize, the system operates without VoteIncentive (Phase 3 is self-contained). Emissions still flow to depositors, rebase still protects lockers, but voter yield is lower.

## Fund Governance

All fund allocations are managed by the protocol multisig (3-of-5). No veWOOD vote required — the team operates with full discretion over treasury, partnerships, grants, and reserves.

- **Treasury (75M):** Pool seeding, WOOD/WETH liquidity, operational costs
- **Future Partnerships (60M):** Strategic integrations, protocol partnerships. Max 15M WOOD per quarter to prevent dumping
- **Community / Grants (85M):** Individual grants capped at 2M WOOD, vest over 3-6 months
- **Protocol Reserve (25M):** Emergency fund — bug bounties, emergency liquidity, audit funding

**Spending policies (enforced pre-mint):**
- **Monthly transparency reports** published to governance forum: amounts disbursed, recipients, purpose, remaining balances per allocation bucket
- **No single disbursement >10M WOOD** without 7-day public notice period (posted to governance forum). This allows community review before large outflows.
- **Treasury runway tracking:** Maintain minimum 6-month operational runway in treasury at all times. If treasury balance approaches minimum, reduce discretionary spending (grants, partnerships) before operational spending (pool seeding, liquidity).
- **Quarterly allocation review:** Team publishes planned spending for the next quarter. Not binding, but establishes expectations and accountability.

## Supply Reduction Mechanism

To counterbalance 52% year-1 inflation, the protocol implements a **fee-funded buyback-and-lock**:

1. **Source:** 20% of protocol fee revenue (from `protocolFeeBps` on vault strategy profits) is used to buy WOOD on the WOOD/WETH pool
2. **Destination:** Bought WOOD is locked into a protocol-owned veWOOD position (auto-max-lock, 1 year) — removing it from circulating supply while adding voting power to the protocol treasury
3. **Execution:** The fee-funded buyback uses on-chain TWAP orders via CoW Protocol's TWAP order type (available on Base). The protocol multisig creates a TWAP order specifying: (a) sell token = USDC/ETH from fees, (b) buy token = WOOD, (c) number of parts = 24, (d) interval = 1hr, (e) min buy amount = based on 30-day TWAP ±5% slippage protection. Purchased WOOD is automatically locked as veWOOD (max lock, auto-lock enabled) via a `CoWSwapHandler.sol` post-hook. This approach avoids adding a trust assumption and creates fully on-chain, MEV-resistant buybacks. Alternative: if CoW TWAP is unavailable on Base at launch, fall back to a keeper-based splitter with multisig-held execution rights (documented as a trust assumption).
4. **Transparency:** Buyback amounts and veWOOD position are publicly trackable on-chain

This creates a deflationary pressure proportional to protocol revenue. As vault TVL and strategy profits grow, buyback volume increases — creating a natural floor for WOOD price tied to real economic activity, not just emission demand.

**Why lock instead of burn:** Locked WOOD earns rebase and can vote — the protocol treasury becomes a productive participant in governance rather than a dead-end burn address. This also avoids the regulatory optics of "burning" tokens (which some jurisdictions view as evidence of securities-like properties).

## Agent Bribe Economics

**Where does bribe capital come from?**

Agents earn performance fees (in vault asset) from successful strategy proposals. A rational agent spends a portion of expected fees as bribes to attract emissions to their syndicate, which attracts more depositors, which increases their fee base.

**Breakeven analysis:**

```
Agent bribe ROI = (additional TVL from emissions × strategy APY × performance fee bps) / bribe cost

Example:
- Agent bribes 1,000 USDC to attract 500K WOOD emissions to their syndicate
- 500K WOOD at $0.05 = $25K in depositor incentives
- This attracts $200K additional TVL (conservative 8:1 TVL-to-incentive ratio)
- Syndicate earns 10% APY on $200K = $20K/year gross profit
- Agent's performance fee = 10% of $20K = $2K/year
- ROI = $2K / $1K = 200% annualized

Breakeven: Agent needs bribe to attract enough TVL that performance fees exceed bribe cost within 1 epoch.
At 10% APY and 10% performance fee: $1 of bribes must attract ~$520 of TVL per epoch for breakeven.
```

**Who else bribes?**
- **Protocols:** DeFi protocols can bribe for emissions to syndicates that use their products (e.g., Moonwell bribes for syndicates running Moonwell supply strategies). This is the same dynamic as Aerodrome's protocol bribes.
- **Token projects:** Projects can bribe for emissions to syndicates that hold their tokens, increasing buy pressure and TVL exposure.

**If bribes don't materialize:** The system still works without bribes — voters earn rebase, depositors earn emissions. Bribes are yield amplification, not a structural dependency. Phase 4 gate validates this before full deployment.

## Documentation & Communication Plan

The tokenomics spec must be accessible to three audiences before launch: developers integrating contracts, voters/depositors making economic decisions, and external reviewers (auditors, partners, regulators). Deliverables:

1. **Technical docs (Mintlify).** Convert this spec (`tokenomics-wood.md`) into structured Mintlify docs pages with sidebar navigation: Overview, Core Mechanism, Contracts Reference, Emission Schedule, Fee Architecture, Deployment Phases. Each contract gets its own subpage with interface, events, and integration notes. Hosted at `docs.sherwood.gg/tokenomics`.

2. **Public site — "How WOOD Works."** A non-technical landing page for depositors and voters:
   - Visual flywheel diagram (animated SVG: lock → vote → emit → deposit → trade → bribe → repeat)
   - "How it works" 4-step flow with simple language
   - Key numbers dashboard: current epoch, total locked, emission rate, lock rate %, top syndicate gauges, buyback volume. Fed by on-chain reads (subgraph or direct RPC).
   - FAQ addressing common questions (lock durations, how to vote, when to claim)

3. **Target timeline.** All documentation artifacts ready before **Phase 0 (token deployment)**. The Mintlify site is the gate — no TGE without published docs. Public dashboard can launch in parallel with Phase 1 (locking goes live) since it requires on-chain data.

## References

- [Aerodrome Finance Docs](https://aerodrome.finance/docs)
- [Velodrome V2 Contracts](https://github.com/velodrome-finance/contracts)
- [Uniswap V3 Core](https://github.com/Uniswap/v3-core)
- [Uniswap V3 Periphery](https://github.com/Uniswap/v3-periphery)
- [Curve VotingEscrow](https://github.com/curvefi/curve-dao-contracts/blob/master/contracts/VotingEscrow.vy)
- [Sablier V2 (streaming alternative)](https://docs.sablier.com/)
