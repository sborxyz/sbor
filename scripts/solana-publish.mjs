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
/* SBOR's own Solana program, which stores the latest rates in one account so
   other programs can read them. Empty until deployed; then each fixing is
   posted to it in the same transaction as the memo. */
const SBOR_PROGRAM = process.env.SOLANA_PROGRAM || "85uzArk6VwzWG6mxZC7D2jLEPGhFL2SXzJs7P9zQUSz9";   // deployed 7 October 2026
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

/** The program's publish instruction: tag 1, date u32, count u8, then per
    row a 32-byte key, borrow u16, supply u16 and depth u64, little-endian. */
export function programData(memo){
  const rows = Object.entries(memo.rates);
  const b = Buffer.alloc(1 + 4 + 1 + rows.length * 44);
  b.writeUInt8(1, 0); b.writeUInt32LE(memo.date, 1); b.writeUInt8(rows.length, 5);
  rows.forEach(([label, [borrow, supply, depth]], i) => {
    const o = 6 + i * 44;
    Buffer.from(label.padEnd(32, "\0"), "utf8").copy(b, o, 0, 32);
    b.writeUInt16LE(borrow, o + 32); b.writeUInt16LE(supply, o + 34);
    b.writeBigUInt64LE(BigInt(depth), o + 36);
  });
  return b;
}

/** The program's account, decoded: "SBORFIX1", owner, publisher, bump,
    count, then rows of key [32], date u32, borrow u16, supply u16, depth
    u64, published_at i64. */
export function decodeState(buf){
  if (!buf || buf.length < 74 || buf.subarray(0, 8).toString("utf8") !== "SBORFIX1") return null;
  const rows = {};
  for (let j = 0; j < buf[73]; j++){
    const o = 74 + j * 56;
    const key = buf.subarray(o, o + 32).toString("utf8").replace(/\0+$/, "");
    rows[key] = [buf.readUInt32LE(o + 32), buf.readUInt16LE(o + 36), buf.readUInt16LE(o + 38), Number(buf.readBigUInt64LE(o + 40))];
  }
  return rows;
}

/** True when the program already holds exactly today's rows. */
export function programHas(rows, memo){
  if (!rows) return false;
  return Object.entries(memo.rates).every(([k, v]) => rows[k] && rows[k][0] === memo.date && rows[k][1] === v[0] && rows[k][2] === v[1] && rows[k][3] === v[2]);
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
  /* From methodology 1.13.0 (14 October 2026), the SBOR headline. The
     account holds six keys; the rates per stablecoin other than USDC are
     published in the API, not here. */
  const head = latest.bitcoinCollateralUsd;
  if (head && typeof head.borrow === "number" && typeof head.supply === "number")
    rates["BTC-COLLATERAL-USD"] = [bps(head.borrow), bps(head.supply), Math.round(head.depthUsd || 0)];
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
  /* Post only what is missing: the memo unless this exact record is already
     the publisher's latest, and the program unless its account already holds
     today's rows. A corrected fixing on the same day is posted again. */
  const recent = await conn.getSignaturesForAddress(kp.publicKey, { limit: 10 });
  const last = recent.find(s => s.memo && s.memo.includes('{"sbor":1'));
  const memoDone = !!(last && last.memo.endsWith(text));
  let programDone = true, programId, state;
  if (SBOR_PROGRAM){
    programId = new PublicKey(SBOR_PROGRAM);
    [state] = PublicKey.findProgramAddressSync([Buffer.from("sbor-fixings")], programId);
    const acct = await conn.getAccountInfo(state);
    programDone = programHas(decodeState(acct?.data), memo);
  }
  if (memoDone && programDone){ log(`solana: fixing ${memo.date} already on Solana, nothing to do`); return; }

  const tx = new Transaction();
  if (!memoDone) tx.add(new TransactionInstruction({
    keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM, data: Buffer.from(text, "utf8")
  }));
  if (!programDone) tx.add(new TransactionInstruction({
    keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }, { pubkey: state, isSigner: false, isWritable: true }],
    programId, data: programData(memo)
  }));
  const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: "confirmed" });
  log(`solana: fixing ${memo.date} published${memoDone ? "" : " as a memo"}${!memoDone && !programDone ? " and" : ""}${programDone ? "" : " to SBOR's program"}, ${Object.entries(memo.rates).map(([k, v]) => `${k} ${v[0]}/${v[1]} bps`).join(", ")}`);
  log(`solana: transaction ${sig}`);
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch(e => { console.log(`solana: not published. ${e.message}`); process.exitCode = 1; });
