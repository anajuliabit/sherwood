# CLAUDE.md — Sherwood Development Guide

## Git Workflow

**NEVER commit directly to `main`.** Always:

1. Create a feature branch: `git checkout -b <type>/<short-description>`
   - Types: `feat/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`
   - Examples: `feat/vault-lit-integration`, `fix/usdc-decimals`, `test/vault-ragequit`

2. Make atomic commits with conventional commit messages:
   - `feat: add syndicate-level caps to vault contract`
   - `fix: account for USDC 6 decimals in deposit math`
   - `test: vault ragequit returns pro-rata shares`
   - `docs: update README with Lit integration architecture`

3. Push the branch and create a PR with the template (auto-loaded from `.github/`)

4. PR description must include:
   - Which package is touched (`contracts`, `cli`, `app`)
   - What changed (adds / fixes / refactors)
   - How it was tested (forge test output, manual steps, etc.)

5. Never force push, never delete branches, never rewrite history.

## Project Structure

```
contracts/   Foundry — Solidity smart contracts
cli/         TypeScript CLI (viem, Lit SDK)
app/         Next.js dashboard
```

## Contracts

- Solidity 0.8.28, Foundry, OpenZeppelin upgradeable (UUPS)
- USDC on Base has **6 decimals** not 18 — always account for this
- Use SafeERC20 for all token transfers
- Run `forge build` and `forge test` before every PR
- Run `forge fmt` before committing

## CLI

- TypeScript, viem for chain interaction, Lit SDK for agent permissions
- Provider pattern: each DeFi protocol = a provider with standard interface
- `npm run typecheck` before every PR

## Testing

- Contracts: Foundry tests in `contracts/test/`, fork tests for protocol integrations
- CLI: vitest (when wired up)
- Always include test results in PR description

## Key Addresses (Base)

- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals)
- Moonwell Comptroller: `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C`
- Uniswap V3 SwapRouter: `0x2626664c2603336E57B271c5C0b26F421741e481`
- Multicall3: `0xcA11bde05977b3631167028862bE2a173976CA11`

## Safety

- All vault contracts are UUPS upgradeable — never change storage layout order
- Two-layer permission model: on-chain caps (vault) + off-chain policies (Lit Actions)
- Agent wallets are Lit PKPs, not raw EOAs
- Syndicate-level caps are hard limits — no agent can bypass them
