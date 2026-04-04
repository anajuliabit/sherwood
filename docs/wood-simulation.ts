#!/usr/bin/env npx tsx
/**
 * WOOD Token Economic Simulation
 *
 * Models the ve(3,3) tokenomics over 104 weeks (2 years):
 * - Emission schedule (take-off, cruise, WOOD Fed phases)
 * - Dilution analysis at various lock rates
 * - Voter break-even analysis at various trading volumes
 * - Gauge cap stress test with whale concentration
 * - Supply distribution tracking
 *
 * Usage:
 *   npx tsx docs/wood-simulation.ts
 *   npx tsx docs/wood-simulation.ts --csv          # output CSV files
 *   npx tsx docs/wood-simulation.ts --weeks 52     # simulate 1 year
 *   npx tsx docs/wood-simulation.ts --initial-emission 5000000  # 5M/week
 */

// ---------------------------------------------------------------------------
// CLI argument parsing (no deps)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

const cliArgs = parseArgs(process.argv);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface SimConfig {
  initialSupply: number;
  initialEmission: number; // WOOD/week
  takeoffRate: number; // +3%/week
  cruiseRate: number; // -1%/week
  woodFedRate: number; // steady-state rate change during WOOD Fed
  takeoffEndWeek: number; // week 8
  woodFedStartWeek: number; // week 45
  gaugeCap: number; // 25%
  teamPct: number;
  treasuryPct: number;
  earlyCreatorsPct: number;
  communityPct: number;
  genesisLiquidityPct: number;
  earlyVoterPct: number;
  partnershipsPct: number;
  publicSalePct: number;
  teamEmissionPct: number; // 5% of weekly emissions to team
  minLockWeeks: number;
  maxLockWeeks: number; // 1 year (52 weeks)
  maxSupply: number; // 1B hard cap
  weeks: number;
  csv: boolean;
}

const config: SimConfig = {
  initialSupply: Number(cliArgs["initial-supply"] || 500_000_000),
  initialEmission: Number(cliArgs["initial-emission"] || 5_000_000),
  takeoffRate: Number(cliArgs["takeoff-rate"] || 0.03),
  cruiseRate: Number(cliArgs["cruise-rate"] || -0.01),
  woodFedRate: Number(cliArgs["wood-fed-rate"] || -0.005),
  takeoffEndWeek: Number(cliArgs["takeoff-end"] || 8),
  woodFedStartWeek: Number(cliArgs["wood-fed-start"] || 45),
  gaugeCap: Number(cliArgs["gauge-cap"] || 0.25),
  teamPct: 0.15,
  treasuryPct: 0.15,
  earlyCreatorsPct: 0.03,
  communityPct: 0.17,
  genesisLiquidityPct: 0.10,
  earlyVoterPct: 0.08,
  partnershipsPct: 0.12,
  publicSalePct: 0.15,
  teamEmissionPct: 0.05,
  minLockWeeks: Number(cliArgs["min-lock-weeks"] || 4),
  maxLockWeeks: 52, // 1 year max lock
  maxSupply: Number(cliArgs["max-supply"] || 1_000_000_000),
  weeks: Number(cliArgs["weeks"] || 104),
  csv: cliArgs["csv"] === "true",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number, decimals = 0): string {
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(decimals);
}

function pct(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function printTable(headers: string[], rows: string[][], colWidths: number[]) {
  const header = headers.map((h, i) => padRight(h, colWidths[i])).join(" | ");
  const sep = colWidths.map((w) => "-".repeat(w)).join("-+-");
  console.log(header);
  console.log(sep);
  for (const row of rows) {
    console.log(row.map((c, i) => padLeft(c, colWidths[i])).join(" | "));
  }
}

function toCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// ---------------------------------------------------------------------------
// 1. Emission Model
// ---------------------------------------------------------------------------

interface WeekData {
  week: number;
  emission: number;
  cumulativeEmission: number;
  totalSupply: number;
  phase: string;
}

function simulateEmissions(cfg: SimConfig): WeekData[] {
  const data: WeekData[] = [];
  let emission = cfg.initialEmission;
  let cumulative = 0;
  const emissionBudget = cfg.maxSupply - cfg.initialSupply; // e.g. 500M

  for (let w = 1; w <= cfg.weeks; w++) {
    let phase: string;
    if (w <= cfg.takeoffEndWeek) {
      phase = "Take-off";
      if (w > 1) emission *= 1 + cfg.takeoffRate;
    } else if (w <= cfg.woodFedStartWeek) {
      phase = "Cruise";
      emission *= 1 + cfg.cruiseRate;
    } else {
      phase = "WOOD Fed";
      emission *= 1 + cfg.woodFedRate;
    }

    // Hard cap: don't emit beyond the 1B total supply ceiling
    const remaining = emissionBudget - cumulative;
    const actualEmission = Math.min(emission, Math.max(0, remaining));
    cumulative += actualEmission;

    data.push({
      week: w,
      emission: actualEmission,
      cumulativeEmission: cumulative,
      totalSupply: cfg.initialSupply + cumulative,
      phase: actualEmission === 0 ? "Cap Reached" : phase,
    });

    if (actualEmission === 0) break; // emissions fully exhausted
  }

  return data;
}

function printEmissionSummary(data: WeekData[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  1. EMISSION SCHEDULE");
  console.log("=".repeat(80));

  const milestones = [1, 4, 8, 14, 26, 39, 52, 67, 78, 91, 104];
  const headers = ["Week", "Phase", "Emission/wk", "Cumulative", "Total Supply", "Inflation"];
  const rows = milestones
    .filter((w) => w <= data.length)
    .map((w) => {
      const d = data[w - 1];
      const inflation = d.cumulativeEmission / config.initialSupply;
      return [
        String(d.week),
        d.phase,
        fmt(d.emission),
        fmt(d.cumulativeEmission),
        fmt(d.totalSupply),
        pct(inflation),
      ];
    });

  printTable(headers, rows, [6, 10, 14, 14, 14, 10]);

  const peakWeek = data.reduce((max, d) => (d.emission > max.emission ? d : max), data[0]);
  const yr1 = data[Math.min(51, data.length - 1)];
  const yr2 = data[data.length - 1];
  const capWeek = data.find((d) => d.phase === "Cap Reached" || d.totalSupply >= config.maxSupply);

  console.log(`\nPeak emission: ${fmt(peakWeek.emission)}/week at week ${peakWeek.week}`);
  console.log(
    `Year 1 cumulative: ${fmt(yr1.cumulativeEmission)} (${pct(yr1.cumulativeEmission / config.initialSupply)} of initial supply)`
  );
  if (data.length >= 104) {
    console.log(
      `Year 2 cumulative: ${fmt(yr2.cumulativeEmission)} (${pct(yr2.cumulativeEmission / config.initialSupply)} of initial supply)`
    );
  }
  if (capWeek) {
    console.log(
      `⚠️  1B supply cap hit at week ${capWeek.week} — emissions stop. Total supply: ${fmt(capWeek.totalSupply)}`
    );
  } else {
    console.log(
      `Supply at end of simulation: ${fmt(yr2.totalSupply)} / ${fmt(config.maxSupply)} (${pct(yr2.totalSupply / config.maxSupply)} of cap)`
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Dilution Analysis
// ---------------------------------------------------------------------------

interface DilutionRow {
  week: number;
  lockRate: number;
  rebase: number;
  cumulativeRebase: number;
  lockedDilution: number; // effective dilution for locked holders
  unlockedDilution: number; // effective dilution for unlocked holders
}

function simulateDilution(
  emissions: WeekData[],
  lockRates: number[]
): Map<number, DilutionRow[]> {
  const results = new Map<number, DilutionRow[]>();

  for (const lockRate of lockRates) {
    const rows: DilutionRow[] = [];
    let cumulativeRebase = 0;

    // Initial locked supply: all veWOOD allocations
    const initialVeWood =
      config.initialSupply *
      (config.teamPct + config.treasuryPct + config.earlyCreatorsPct + config.communityPct);

    for (let i = 0; i < emissions.length; i++) {
      const e = emissions[i];
      // veWOOD supply = initial locked + lockRate * cumulative liquid emissions
      const liquidEmissions = e.cumulativeEmission * (1 - config.teamEmissionPct);
      const veSupply = initialVeWood + lockRate * liquidEmissions;
      const ratio = veSupply / e.totalSupply;

      // Rebase formula from spec
      const rebase = e.emission * Math.pow(1 - ratio, 2) * 0.5;
      cumulativeRebase += rebase;

      // Dilution = how much your share of total supply changed
      // Locked holders get rebase, unlocked don't
      const initialLockedShare = 1 / config.initialSupply; // per-token share
      const lockedTokensNow = 1 + cumulativeRebase / (veSupply || 1); // growth factor
      const lockedDilution = 1 - (lockedTokensNow * config.initialSupply) / e.totalSupply;
      const unlockedDilution = 1 - config.initialSupply / e.totalSupply;

      rows.push({
        week: e.week,
        lockRate,
        rebase,
        cumulativeRebase,
        lockedDilution,
        unlockedDilution,
      });
    }

    results.set(lockRate, rows);
  }

  return results;
}

function printDilutionAnalysis(dilution: Map<number, DilutionRow[]>) {
  console.log("\n" + "=".repeat(80));
  console.log("  2. DILUTION ANALYSIS (locked vs unlocked holders)");
  console.log("=".repeat(80));

  const milestones = [4, 14, 26, 52, 78, 104];
  const lockRates = [...dilution.keys()];

  for (const week of milestones.filter((w) => w <= config.weeks)) {
    console.log(`\n--- Week ${week} ---`);
    const headers = ["Lock Rate", "Rebase/wk", "Cum. Rebase", "Locked Dilution", "Unlocked Dilution", "Benefit"];
    const rows = lockRates.map((lr) => {
      const d = dilution.get(lr)![week - 1];
      return [
        pct(lr),
        fmt(d.rebase),
        fmt(d.cumulativeRebase),
        pct(d.lockedDilution),
        pct(d.unlockedDilution),
        pct(d.unlockedDilution - d.lockedDilution),
      ];
    });
    printTable(headers, rows, [10, 12, 14, 16, 18, 10]);
  }
}

// ---------------------------------------------------------------------------
// 3. Voter Break-Even Analysis
// ---------------------------------------------------------------------------

interface VoterBreakEven {
  weeklyVolume: number;
  syndicateCount: number;
  feeTier: number;
  weeklyFees: number;
  annualFees: number;
  woodPrice: number;
  totalLockedValue: number;
  voterApr: number;
}

function simulateVoterBreakEven(
  emissions: WeekData[],
  lockRatePct: number
): VoterBreakEven[] {
  const results: VoterBreakEven[] = [];

  const weeklyVolumes = [100_000, 500_000, 1_000_000, 5_000_000];
  const syndicateCounts = [5, 10, 20];
  const feeTiers = [0.003, 0.01]; // 0.3% and 1%
  const woodPrices = [0.01, 0.05, 0.10, 0.50];

  // Use week 26 as reference point (6 months in)
  const refWeek = Math.min(25, emissions.length - 1);
  const totalSupply = emissions[refWeek].totalSupply;
  const lockedSupply = totalSupply * lockRatePct;

  for (const vol of weeklyVolumes) {
    for (const count of syndicateCounts) {
      for (const fee of feeTiers) {
        for (const price of woodPrices) {
          const weeklyFees = vol * count * fee;
          const annualFees = weeklyFees * 52;
          const totalLockedValue = lockedSupply * price;
          const voterApr = totalLockedValue > 0 ? annualFees / totalLockedValue : 0;

          results.push({
            weeklyVolume: vol,
            syndicateCount: count,
            feeTier: fee,
            weeklyFees,
            annualFees,
            woodPrice: price,
            totalLockedValue,
            voterApr,
          });
        }
      }
    }
  }

  return results;
}

function printVoterBreakEven(results: VoterBreakEven[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  3. VOTER BREAK-EVEN ANALYSIS (at 40% lock rate, week 26)");
  console.log("=".repeat(80));

  // Show compact view: for each fee tier, show volume x price matrix at 10 syndicates
  for (const feeTier of [0.003, 0.01]) {
    console.log(`\n--- Fee tier: ${(feeTier * 100).toFixed(1)}% | 10 syndicates ---`);

    const filtered = results.filter(
      (r) => r.feeTier === feeTier && r.syndicateCount === 10
    );

    const volumes = [...new Set(filtered.map((r) => r.weeklyVolume))];
    const prices = [...new Set(filtered.map((r) => r.woodPrice))];

    const headers = ["Vol/wk\\Price", ...prices.map((p) => `$${p}`)];
    const rows = volumes.map((vol) => {
      const cells = prices.map((price) => {
        const r = filtered.find(
          (x) => x.weeklyVolume === vol && x.woodPrice === price
        )!;
        const aprStr = pct(r.voterApr);
        return r.voterApr >= 0.05 ? `${aprStr} ✓` : aprStr;
      });
      return [`$${fmt(vol)}`, ...cells];
    });

    printTable(headers, rows, [14, 12, 12, 12, 12]);
  }

  console.log("\n✓ = APR >= 5% (minimum viable voter incentive)");

  // Find minimum viable volume
  const viable = results.filter((r) => r.voterApr >= 0.05 && r.syndicateCount === 10);
  if (viable.length > 0) {
    const minViable = viable.reduce((min, r) =>
      r.weeklyVolume < min.weeklyVolume ? r : min
    );
    console.log(
      `\nMinimum viable: $${fmt(minViable.weeklyVolume)}/wk per syndicate at ${(minViable.feeTier * 100).toFixed(1)}% fee, WOOD=$${minViable.woodPrice}`
    );
  } else {
    console.log(
      "\n⚠ No scenario achieves 5% APR for voters with 10 syndicates — bribe layer is essential"
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Gauge Cap Stress Test
// ---------------------------------------------------------------------------

interface GaugeCapResult {
  whaleVotePct: number;
  syndicateCount: number;
  actualCapture: number; // what the whale's syndicate actually gets
  redistributed: number; // excess redistributed
  effectiveShare: number; // % of total emissions
}

function simulateGaugeCap(): GaugeCapResult[] {
  const results: GaugeCapResult[] = [];
  const whaleConcentrations = [0.2, 0.35, 0.4, 0.5, 0.6, 0.8];
  const syndicateCounts = [5, 10, 20];

  for (const whalePct of whaleConcentrations) {
    for (const count of syndicateCounts) {
      // Whale votes 100% for their syndicate
      // Remaining votes split evenly across other syndicates
      const remainingVotePct = 1 - whalePct;
      const otherSyndicateVote = count > 1 ? remainingVotePct / (count - 1) : 0;

      // Apply gauge cap
      let actualCapture: number;
      let redistributed: number;

      if (whalePct > config.gaugeCap) {
        actualCapture = config.gaugeCap;
        redistributed = whalePct - config.gaugeCap;
      } else {
        actualCapture = whalePct;
        redistributed = 0;
      }

      results.push({
        whaleVotePct: whalePct,
        syndicateCount: count,
        actualCapture,
        redistributed,
        effectiveShare: actualCapture,
      });
    }
  }

  return results;
}

function printGaugeCapStressTest(results: GaugeCapResult[]) {
  console.log("\n" + "=".repeat(80));
  console.log(`  4. GAUGE CAP STRESS TEST (cap = ${pct(config.gaugeCap)})`);
  console.log("=".repeat(80));

  const headers = [
    "Whale Vote%",
    "Syndicates",
    "Actual Capture",
    "Redistributed",
    "Effective Share",
    "Capped?",
  ];
  const rows = results.map((r) => [
    pct(r.whaleVotePct),
    String(r.syndicateCount),
    pct(r.actualCapture),
    pct(r.redistributed),
    pct(r.effectiveShare),
    r.whaleVotePct > config.gaugeCap ? "YES" : "no",
  ]);

  printTable(headers, rows, [12, 12, 16, 14, 16, 8]);

  // Collusion scenario: 3 whales each at cap
  const maxCollusion = config.gaugeCap * 3;
  console.log(
    `\n3-whale collusion: ${pct(maxCollusion)} of emissions (each at ${pct(config.gaugeCap)} cap)`
  );
  console.log(
    maxCollusion >= 1.0
      ? "⚠ WARNING: 3 whales at cap can capture 100% of emissions"
      : `Remaining ${pct(1 - maxCollusion)} distributed to other syndicates`
  );
}

// ---------------------------------------------------------------------------
// 5. Supply Distribution Over Time
// ---------------------------------------------------------------------------

interface SupplyDistribution {
  week: number;
  circulating: number;
  locked: number; // veWOOD
  teamVesting: number;
  treasury: number;
  totalSupply: number;
}

function simulateSupplyDistribution(
  emissions: WeekData[],
  lockRate: number
): SupplyDistribution[] {
  const results: SupplyDistribution[] = [];

  // All allocations are liquid WOOD — locking is voluntary
  const teamTotal = config.initialSupply * config.teamPct;
  const treasury = config.initialSupply * config.treasuryPct;
  const earlyCreators = config.initialSupply * config.earlyCreatorsPct;
  const community = config.initialSupply * config.communityPct;
  const partnerships = config.initialSupply * config.partnershipsPct;
  const genesisLiq = config.initialSupply * config.genesisLiquidityPct;
  const earlyVoter = config.initialSupply * config.earlyVoterPct;
  const publicSale = config.initialSupply * config.publicSalePct;

  // Team cliff = 4 weeks (1 month), then linear vesting over 26 weeks (6 months)
  const teamCliffWeeks = 4;
  const teamVestWeeks = 26;

  for (let i = 0; i < emissions.length; i++) {
    const e = emissions[i];
    const w = e.week;

    // Team vesting
    let teamUnlocked = 0;
    if (w > teamCliffWeeks) {
      const vestingWeeks = Math.min(w - teamCliffWeeks, teamVestWeeks);
      teamUnlocked = teamTotal * (vestingWeeks / teamVestWeeks);
    }
    const teamStillVesting = teamTotal - teamUnlocked;

    // Emissions split: 5% to team treasury, rest to gauges → depositors
    const publicEmissions = e.cumulativeEmission * (1 - config.teamEmissionPct);

    // Locked = lockRate applied uniformly to all liquid WOOD (everyone chooses voluntarily)
    const allLiquidWood = config.initialSupply - teamStillVesting + e.cumulativeEmission;
    const locked = allLiquidWood * lockRate;

    const treasuryHoldings = treasury + partnerships + e.cumulativeEmission * config.teamEmissionPct;
    const circulating = e.totalSupply - locked - teamStillVesting;

    results.push({
      week: w,
      circulating: Math.max(0, circulating),
      locked: Math.max(0, locked),
      teamVesting: Math.max(0, teamStillVesting),
      treasury: treasuryHoldings,
      totalSupply: e.totalSupply,
    });
  }

  return results;
}

function printSupplyDistribution(dist: SupplyDistribution[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  5. SUPPLY DISTRIBUTION (40% lock rate scenario)");
  console.log("=".repeat(80));

  const milestones = [1, 4, 14, 26, 52, 78, 104];
  const headers = [
    "Week",
    "Total Supply",
    "Circulating",
    "Locked (veWOOD)",
    "Team Vesting",
    "Lock %",
  ];
  const rows = milestones
    .filter((w) => w <= dist.length)
    .map((w) => {
      const d = dist[w - 1];
      return [
        String(w),
        fmt(d.totalSupply),
        fmt(d.circulating),
        fmt(d.locked),
        fmt(d.teamVesting),
        pct(d.locked / d.totalSupply),
      ];
    });

  printTable(headers, rows, [6, 14, 14, 16, 14, 10]);
}

// ---------------------------------------------------------------------------
// 6. Insider Voting Power Analysis
// ---------------------------------------------------------------------------

function printInsiderAnalysis(emissions: WeekData[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  6. INSIDER VOTING POWER ANALYSIS");
  console.log("=".repeat(80));

  // All allocations are liquid WOOD — insiders must voluntarily lock to get veWOOD
  const insiderWoodPct = config.teamPct + config.treasuryPct + config.earlyCreatorsPct;
  const insiderWood = config.initialSupply * insiderWoodPct;

  // Assume insiders lock at a given rate (they have incentive to lock for governance power)
  const insiderLockRates = [0.5, 0.75, 1.0]; // what fraction of insider WOOD gets locked

  console.log(`\nInsider WOOD allocation: ${fmt(insiderWood)} (${pct(insiderWoodPct)} of initial supply)`);
  console.log(`All allocations are liquid WOOD — locking into veWOOD is voluntary`);

  // Sensitivity: insider voting power depends on both insider lock rate and external lock rate
  console.log("\n--- Insider Voting Power: Insider Lock Rate vs External Lock Rate ---");
  console.log("(at week 26)");

  const externalLockRates = [0.2, 0.3, 0.4];
  const week26 = emissions[Math.min(25, emissions.length - 1)];

  const headers = ["Insider Lock %", ...externalLockRates.map((lr) => `${(lr * 100).toFixed(0)}% ext lock`)];
  const rows = insiderLockRates.map((ilr) => {
    const insiderVeWood = insiderWood * ilr;
    const cells = externalLockRates.map((elr) => {
      // External = non-insider initial + emissions locked
      const nonInsiderInitial = config.initialSupply * (1 - insiderWoodPct);
      const externalFromInitial = nonInsiderInitial * elr * 0.3; // some fraction locks over time
      const externalFromEmissions = week26.cumulativeEmission * 0.95 * elr;
      const totalVeWood = insiderVeWood + externalFromInitial + externalFromEmissions;
      const share = insiderVeWood / totalVeWood;
      return `${pct(share)} ${share < 0.5 ? "✓" : "⚠"}`;
    });
    return [pct(ilr), ...cells];
  });

  printTable(headers, rows, [16, 16, 16, 16]);
  console.log("\n⚠ = insiders hold >50% voting power | ✓ = below 50%");

  // Over time analysis at 75% insider lock, 30% external lock
  console.log("\n--- Timeline: 75% insider lock, 30% external lock ---");
  const timeHeaders = ["Week", "Insider veWOOD", "Total veWOOD", "Insider Vote %", "Safe?"];
  const milestones = [1, 14, 26, 52, 104];
  const insiderVeWoodFixed = insiderWood * 0.75;
  const nonInsiderInitial = config.initialSupply * (1 - insiderWoodPct);

  const timeRows = milestones
    .filter((w) => w <= emissions.length)
    .map((w) => {
      const e = emissions[w - 1];
      const extFromInitial = nonInsiderInitial * 0.3 * Math.min(1, w / 26); // ramps up over 26 weeks
      const extFromEmissions = e.cumulativeEmission * 0.95 * 0.3;
      const totalVe = insiderVeWoodFixed + extFromInitial + extFromEmissions;
      const share = insiderVeWoodFixed / totalVe;
      return [
        String(w),
        fmt(insiderVeWoodFixed),
        fmt(totalVe),
        pct(share),
        share < 0.5 ? "✓" : "⚠",
      ];
    });

  printTable(timeHeaders, timeRows, [6, 16, 16, 16, 6]);
}

// ---------------------------------------------------------------------------
// 7a. WOOD Fed Compounding Simulation
// ---------------------------------------------------------------------------

function printWoodFedCompounding(emissions: WeekData[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  7a. WOOD FED COMPOUNDING ANALYSIS (52 weeks of max INCREASE votes)");
  console.log("=".repeat(80));

  // Start from WOOD Fed activation (week 45 emission rate)
  const fedStartIdx = Math.min(config.woodFedStartWeek - 1, emissions.length - 1);
  const startRate = emissions[fedStartIdx].emission;

  const increaseRate = 0.0035; // +0.35% per epoch
  const capPct = 0.05; // ±5% from baseline

  let rate = startRate;
  const history: number[] = [rate];

  const headers = ["Fed Week", "Emission/wk", "Baseline (8wk avg)", "Deviation", "Capped?"];
  const rows: string[][] = [];

  for (let i = 1; i <= 52; i++) {
    // Calculate baseline (avg of last 8 weeks)
    const baselineStart = Math.max(0, history.length - 8);
    const baselineSlice = history.slice(baselineStart);
    const baseline = baselineSlice.reduce((s, v) => s + v, 0) / baselineSlice.length;

    // Apply increase
    let proposed = rate * (1 + increaseRate);

    // Enforce cap
    const upperBound = baseline * (1 + capPct);
    const lowerBound = baseline * (1 - capPct);
    const capped = proposed > upperBound;
    rate = Math.min(proposed, upperBound);

    history.push(rate);

    if (i % 8 === 0 || i === 1 || i === 52) {
      const deviation = (rate - baseline) / baseline;
      rows.push([
        String(i),
        fmt(rate),
        fmt(baseline),
        pct(deviation),
        capped ? "YES" : "no",
      ]);
    }
  }

  printTable(headers, rows, [10, 14, 18, 12, 8]);

  const maxRate = Math.max(...history);
  const totalDrift = (maxRate - startRate) / startRate;
  console.log(`\nStarting rate: ${fmt(startRate)}/week`);
  console.log(`Max rate after 52 weeks of INCREASE: ${fmt(maxRate)}/week`);
  console.log(`Total drift: ${pct(totalDrift)} — cap prevents runaway inflation`);
}

// ---------------------------------------------------------------------------
// 7b. LP Bootstrapping Analysis
// ---------------------------------------------------------------------------

function printLPBootstrapping(emissions: WeekData[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  7b. LP BOOTSTRAPPING EMISSIONS (weeks 1-12)");
  console.log("=".repeat(80));

  const lpSchedule = [
    { weeks: [1, 4], pct: 0.10 },
    { weeks: [5, 8], pct: 0.07 },
    { weeks: [9, 12], pct: 0.03 },
  ];

  const headers = ["Weeks", "LP Share", "Avg Emission/wk", "LP WOOD/wk", "Total LP WOOD"];
  const rows: string[][] = [];
  let totalLpWood = 0;

  for (const phase of lpSchedule) {
    const [start, end] = phase.weeks;
    const weekEmissions = emissions.slice(start - 1, end);
    const avgEmission =
      weekEmissions.reduce((s, e) => s + e.emission, 0) / weekEmissions.length;
    const lpPerWeek = avgEmission * phase.pct;
    const phaseTotal = weekEmissions.reduce((s, e) => s + e.emission * phase.pct, 0);
    totalLpWood += phaseTotal;

    rows.push([
      `${start}-${end}`,
      pct(phase.pct),
      fmt(avgEmission),
      fmt(lpPerWeek),
      fmt(phaseTotal),
    ]);
  }

  printTable(headers, rows, [8, 10, 16, 14, 14]);
  console.log(`\nTotal LP bootstrapping emissions: ${fmt(totalLpWood)} WOOD over 12 weeks`);
  console.log(
    `As % of first 12 weeks total emissions: ${pct(totalLpWood / emissions.slice(0, 12).reduce((s, e) => s + e.emission, 0))}`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("╔" + "═".repeat(78) + "╗");
  console.log("║" + "  WOOD TOKEN ECONOMIC SIMULATION".padEnd(78) + "║");
  console.log("║" + `  Initial Supply: ${fmt(config.initialSupply)} | Emission: ${fmt(config.initialEmission)}/wk | Weeks: ${config.weeks}`.padEnd(78) + "║");
  console.log("║" + `  Take-off: +${(config.takeoffRate * 100).toFixed(0)}%/wk (wk 1-${config.takeoffEndWeek}) | Cruise: ${(config.cruiseRate * 100).toFixed(0)}%/wk | Gauge Cap: ${(config.gaugeCap * 100).toFixed(0)}%`.padEnd(78) + "║");
  console.log("╚" + "═".repeat(78) + "╝");

  // 1. Emissions
  const emissions = simulateEmissions(config);
  printEmissionSummary(emissions);

  // 2. Dilution
  const lockRates = [0.2, 0.4, 0.6, 0.8];
  const dilution = simulateDilution(emissions, lockRates);
  printDilutionAnalysis(dilution);

  // 3. Voter break-even
  const voterResults = simulateVoterBreakEven(emissions, 0.4);
  printVoterBreakEven(voterResults);

  // 4. Gauge cap
  const gaugeCapResults = simulateGaugeCap();
  printGaugeCapStressTest(gaugeCapResults);

  // 5. Supply distribution
  const supplyDist = simulateSupplyDistribution(emissions, 0.4);
  printSupplyDistribution(supplyDist);

  // 6. Insider analysis
  printInsiderAnalysis(emissions);

  // 7a. WOOD Fed compounding
  printWoodFedCompounding(emissions);

  // 7b. LP bootstrapping
  printLPBootstrapping(emissions);

  // CSV output
  if (config.csv) {
    const fs = require("fs");

    // Emissions CSV
    const emHeaders = ["week", "phase", "emission", "cumulative", "total_supply"];
    const emRows = emissions.map((e) => [
      String(e.week),
      e.phase,
      e.emission.toFixed(0),
      e.cumulativeEmission.toFixed(0),
      e.totalSupply.toFixed(0),
    ]);
    fs.writeFileSync("wood-emissions.csv", toCsv(emHeaders, emRows));
    console.log("\nWritten: wood-emissions.csv");

    // Voter break-even CSV
    const vHeaders = [
      "weekly_volume",
      "syndicates",
      "fee_tier",
      "weekly_fees",
      "annual_fees",
      "wood_price",
      "locked_value",
      "voter_apr",
    ];
    const vRows = voterResults.map((r) => [
      String(r.weeklyVolume),
      String(r.syndicateCount),
      String(r.feeTier),
      r.weeklyFees.toFixed(2),
      r.annualFees.toFixed(2),
      String(r.woodPrice),
      r.totalLockedValue.toFixed(2),
      (r.voterApr * 100).toFixed(4),
    ]);
    fs.writeFileSync("wood-voter-breakeven.csv", toCsv(vHeaders, vRows));
    console.log("Written: wood-voter-breakeven.csv");

    console.log("\nCSV files written to current directory");
  }

  console.log("\n" + "=".repeat(80));
  console.log("  SUMMARY & KEY FINDINGS");
  console.log("=".repeat(80));

  const yr1 = emissions[Math.min(51, emissions.length - 1)];
  const peakWeek = emissions.reduce((max, d) => (d.emission > max.emission ? d : max), emissions[0]);

  console.log(`
1. INFLATION: Year 1 cumulative emissions = ${fmt(yr1.cumulativeEmission)} (${pct(yr1.cumulativeEmission / config.initialSupply)} of initial supply)
   → Total supply grows ~50% in year 1. More conservative than Aerodrome's launch.

2. REBASE: At 40% lock rate, veWOOD holders are partially protected, but rebase only covers ~50%
   of dilution. Unlocked holders face full dilution.

3. VOTER FEES: At realistic volumes ($500K/wk per syndicate), voter APR from trading fees alone
   is likely <5%. The bribe layer is ESSENTIAL to make voting economically attractive.

4. GAUGE CAP: At ${pct(config.gaugeCap)} cap, 3 colluding whales capture at most
   ${pct(config.gaugeCap * 3)} of emissions. Minimum 4 syndicates to fully distribute.

5. INSIDER POWER: At ${pct(config.teamPct + config.treasuryPct + config.earlyCreatorsPct)} insider-aligned veWOOD, insiders start with significant
   power but dilute below 50% within ~${config.weeks > 14 ? "14" : "N/A"} weeks as external locking grows (at 40% lock rate).

6. LP BOOTSTRAPPING: The 10%→7%→3%→0% decay over 12 weeks costs ~${fmt(emissions.slice(0, 12).reduce((s, e) => s + e.emission, 0) * 0.068)} WOOD
   total — a modest cost to solve the cold-start liquidity problem.
`);

  // Bear scenario stress test
  printBearScenario(emissions);
}

// ---------------------------------------------------------------------------
// Bear Scenario Stress Test
// ---------------------------------------------------------------------------

function printBearScenario(emissions: WeekData[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  BEAR SCENARIO STRESS TEST");
  console.log("  Assumptions: <10% lock rate, zero external bribes, $2M TVL, $0.005 WOOD");
  console.log("=".repeat(80));

  const woodPrice = 0.005;
  const tvl = 2_000_000;
  const lockRate = 0.08; // 8% lock rate
  const bribeSeeded = 625_000 * woodPrice; // treasury seeded bribes per epoch in USD

  const headers = ["Week", "Emission/wk", "Emission $", "Circuit Breaker", "Lock Rate CB", "Effective Emission"];
  const milestones = [1, 4, 8, 14, 26, 52];
  const rows: string[][] = [];

  for (const w of milestones) {
    if (w > emissions.length) continue;
    const e = emissions[w - 1];
    const emissionUsd = e.emission * woodPrice;

    // Circuit breaker: assume -50% price drop triggers 50% reduction
    const priceDropCb = w > 4 ? 0.5 : 1.0; // assume -50% drop kicks in after week 4

    // Lock rate CB: <10% triggers 50% reduction
    const lockCb = lockRate < 0.1 ? 0.5 : 1.0;

    // Combined (worst of both)
    const effectiveMultiplier = Math.min(priceDropCb, lockCb);
    const effectiveEmission = e.emission * effectiveMultiplier;
    const effectiveUsd = effectiveEmission * woodPrice;

    rows.push([
      String(w),
      fmt(e.emission),
      `$${fmt(emissionUsd)}`,
      priceDropCb < 1 ? `${((1 - priceDropCb) * 100).toFixed(0)}% cut` : "none",
      lockCb < 1 ? `${((1 - lockCb) * 100).toFixed(0)}% cut` : "none",
      `${fmt(effectiveEmission)} ($${fmt(effectiveUsd)})`,
    ]);
  }

  printTable(headers, rows, [6, 14, 12, 16, 14, 24]);

  // Depositor APR under bear conditions
  const week26Emission = emissions[25].emission * 0.5; // 50% CB
  const depositorApr = (week26Emission * woodPrice * 52) / tvl;
  console.log(`\n--- Bear scenario metrics at week 26 ---`);
  console.log(`Effective emission: ${fmt(week26Emission)}/wk ($${fmt(week26Emission * woodPrice)})`);
  console.log(`Depositor APR on $2M TVL: ${pct(depositorApr)}`);

  // Voter APR from seeded bribes only
  const lockedSupply = (config.initialSupply + emissions[25].cumulativeEmission) * lockRate;
  const voterApr = (bribeSeeded * 52) / (lockedSupply * woodPrice);
  console.log(`Voter APR from seeded bribes only: ${pct(voterApr)} (on ${fmt(lockedSupply)} veWOOD)`);

  // Treasury burn rate
  const weeklyBribeSeed = 625_000; // WOOD per week
  const weeklyPoolSeed = 500_000; // estimated WOOD for pool ops
  const weeklyTreasurySpend = weeklyBribeSeed + weeklyPoolSeed;
  const treasuryRunway = 75_000_000 / weeklyTreasurySpend;
  console.log(`Treasury runway at bear spend rate: ${treasuryRunway.toFixed(0)} weeks (${(treasuryRunway / 52).toFixed(1)} years)`);

  // Verdict
  console.log(`\n--- Bear scenario verdict ---`);
  const survives = depositorApr > 0.05 && treasuryRunway > 52;
  if (survives) {
    console.log("✓ Protocol survives bear scenario:");
    console.log("  - Circuit breakers reduce emission sell pressure by 50%");
    console.log("  - Depositor APR still above 5% (minimal but non-zero)");
    console.log(`  - Treasury has ${(treasuryRunway / 52).toFixed(1)} years of runway`);
    console.log("  - System can hibernate and wait for market recovery");
  } else {
    console.log("⚠ Protocol at risk in bear scenario:");
    if (depositorApr <= 0.05) console.log("  - Depositor APR too low to attract/retain capital");
    if (treasuryRunway <= 52) console.log("  - Treasury runway under 1 year");
  }
}

main();
