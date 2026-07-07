'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MongoMemoryServer } = require('mongodb-memory-server');

test('runCycle (DRY_RUN): claim, buy 75%, send 70% of tokens to Ansem, burn 5%', async () => {
  process.env.DRY_RUN = 'true';
  process.env.SIMULATE_GRADUATED = 'true';
  process.env.TOKEN_MINT = 'Amens111111111111111111111111111111111111'; // $AMENS
  process.env.REWARD_WALLET = 'GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52'; // the Ansem wallet
  delete require.cache[require.resolve('../config')];
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB = 'amens_test_cycle';
  const db = require('../db/index');
  const repo = require('../db/repository');
  const simvault = require('../solana/simvault');
  const { runCycle } = require('./cycle');
  await db.connect();
  try {
    simvault.reset(1.0); // creator-fee vault has 1 SOL to claim
    const cycle = await runCycle();
    assert.strictEqual(cycle.status, 'complete');
    assert.strictEqual(cycle.mode, 'buyback');
    assert.strictEqual(cycle.sol_claimed, 1.0);
    assert.strictEqual(cycle.sol_spent_buy, 0.75, 'buys with 75% of the claim');

    const names = cycle.steps.map((s) => s.name);
    assert.deepStrictEqual(names, ['claim', 'buy', 'airdrop', 'burn']);

    // 70% of the bought tokens → Ansem, 5% → burned, 25% stays.
    const bought = cycle.tokens_bought;
    const airdropStep = cycle.steps.find((s) => s.name === 'airdrop');
    const burnStep = cycle.steps.find((s) => s.name === 'burn');
    assert.ok(Math.abs(airdropStep.detail.tokensSent - bought * 0.7) < 1, '70% sent');
    assert.ok(Math.abs(burnStep.detail.tokensBurned - bought * 0.05) < 1, '5% burned');
    assert.ok(burnStep.signature.startsWith('burn_'), 'burn recorded with a signature');
    assert.ok(Math.abs(cycle.tokens_burned - bought * 0.05) < 1, 'cycle carries tokens_burned');

    // The send goes to the single reward wallet, in $AMENS itself.
    const { items } = await repo.getAirdrops(10, 0);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].recipient, process.env.REWARD_WALLET);
    assert.strictEqual(items[0].reward_mint, process.env.TOKEN_MINT);
    assert.ok(Math.abs(items[0].amount_ui - bought * 0.7) < 1);

    // Empty vault → skipped cycle.
    const skipped = await runCycle();
    assert.strictEqual(skipped.status, 'skipped');
  } finally {
    await db.close();
    await mongod.stop();
    delete process.env.REWARD_WALLET;
    delete require.cache[require.resolve('../config')];
  }
});
