# AMENS — automatic buyback, Ansem delivery, burn

**Date:** 2026-07-05
**Status:** Approved (rebrand of blacktrolls; backup: git tag `blacktroll-final` + zip)

## Goal

Fully automatic $AMENS flywheel — no manual claiming or buying. Every 5 minutes
the bot claims whatever pump.fun creator fees have accrued and recycles them.

## The cycle (every `POLL_SCHEDULE`, default `*/5 * * * *`)

For a claim of 1 SOL:

1. **Claim** the creator fees (skips silently when the vault is empty — no cycle row).
2. **Buy** $AMENS with `BUYBACK_PCT`% of the claim (75% → 0.75 SOL). Route:
   bonding curve pre-graduation, PumpSwap AMM post-graduation, Jupiter fallback.
3. **Split the bought tokens**:
   - `ANSEM_PCT`% (70%) → `REWARD_WALLET` (the Ansem wallet)
   - `BURN_PCT`% (5%) → burned on-chain (SPL burn — supply reduction)
   - the remaining 25% of tokens stays in the operating wallet
4. The unspent 25% of the claimed SOL also stays in the operating wallet
   (marketing budget + transaction fees). No marketing wallet transfer.

Steps recorded per cycle: `claim → buy → airdrop → burn`. Cycle row carries
`sol_claimed`, `sol_spent_buy`, `tokens_bought`, `tokens_burned`, `mode: 'buyback'`.

## What changed vs. blacktrolls

- Watcher / sweep / simwallet model **deleted** — the bot claims and buys itself
  (restored from the pre-sweep design, plus the burn + split).
- New `src/solana/burn.js` — `burnToken(mint, amountRaw)` via
  `createBurnCheckedInstruction`; dry-run fakes the signature.
- Config: `BUYBACK_PCT=75` (% of claim spent on the buy), `ANSEM_PCT=70` and
  `BURN_PCT=5` (% **of the bought tokens**), `POLL_SCHEDULE=*/5 * * * *`.
- All naming/copy: AMENS / $AMENS. `TOKEN_SYMBOL` default `AMENS`.
- Public API shape unchanged (frontend keeps working); activity rows gain the
  `burn` type with `amountTokens`; stats gain `total_tokens_burned`.

## Dry run

`DRY_RUN=true` (default) simulates the fee vault (`DRY_RUN_FEE_PER_POLL` SOL per
tick), the buy, the transfer, and the burn — full cycles with zero funds/RPC.

## Accepted caveats

- Tokens accumulate in the operating wallet (25% of every buy) — that balance is
  the project's, spend/hold it manually.
- Live mode needs a funded operating wallet (creator wallet) and a paid RPC.
