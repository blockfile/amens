'use strict';

const { PublicKey } = require('@solana/web3.js');
const { createBurnCheckedInstruction } = require('@solana/spl-token');
const config = require('../config');
const { connection, wallet } = require('./connection');
const { getMintInfo, sendIxs, getAssociatedTokenAddressSync } = require('./tokens');

function fakeSig(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Burn `amountRaw` (base units) of `mint` from the operating wallet's token
 * account — a real SPL burn: total supply decreases, verifiable on-chain.
 * @returns {Promise<{signature, burnedRaw, simulated}>}
 */
async function burnToken(mint, amountRaw) {
  const raw = BigInt(amountRaw || '0');
  if (raw <= 0n) return { signature: null, burnedRaw: '0', simulated: config.dryRun };

  if (config.dryRun) {
    return { signature: fakeSig('burn'), burnedRaw: raw.toString(), simulated: true };
  }

  const mintPk = new PublicKey(mint);
  const { decimals, programId } = await getMintInfo(connection, mintPk);
  const ata = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, true, programId);
  const ix = createBurnCheckedInstruction(ata, mintPk, wallet.publicKey, raw, decimals, [], programId);
  const signature = await sendIxs(connection, wallet, [ix], { label: `burn ${raw} raw` });
  return { signature, burnedRaw: raw.toString(), simulated: false };
}

module.exports = { burnToken };
