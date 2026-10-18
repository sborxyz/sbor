#!/usr/bin/env node
/**
 * Stamps the SBOR white paper on-chain: the SHA-256 of the PDF exactly as it is
 * published on sbor.xyz, never the paper itself, on the five chains SBOR posts
 * its rates to and on Bitcoin.
 *
 *   Arc, Base, Hyperliquid  a transaction from the publisher to itself, the stamp
 *                           in its data field
 *   Solana                  a signed memo
 *   Stacks                  a small read-only contract, sbor-whitepaper-v1, whose
 *                           constant holds the hash (a transfer memo is 34 bytes,
 *                           too short for a 32-byte hash and its label)
 *   Bitcoin                 an OP_RETURN output: "SBOR WP1 " and the 32-byte hash
 *
 * The block time of each is the dated stamp. Anyone can hash the PDF and compare.
 * The rates contracts are never touched: they hold fixings and nothing else.
 *
 * One key signs everywhere, the publisher secret ARC_PUBLISHER_KEY, as the daily
 * publishers already do (Solana's key is derived from it the same way). On
 * Bitcoin it is a native SegWit address of that key, funded by hand.
 *
 *   node scripts/wp-stamp.mjs address    print every address and balance, read only
 *   node scripts/wp-stamp.mjs dry        build and sign every stamp, broadcast nothing
 *   node scripts/wp-stamp.mjs live       broadcast what is not stamped yet, write
 *                                        whitepaper-stamps.json
 *   node scripts/wp-stamp.mjs selftest   build and sign with a throwaway key, no network
 *
 * WP_FILE names the PDF (default SBOR_White_Paper_v1.pdf at the repository root).
 * A chain already in whitepaper-stamps.json for this hash is skipped, so a
 * failed run is simply run again.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const MODE = process.argv[2] || "dry";
const FILE = process.env.WP_FILE || "SBOR_White_Paper_v1.pdf";
const STAMPS = "whitepaper-stamps.json";
const TITLE = "A Reference Rate for Bitcoin-Backed Credit";
const VERSION = 1;
const PAGE = "https://sbor.xyz/whitepaper";
const log = (...a) => console.log(...a);

/* ---------- the paper ---------- */

const pdf = MODE === "selftest" ? Buffer.from("%PDF-1.7 selftest") : readFileSync(FILE);
const HASH = createHash("sha256").update(pdf).digest("hex");
const TEXT = `SBOR white paper v${VERSION} | ${TITLE} | sha256:${HASH} | ${PAGE}`;

/* ---------- the key ---------- */

const SECRET = MODE === "selftest" ? randomBytes(32).toString("hex")
  : String(process.env.ARC_PUBLISHER_KEY || "").trim().replace(/^0x/, "");
if (!/^[0-9a-fA-F]{64}$/.test(SECRET)) throw new Error("ARC_PUBLISHER_KEY is not 32 bytes of hex");

/* ---------- the record of what is already stamped ---------- */

const record = existsSync(STAMPS) ? JSON.parse(readFileSync(STAMPS, "utf8")) : null;
const done = new Set((record?.paper?.sha256 === HASH ? record.stamps : []).map(s => s.chain));
const stamps = record?.paper?.sha256 === HASH ? [...record.stamps] : [];

/* ---------- EVM: Arc, Base, Hyperliquid ---------- */

const EVM = [
  { chain: "Arc", id: 5042, symbol: "USDC", explorer: "https://explorer.arc.io/tx/",
    rpcs: ["https://rpc.mainnet.arc.io", "https://rpc.drpc.mainnet.arc.io", "https://rpc.quicknode.mainnet.arc.io", "https://rpc.blockdaemon.mainnet.arc.io"] },
  { chain: "Base", id: 8453, symbol: "ETH", explorer: "https://basescan.org/tx/",
    rpcs: ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://1rpc.io/base"] },
  { chain: "Hyperliquid", id: 999, symbol: "HYPE", explorer: "https://hyperevmscan.io/tx/",
    rpcs: ["https://rpc.hyperliquid.xyz/evm", "https://hyperliquid.drpc.org", "https://rpc.hypurrscan.io", "https://hyperliquid-json-rpc.stakely.io"] }
];

async function evm(c){
  const { createPublicClient, createWalletClient, http, fallback, defineChain, stringToHex, formatEther } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(`0x${SECRET}`);
  const data = stringToHex(TEXT);
  const chain = defineChain({ id: c.id, name: c.chain, nativeCurrency: { name: c.symbol, symbol: c.symbol, decimals: 18 }, rpcUrls: { default: { http: c.rpcs } } });
  if (MODE === "selftest"){
    const raw = await account.signTransaction({ chainId: c.id, type: "eip1559", nonce: 0, gas: 40000n,
      maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, to: account.address, value: 0n, data });
    return log(`${c.chain}: signed ${raw.length / 2 - 1} bytes from ${account.address}, data ${data.length / 2 - 1} bytes`);
  }
  const transport = fallback(c.rpcs.map(u => http(u, { timeout: 15000 })));
  const pub = createPublicClient({ chain, transport });
  const bal = await pub.getBalance({ address: account.address });
  if (MODE === "address") return log(`${c.chain}: ${account.address}, balance ${formatEther(bal)} ${c.symbol}`);
  const gas = await pub.estimateGas({ account: account.address, to: account.address, value: 0n, data });
  const price = await pub.getGasPrice();
  const cost = gas * price;
  log(`${c.chain}: from ${account.address}, gas ${gas} at ${price} wei, about ${formatEther(cost)} ${c.symbol}; balance ${formatEther(bal)} ${c.symbol}`);
  if (bal < cost * 2n) throw new Error(`${c.chain}: balance too low for the stamp`);
  if (MODE !== "live") return;
  const wallet = createWalletClient({ account, chain, transport });
  const hash = await wallet.sendTransaction({ to: account.address, value: 0n, data });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180000 });
  if (receipt.status !== "success") throw new Error(`${c.chain}: transaction ${hash} failed`);
  const block = await pub.getBlock({ blockNumber: receipt.blockNumber });
  return { chain: c.chain, kind: "transaction data", tx: hash, url: c.explorer + hash,
           block: Number(receipt.blockNumber), at: new Date(Number(block.timestamp) * 1000).toISOString() };
}

/* ---------- Solana: a signed memo ---------- */

async function solana(){
  const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
  const seed = createHash("sha256").update("sbor-solana-publisher-v1").update(Buffer.from(SECRET, "hex")).digest();
  const kp = Keypair.fromSeed(seed);
  const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  const tx = new Transaction().add(new TransactionInstruction({
    keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }], programId: MEMO, data: Buffer.from(TEXT, "utf8") }));
  if (MODE === "selftest"){
    tx.recentBlockhash = new PublicKey(randomBytes(32)).toBase58(); tx.feePayer = kp.publicKey; tx.sign(kp);
    return log(`Solana: signed ${tx.serialize().length} bytes from ${kp.publicKey.toBase58()}`);
  }
  const RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
  let last;
  for (const url of RPCS){
    try {
      const conn = new Connection(url, "confirmed");
      const bal = await conn.getBalance(kp.publicKey);
      log(`Solana: from ${kp.publicKey.toBase58()}, balance ${bal / LAMPORTS_PER_SOL} SOL, a memo costs about 0.000005 SOL`);
      if (MODE === "address") return;
      if (bal < 20000) throw new Error("Solana: balance too low for the stamp");
      if (MODE !== "live") return;
      const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: "confirmed" });
      const st = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      return { chain: "Solana", kind: "memo", tx: sig, url: `https://solscan.io/tx/${sig}`,
               block: st?.slot ?? null, at: st?.blockTime ? new Date(st.blockTime * 1000).toISOString() : null };
    } catch(e){ last = e; if (/too low/.test(e.message)) throw e; log(`Solana: ${url} failed, ${e.message}`); }
  }
  throw last;
}

/* ---------- Stacks: a read-only contract holding the hash ---------- */

const STACKS_NAME = "sbor-whitepaper-v1";
const CLARITY = `;; SBOR white paper, version ${VERSION}: "${TITLE}"
;; The SHA-256 of the PDF published at ${PAGE}.
;; This contract only holds the hash. It has no owner and nothing can change it.
(define-constant title "${TITLE}")
(define-constant version u${VERSION})
(define-constant pdf-sha256 0x${HASH})
(define-constant page "${PAGE}")
(define-read-only (get-paper) { title: title, version: version, pdf-sha256: pdf-sha256, page: page })
`;

async function stacks(){
  const { makeContractDeploy, broadcastTransaction, getAddressFromPrivateKey, ClarityVersion, PostConditionMode } = await import("@stacks/transactions");
  const key = SECRET + "01";
  const sender = getAddressFromPrivateKey(key, "mainnet");
  const fee = BigInt(process.env.STACKS_DEPLOY_FEE || 50000);   // micro-STX, 0.05 STX ceiling
  const build = nonce => makeContractDeploy({ contractName: STACKS_NAME, codeBody: CLARITY, senderKey: key,
    network: "mainnet", fee, ...(nonce != null && { nonce }), clarityVersion: ClarityVersion.Clarity3,
    postConditionMode: PostConditionMode.Deny });
  if (MODE === "selftest"){
    const tx = await build(0n);
    return log(`Stacks: signed deploy of ${sender}.${STACKS_NAME}, ${tx.serialize().length / 2} bytes`);
  }
  const H = "https://api.hiro.so";
  const bal = await (await fetch(`${H}/extended/v1/address/${sender}/stx`)).json();
  log(`Stacks: from ${sender}, balance ${Number(bal.balance) / 1e6} STX, deploy fee ceiling ${Number(fee) / 1e6} STX`);
  if (MODE === "address") return;
  const exists = await fetch(`${H}/v2/contracts/interface/${sender}/${STACKS_NAME}`);
  if (exists.ok) throw new Error(`Stacks: ${sender}.${STACKS_NAME} already exists; a new paper version needs a new contract name`);
  if (BigInt(bal.balance) < fee * 2n) throw new Error("Stacks: balance too low for the deploy");
  const tx = await build();
  log(`Stacks: deploy built, ${tx.serialize().length / 2} bytes`);
  if (MODE !== "live") return;
  const res = await broadcastTransaction({ transaction: tx, network: "mainnet" });
  if (res.error) throw new Error(`Stacks: broadcast refused, ${res.error} ${res.reason || ""}`);
  const txid = res.txid.startsWith("0x") ? res.txid : `0x${res.txid}`;
  log(`Stacks: broadcast ${txid}, waiting for a block`);
  for (let i = 0; i < 60; i++){
    await new Promise(r => setTimeout(r, 10000));
    const t = await (await fetch(`${H}/extended/v1/tx/${txid}`)).json();
    if (t.tx_status === "success")
      return { chain: "Stacks", kind: "contract", tx: txid, url: `https://explorer.hiro.so/txid/${txid}?chain=mainnet`,
               contract: `${sender}.${STACKS_NAME}`, block: t.block_height, at: new Date(t.burn_block_time * 1000).toISOString() };
    if (t.tx_status && t.tx_status !== "pending") throw new Error(`Stacks: ${txid} ended ${t.tx_status}`);
  }
  throw new Error(`Stacks: ${txid} still pending after 10 minutes; run again later, it will not deploy twice`);
}

/* ---------- Bitcoin: OP_RETURN ---------- */

async function bitcoin(){
  const btc = await import("@scure/btc-signer");
  const { secp256k1 } = await import("@noble/curves/secp256k1.js");
  const priv = Buffer.from(SECRET, "hex");
  const pay = btc.p2wpkh(secp256k1.getPublicKey(priv, true), btc.NETWORK);
  const data = Buffer.concat([Buffer.from("SBOR WP1 ", "ascii"), Buffer.from(HASH, "hex")]);   // 41 bytes, under the 80-byte standard limit
  const opReturn = btc.Script.encode(["RETURN", data]);
  const VBYTES = 165;   // one SegWit input, the OP_RETURN and a change output, rounded up
  const build = (utxos, rate) => {
    const tx = new btc.Transaction({ allowUnknownOutputs: true });   // OP_RETURN is "unknown" to the library
    let total = 0n;
    for (const u of utxos){ tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: pay.script, amount: BigInt(u.value) } }); total += BigInt(u.value); }
    const fee = BigInt(Math.ceil(rate * (VBYTES + 68 * (utxos.length - 1))));
    tx.addOutput({ script: opReturn, amount: 0n });
    const change = total - fee;
    if (change < 0n) throw new Error(`Bitcoin: ${total} sats cannot pay a ${fee}-sat fee`);
    if (change >= 546n) tx.addOutputAddress(pay.address, change, btc.NETWORK);
    tx.sign(priv); tx.finalize();
    return { tx, fee, change };
  };
  if (MODE === "selftest"){
    const { tx, fee } = build([{ txid: randomBytes(32).toString("hex"), vout: 0, value: 10000 }], 5);
    return log(`Bitcoin: signed ${tx.hex.length / 2} bytes (${tx.vsize} vB, fee ${fee} sats) from ${pay.address}, OP_RETURN ${data.length} bytes`);
  }
  const M = "https://mempool.space/api";
  const utxos = await (await fetch(`${M}/address/${pay.address}/utxo`)).json();
  const sats = utxos.reduce((t, u) => t + u.value, 0);
  log(`Bitcoin: ${pay.address}, ${sats} sats in ${utxos.length} outputs`);
  if (MODE === "address") return;
  if (!utxos.length) throw new Error(`Bitcoin: no funds yet; send about 10,000 sats to ${pay.address}`);
  const fees = await (await fetch(`${M}/v1/fees/recommended`)).json();
  const rate = Math.max(2, Number(fees.halfHourFee) || 5);
  const { tx, fee, change } = build(utxos, rate);
  log(`Bitcoin: ${tx.vsize} vB at ${rate} sat/vB, fee ${fee} sats, ${change} sats back to the same address`);
  if (MODE !== "live") return;
  const r = await fetch(`${M}/tx`, { method: "POST", body: tx.hex });
  const txid = (await r.text()).trim();
  if (!r.ok || !/^[0-9a-f]{64}$/.test(txid)) throw new Error(`Bitcoin: broadcast refused, ${txid.slice(0, 200)}`);
  log(`Bitcoin: broadcast ${txid}; the block time is recorded once it confirms (run again to fill it)`);
  return { chain: "Bitcoin", kind: "OP_RETURN", tx: txid, url: `https://mempool.space/tx/${txid}`, block: null, at: null };
}

/* ---------- run ---------- */

log(`white paper ${FILE}: ${pdf.length} bytes, sha256 ${HASH}`);
log(`stamp text: ${TEXT}`);
const jobs = [...EVM.map(c => [c.chain, () => evm(c)]), ["Solana", solana], ["Stacks", stacks], ["Bitcoin", bitcoin]];
let failed = 0;
for (const [name, job] of jobs){
  if (MODE === "live" && done.has(name)){ log(`${name}: already stamped, skipped`); continue; }
  try {
    const s = await job();
    if (s){ stamps.push(s); log(`${name}: stamped, ${s.url}`); }
  } catch(e){ failed++; log(`${name}: FAILED, ${e.message}`); }
}

/* A Bitcoin stamp broadcast earlier gets its block and time once confirmed. */
if (MODE === "live"){
  for (const s of stamps.filter(s => s.chain === "Bitcoin" && !s.at)){
    try {
      const st = await (await fetch(`https://mempool.space/api/tx/${s.tx}/status`)).json();
      if (st.confirmed){ s.block = st.block_height; s.at = new Date(st.block_time * 1000).toISOString(); log(`Bitcoin: confirmed in block ${s.block}`); }
    } catch(e){ log(`Bitcoin: status not read, ${e.message}`); }
  }
  writeFileSync(STAMPS, JSON.stringify({
    paper: { title: TITLE, version: VERSION, file: FILE, bytes: pdf.length, sha256: HASH, page: PAGE, text: TEXT },
    stamps,
    opentimestamps: { file: `${FILE}.ots`, note: "OpenTimestamps proof anchoring the same hash in Bitcoin; verify with the ots client." },
    check: `shasum -a 256 ${FILE}`
  }, null, 2) + "\n");
  log(`${STAMPS} written: ${stamps.length} stamps`);
}
if (failed) { log(`${failed} chain(s) failed; run again to stamp only those`); process.exit(1); }
