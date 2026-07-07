'use strict';

const cron = require('node-cron');
const config = require('../config');
const { runCycle } = require('./cycle');
const watcher = require('../solana/watcher');
const bus = require('../events');

const state = {
  task: null,
  paused: false,
  isRunning: false,
  lastRunAt: null,
  lastResult: null, // { id, status }
  lastDetected: null, // events found by the last scan
  startedAt: null,
};

/**
 * One timer tick (every POLL_SCHEDULE, default 1 minute): scan the wallet for
 * the dev's manual claim / buy / send-to-Ansem / burn transactions and record
 * them for the frontend. The bot never touches the chain — it only reads.
 * Skips silently (no cycle row) when there is nothing new. Overlap-guarded;
 * 'manual' bypasses pause.
 * @param {string} trigger 'poll' | 'manual'
 * @returns {Promise<{ran:boolean, detected?:number, reason?:string, cycle?:object}>}
 */
async function pollOnce(trigger) {
  if (trigger !== 'manual' && state.paused) return { ran: false, reason: 'paused' };
  if (state.isRunning) {
    console.log(`[scheduler] ${trigger} tick ignored — a cycle is already running`);
    return { ran: false, reason: 'cycle already running' };
  }

  state.isRunning = true;
  try {
    const { events, cursor } = await watcher.scan();
    state.lastDetected = events.length;

    if (events.length === 0) {
      await watcher.commitCursor(cursor); // still advance past irrelevant txs
      return { ran: false, detected: 0, reason: 'nothing new to record' };
    }

    state.lastRunAt = new Date().toISOString();
    const cycle = await runCycle(events);
    await watcher.commitCursor(cursor); // AFTER recording — dedupe covers the gap
    if (cycle.skipped) return { ran: false, detected: events.length, reason: cycle.reason };
    state.lastResult = { id: cycle.id, status: cycle.status };
    return { ran: true, detected: events.length, cycle };
  } finally {
    state.isRunning = false;
  }
}

function start() {
  if (state.task) return;
  if (!cron.validate(config.pollSchedule)) {
    throw new Error(`Invalid POLL_SCHEDULE: ${config.pollSchedule}`);
  }
  state.startedAt = new Date().toISOString();
  state.task = cron.schedule(config.pollSchedule, () => {
    pollOnce('poll').catch((err) => console.error('[scheduler] poll error:', err));
  });
  console.log(
    `[scheduler] started — watching on schedule "${config.pollSchedule}" (dryRun=${config.dryRun})`
  );
}

function pause() {
  state.paused = true;
  const s = getState();
  bus.emit('scheduler', s);
  return s;
}

function resume() {
  state.paused = false;
  const s = getState();
  bus.emit('scheduler', s);
  return s;
}

/** Manual trigger from the API — forces a tick immediately, even while paused. */
async function triggerNow() {
  const result = await pollOnce('manual');
  if (!result.ran) return { skipped: true, reason: result.reason };
  return result.cycle;
}

function getState() {
  return {
    pollSchedule: config.pollSchedule,
    paused: state.paused,
    isRunning: state.isRunning,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    lastDetected: state.lastDetected,
    startedAt: state.startedAt,
  };
}

module.exports = { start, pause, resume, triggerNow, pollOnce, getState };
