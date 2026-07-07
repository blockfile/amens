'use strict';
const test = require('node:test');
const assert = require('node:assert');

const WALLET = 'Wa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const ANSEM = 'GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52';
const MINT = 'Amens111111111111111111111111111111111111';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

function fakeTx({ signature = 'sig1', keys = [WALLET], pre = [1e9], post = [1e9], preTok = [], postTok = [], err = null }) {
  return {
    blockTime: 1751600000,
    meta: { err, preBalances: pre, postBalances: post, preTokenBalances: preTok, postTokenBalances: postTok },
    transaction: { signatures: [signature], message: { accountKeys: keys.map((k) => ({ pubkey: k })) } },
  };
}
const tokBal = (owner, mint, amount, decimals = 6) => ({ owner, mint, uiTokenAmount: { amount, decimals } });

test('classifyTransaction: buy, claim, send-to-Ansem, burn, unrelated, failed', () => {
  const { classifyTransaction } = require('./watcher');
  const ctx = { walletAddress: WALLET, tokenMint: MINT, rewardWallet: ANSEM };

  // Swap: token balance up 1,000,000 raw (=1.0 ui), SOL down 0.5 → buy
  const [buy] = classifyTransaction(
    fakeTx({ signature: 'buy1', pre: [2e9], post: [1.5e9], preTok: [tokBal(WALLET, MINT, '0')], postTok: [tokBal(WALLET, MINT, '1000000')] }),
    ctx
  );
  assert.strictEqual(buy.type, 'buy');
  assert.strictEqual(buy.tokensBought, 1);
  assert.ok(Math.abs(buy.solSpent - 0.5) < 1e-9);

  // Pump program + SOL up, no token movement → claim
  const [claim] = classifyTransaction(
    fakeTx({ signature: 'clm1', keys: [WALLET, PUMP], pre: [1e9, 0], post: [1.4e9, 0] }),
    ctx
  );
  assert.strictEqual(claim.type, 'claim');
  assert.ok(Math.abs(claim.solClaimed - 0.4) < 1e-9);

  // Manual transfer to Ansem: wallet down, Ansem up → airdrop
  const [send] = classifyTransaction(
    fakeTx({
      signature: 'snd1',
      preTok: [tokBal(WALLET, MINT, '1000000'), tokBal(ANSEM, MINT, '0')],
      postTok: [tokBal(WALLET, MINT, '300000'), tokBal(ANSEM, MINT, '700000')],
    }),
    ctx
  );
  assert.strictEqual(send.type, 'airdrop');
  assert.strictEqual(send.tokensSent, 0.7);
  assert.strictEqual(send.signature, 'snd1');

  // Manual burn: wallet down, nobody up (supply shrank) → burn
  const [burn] = classifyTransaction(
    fakeTx({ signature: 'brn1', preTok: [tokBal(WALLET, MINT, '300000')], postTok: [tokBal(WALLET, MINT, '250000')] }),
    ctx
  );
  assert.strictEqual(burn.type, 'burn');
  assert.strictEqual(burn.tokensBurned, 0.05);

  // Send to Ansem AND burn in ONE tx → two events
  const both = classifyTransaction(
    fakeTx({
      signature: 'mix1',
      preTok: [tokBal(WALLET, MINT, '1000000'), tokBal(ANSEM, MINT, '0')],
      postTok: [tokBal(WALLET, MINT, '250000'), tokBal(ANSEM, MINT, '700000')],
    }),
    ctx
  );
  assert.deepStrictEqual(both.map((e) => e.type).sort(), ['airdrop', 'burn']);
  assert.strictEqual(both.find((e) => e.type === 'burn').tokensBurned, 0.05);

  // Transfer to a RANDOM wallet (not Ansem) → nothing recorded
  const other = classifyTransaction(
    fakeTx({
      signature: 'oth1',
      preTok: [tokBal(WALLET, MINT, '1000000'), tokBal('SomeOtherWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXX', MINT, '0')],
      postTok: [tokBal(WALLET, MINT, '0'), tokBal('SomeOtherWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXX', MINT, '1000000')],
    }),
    ctx
  );
  assert.deepStrictEqual(other, []);

  // SOL up but NO pump program → not a claim; failed tx → nothing
  assert.deepStrictEqual(classifyTransaction(fakeTx({ pre: [1e9], post: [1.4e9] }), ctx), []);
  assert.deepStrictEqual(classifyTransaction(fakeTx({ err: { InstructionError: [] } }), ctx), []);
});

test('scan (DRY_RUN): emits claim → buy → send → burn per tick, matching the 75/70/5 story', async () => {
  process.env.DRY_RUN = 'true';
  process.env.DRY_RUN_FEE_PER_POLL = '0.4';
  process.env.DRY_RUN_TOKENS_PER_POLL = '100000';
  delete require.cache[require.resolve('../config')];
  delete require.cache[require.resolve('./watcher')];
  const watcher = require('./watcher');

  const { events, cursor } = await watcher.scan();
  assert.strictEqual(cursor, null);
  assert.deepStrictEqual(events.map((e) => e.type), ['claim', 'buy', 'airdrop', 'burn']);
  assert.strictEqual(events[0].solClaimed, 0.4);
  assert.strictEqual(events[1].tokensBought, 100000);
  assert.strictEqual(events[1].solSpent, 0.3); // 75% of the claim
  assert.strictEqual(events[2].tokensSent, 70000); // 70% of tokens
  assert.strictEqual(events[3].tokensBurned, 5000); // 5% of tokens
  assert.ok(events.every((e) => e.signature));

  await watcher.commitCursor(null); // no-op, must not throw without a DB
});
