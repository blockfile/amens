# AMENS — manual dev ops, watch-and-record bot

**Date:** 2026-07-07
**Status:** Approved. Supersedes `2026-07-05-amens-design.md` (the automatic
flywheel): the dev now executes everything manually; the bot only records.

## Goal

The DEV manually claims creator fees, buys $AMENS, sends tokens to the Ansem
wallet, and burns — from the operating wallet, at any venue. The bot does
NOTHING on-chain. Its only job: detect those transactions and record them to
MongoDB so the frontend displays the full story.

## The loop (every `POLL_SCHEDULE`, default `* * * * *` — 1 minute)

1. Fetch the operating wallet's new transactions since the stored cursor
   (`getSignaturesForAddress` → `getParsedTransaction`; cursor in the `meta`
   collection; capped by `WATCH_MAX_TX_PER_SCAN`).
2. Classify each transaction by balance deltas (one tx can yield two events):
   - wallet token balance **up** → `buy` (tokensBought + solSpent)
   - Ansem wallet token balance **up** → `airdrop` (manual send; also inserts
     an `airdrops` row so `GET /airdrops` and the summary total keep working)
   - mint supply-side total **down** → `burn` (tokensBurned)
   - pump.fun program + wallet SOL **up**, no token movement → `claim`
   - transfers to any OTHER wallet, and everything else → ignored
3. Nothing new → skip silently (no cycle row).
4. Otherwise record one cycle (`mode: 'manual'`) with one step per event, each
   carrying the REAL on-chain signature (Solscan-linkable), deduped by
   signature so rescans can never double-record. Cursor advances after
   recording.

## Tokenomics (executed by the dev, displayed by the app)

75% of claimed fees buy back $AMENS; of the bought tokens 70% → Ansem, 5% →
burned; the rest stays in the operating wallet. `BUYBACK_PCT` / `ANSEM_PCT` /
`BURN_PCT` drive only the status display and the dry-run simulation.

## Dry run

`DRY_RUN=true` emits one full simulated manual sequence per tick — claim 0.4
SOL → buy 100,000 → send 70,000 to Ansem → burn 5,000 — so the frontend can be
demoed with zero funds and no RPC.

## Caveats

- Manual actions must come from the operating wallet (`WALLET_PRIVATE_KEY`'s
  address) or the watcher can't see them.
- First boot initializes the cursor to "now" — no history backfill.
- Live mode needs a decent RPC (Helius/QuickNode) for transaction parsing.
