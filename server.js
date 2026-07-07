'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./src/config');
const db = require('./src/db');
const { walletPubkey } = require('./src/solana/connection');
const scheduler = require('./src/jobs/scheduler');
const { getSolPriceUsd } = require('./src/solana/price');

const statusRoutes = require('./src/routes/status');
const cycleRoutes = require('./src/routes/cycles');
const controlRoutes = require('./src/routes/control');
const metricsRoutes = require('./src/routes/metrics');
const streamRoutes = require('./src/routes/stream');
const publicRoutes = require('./src/routes/public');

const app = express();

// CORS allowlist — non-browser requests (no Origin) always pass; browsers are
// restricted to config.corsOrigins (or any origin if it contains "*").
const allowAll = config.corsOrigins.includes('*');
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowAll || config.corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`origin ${origin} not allowed by CORS`));
    },
  })
);
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    name: 'amens',
    description:
      'the dev manually claims fees, buys back $AMENS, sends to the Ansem wallet, and burns — the bot watches the wallet and records every move for the frontend (every minute)',
    dryRun: config.dryRun,
    wallet: walletPubkey(),
    endpoints: [
      'GET  /activity',
      'GET  /stats',
      'GET  /airdrops',
      'GET  /api/status',
      'GET  /api/unclaimed',
      'GET  /api/stream (SSE live push)',
      'GET  /api/cycles',
      'GET  /api/cycles/:id',
      'GET  /api/transactions',
      'POST /api/run',
      'POST /api/pause',
      'POST /api/resume',
    ],
  });
});

// Built-in SSE/dashboard test page, served same-origin so it needs no CORS.
// Open http://localhost:<PORT>/sse-test in a browser.
app.get('/sse-test', (req, res) => res.sendFile(path.join(__dirname, 'docs', 'sse-test.html')));

app.use('/api', statusRoutes);
app.use('/api', cycleRoutes);
app.use('/api', controlRoutes);
app.use('/api', metricsRoutes);
app.use('/api', streamRoutes);

// Public, frontend-shaped endpoints (GET /activity, GET /stats) for the site.
app.use('/', publicRoutes);

app.use((req, res) => res.status(404).json({ error: 'not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[amens] request error:', err);
  res.status(500).json({ error: err.message });
});

let server;

async function main() {
  await db.connect();
  console.log(`[amens] MongoDB connected (${config.mongoDb})`);

  getSolPriceUsd().catch(() => {}); // warm the price cache for USD values

  server = app.listen(config.port, () => {
    console.log(`[amens] listening on http://localhost:${config.port}`);
    console.log(`[amens] dryRun=${config.dryRun} wallet=${walletPubkey()}`);
    if (config.walletIsEphemeral) {
      console.log('[amens] WARNING: using an ephemeral wallet (no WALLET_PRIVATE_KEY set) — dry run only');
    }
    scheduler.start();
  });
}

async function shutdown(signal) {
  console.log(`\n[amens] ${signal} received, shutting down`);
  if (server) server.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  console.error('[amens] failed to start:', err);
  process.exit(1);
});

module.exports = app;
