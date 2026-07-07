'use strict';

// Public, frontend-shaped endpoints for the frontend site. These emit the
// exact shapes in frontend/API_SPEC.md (GET /activity, GET /stats) so the
// frontend only has to point at these URLs — no field remapping on its side.

const express = require('express');
const repo = require('../db/repository');
const { getUnclaimedSol } = require('../services/metrics');
const { getMarketData } = require('../services/marketdata');
const { getSolPriceUsd } = require('../solana/price');
const { walletPubkey } = require('../solana/connection');
const { toPublicActivityRow, toPublicStats, toPublicSummary } = require('../services/format');
const config = require('../config');
const { nextRun } = require('../services/countdown');

const router = express.Router();

// Tiny in-memory TTL cache. The frontend polls activity ~4s and stats ~20s and
// the spec asks the backend to cache; this also de-dupes concurrent requests.
function cached(ttlMs, fn) {
  let value;
  let expires = 0;
  let inflight = null;
  return async () => {
    if (Date.now() < expires) return value;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        value = await fn();
        expires = Date.now() + ttlMs;
        return value;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}

const loadActivity = cached(3000, async () => {
  const [steps, price] = await Promise.all([repo.getAllSteps(100, 0), getSolPriceUsd()]);
  return steps.map((s) => toPublicActivityRow(s, price)); // repo returns newest-first
});

const loadStats = cached(15000, async () => {
  const [stats, unclaimed, market] = await Promise.all([
    repo.getStats(),
    getUnclaimedSol().catch(() => ({ sol: null })),
    getMarketData().catch(() => ({ tokenInLp: null, marketCap: null })),
  ]);
  return toPublicStats({
    stats,
    unclaimedSol: unclaimed.sol,
    operatingWallet: walletPubkey(),
    market,
  });
});

// GET /activity — array of transactions, newest first (API_SPEC.md §1)
router.get('/activity', async (req, res, next) => {
  try {
    res.json(await loadActivity());
  } catch (err) {
    next(err);
  }
});

// GET /stats — single object of live numbers (API_SPEC.md §2)
router.get('/stats', async (req, res, next) => {
  try {
    res.json(await loadStats());
  } catch (err) {
    next(err);
  }
});

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

// Map a frontend token tab to its reward_mint. 'OUR' is the legacy tab key for
// the main token ($AMENS). Unknown/unconfigured tokens map to a sentinel so
// the query returns empty (never an unfiltered dump).
function tokenToMint(token) {
  if (!token) return null;
  const map = {
    AMENS: config.tokenMint,
    OUR: config.tokenMint,
  };
  return map[String(token).toUpperCase()] || '__none__';
}

// GET /airdrops?limit=&offset=&token=AMENS|OUR — buyback send history,
// newest first. `token` filters by reward stream.
router.get('/airdrops', async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const token = req.query.token ? String(req.query.token).toUpperCase() : null;
    const rewardMint = tokenToMint(token);
    const { total, items } = await repo.getAirdrops(limit, offset, rewardMint);
    res.json({ total, limit, offset, token, items });
  } catch (err) {
    next(err);
  }
});

// GET /countdown — authoritative next-cycle time for a synced frontend countdown
// (cycles run on a fixed timer, default every 5 minutes). Not cached: serverTime
// must be fresh so the client can anchor to the server clock.
router.get('/countdown', (req, res) => {
  const now = Date.now();
  const { nextAirdropAt, intervalSec } = nextRun(config.pollSchedule, now);
  res.json({ serverTime: now, nextAirdropAt, intervalSec });
});

// Headline numbers for the frontend.
const loadSummary = cached(10000, async () => {
  const [stats, byMint, price, market] = await Promise.all([
    repo.getStats(),
    repo.getAirdropTotals(),
    getSolPriceUsd().catch(() => 0),
    getMarketData().catch(() => ({ marketCap: null })),
  ]);
  return toPublicSummary({
    stats,
    byMint,
    price,
    tokenMint: config.tokenMint,
    rewardWallet: config.rewardWallet,
    marketCapUsd: market.marketCap ?? null,
  });
});

// GET /summary — hero headline stats.
router.get('/summary', async (req, res, next) => {
  try {
    res.json(await loadSummary());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
