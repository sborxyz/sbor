#!/usr/bin/env node
/**
 * Publishes the day's SBOR rates on Solana mainnet, as a signed memo.
 *
 * Runs after each fixing, beside the Stacks, Arc and Base publications, and
 * posts the same rows in one transaction from SBOR's Solana publisher: the
 * borrow and supply rate (basis points) and size of each SBOR index and of the
 * bitcoin-collateral USDC reference, under the fixing's date. The memo is a
 * short JSON record beginning {"sbor":1, so anyone can find SBOR's latest
 * fixing on Solana by reading the publisher's recent transactions.
 *
 * The publisher key is derived from the same secret as the other publishers
 * (ARC_PUBLISHER_KEY), with a fixed label so it is a distinct Solana key: no
 * new secret to manage. Its only use is signing these memos; it holds a little
 * SOL for fees.
 *
 *   node scripts/solana-publish.mjs           publish today's fixing
 *   node scripts/solana-publish.mjs address   print the publisher's Solana address
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

const RPCS = process.env.SOLANA_RPC ? [process.env.SOLANA_RPC] : [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com"
];
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const LABEL = "sbor-solana-publisher-v1";

const log = (...a) => console.log(...a);
const bps = x => Math.round(Number(x) * 100);

/** The Solana publisher key: a hash of the shared publisher secret and a fixed label. */
export function publisherKeypair(secret){
  const hex = String(secret || "").trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("publisher key is not 32 bytes of hex");
  const seed = createHash("sha256").update(LABEL).update(Buffer.from(hex, "hex")).digest();
  return Keypair.fromSeed(seed);
}

/** What today's fixing puts on-chain: the same rows as on the other chains. */
export function memoFrom(latest){
  const rates = {};
  for (const label of ["SBOR-USD", "SBOR-BTC", "SBOR-STX"]){
    const ix = latest.indices?.[label];
    if (!ix || typeof ix.borrow !== "number" || typeof ix.supply !== "number") continue;
    const depth = (ix.markets || []).reduce((t, m) => t + (m.depthUsd || 0), 0);
    rates[label] = [bps(ix.borrow), bps(ix.supply), Math.round(depth)];
  }
  const ref = latest.bitcoinCollateralUsdc;
  if (ref && typeof ref.borrow === "number" && typeof ref.supply === "number")
    rates["BTC-COLLATERAL-USDC"] = [bps(ref.borrow), bps(ref.supply), Math.round(ref.depthUsd || 0)];
  const date = Number(String(latest.fixing).slice(0, 10).replace(/-/g, ""));
  /* Field order is part of the record: [borrowBps, supplyBps, depthUsd]. */
  return { sbor: 1, date, fields: ["borrowBps", "supplyBps", "depthUsd"], rates, source: "https://sbor.xyz" };
}

async function connect(){
  let last;
  for (const url of RPCS){
    try { const c = new Connection(url, "confirmed"); await c.getLatestBlockhash(); return c; }
    catch(e){ last = e; }
  }
  throw last || new Error("no Solana endpoint answered");
}

async function main(){
  const kp = publisherKeypair(process.env.ARC_PUBLISHER_KEY);
  if (process.argv[2] === "address"){ log(`solana: the publisher's address is ${kp.publicKey.toBase58()}`); return; }

  const latest = JSON.parse(readFileSync("api/v1/latest.json", "utf8"));
  const memo = memoFrom(latest);
  if (!Object.keys(memo.rates).length){ log("solana: nothing to publish"); return; }
  const text = JSON.stringify(memo);

  const conn = await connect();
  /* Skip only if this exact record is already the publisher's latest memo; a
     corrected fixing on the same day is published again. */
  const recent = await conn.getSignaturesForAddress(kp.publicKey, { limit: 10 });
  const last = recent.find(s => s.memo && s.memo.includes('{"sbor":1'));
  if (last && last.memo.endsWith(text)){ log(`solana: fixing ${memo.date} already on Solana, nothing to do`); return; }

  const tx = new Transaction().add(new TransactionInstruction({
    keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM, data: Buffer.from(text, "utf8")
  }));
  const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: "confirmed" });
  log(`solana: fixing ${memo.date} published, ${Object.entries(memo.rates).map(([k, v]) => `${k} ${v[0]}/${v[1]} bps`).join(", ")}`);
  log(`solana: transaction ${sig}`);
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch(e => { console.log(`solana: not published. ${e.message}`); process.exitCode = 1; });
