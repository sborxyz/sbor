#!/usr/bin/env node
/**
 * Kamino Lend, read from its Reserve accounts on Solana.
 *
 * SBOR's Solana comparison rows came from DefiLlama until October 2026. This
 * reads Kamino the way SBOR reads Zest, Granite, Morpho and Aave: straight from
 * on-chain state. For each reserve it reads the amounts supplied and borrowed,
 * Kamino's fees, its protocol take rate and its borrow-rate curve, then applies
 * Kamino's own formulas, checked against Kamino's SDK and API on 7 Oct 2026:
 *
 *   utilization = borrowed / (available + borrowed - fees)
 *   borrow APR  = curve(utilization) + fixed host rate
 *   supply APR  = utilization x curve(utilization) x (1 - protocol take rate)
 *
 * Kamino has two kinds of reserves. A "TrueApr" reserve accrues per second, so
 * its curve rate is its annual rate. A "Legacy" reserve accrues per Solana
 * slot on a curve set for 500 ms slots; with faster slots it really earns more,
 * so its rates are scaled by 500 ms over the measured recent slot time. On
 * 7 Oct 2026, with 275 ms slots, Kamino's cbBTC reserve (Legacy) read 0.089% on
 * its curve and 0.162% in real annual terms, against Kamino's own 0.165%.
 *
 * Plain JSON-RPC over fetch, no library. Two public endpoints are tried in
 * turn. Any failure throws, and the caller keeps DefiLlama's figure.
 */

const RPCS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];

/* Kamino's main market. Each reserve is checked against its token's mint, so
   a reserve that is moved or replaced fails loudly instead of misreading. */
export const KAMINO_RESERVES = {
  USDC:  { reserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  cbBTC: { reserve: "37Jk2zkz23vkAYBT66HM2gaqJuNg2nYLsCreQAVt5MWK", mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij" }
};

const DISCRIMINATOR = "2bf2ccca1af73b7f";
const SECONDS_PER_YEAR = 365 * 24 * 3600;
const NOMINAL_SLOT_MS = 500;
const SF = 2n ** 60n;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s){
  let n = 0n;
  for (const ch of s){ const i = B58.indexOf(ch); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n){ out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const ch of s){ if (ch === "1") out.unshift(0); else break; }
  return Buffer.from(out);
}

const round = (n, d = 2) => Number(Number(n).toFixed(d));

/** Rates from a Reserve account's bytes. slotMs is needed for Legacy reserves. */
export function kaminoRates(buf, slotMs, expectedMint){
  if (!buf || buf.length !== 8624) throw new Error(`unexpected account size ${buf?.length}`);
  if (buf.subarray(0, 8).toString("hex") !== DISCRIMINATOR) throw new Error("not a Kamino reserve");
  if (expectedMint && !buf.subarray(128, 160).equals(b58decode(expectedMint))) throw new Error("reserve does not hold the expected token");
  const sf = o => Number((buf.readBigUInt64LE(o) + (buf.readBigUInt64LE(o + 8) << 64n)) * 1000000n / SF) / 1e6;
  const available = Number(buf.readBigUInt64LE(224));
  const borrowed = sf(232);
  const fees = sf(344) + sf(360) + sf(376);
  const supplied = available + borrowed - fees;
  if (!(supplied > 0)) throw new Error("reserve has no supply");
  const util = borrowed / supplied;

  const points = [];
  for (let i = 0; i < 11; i++) points.push([buf.readUInt32LE(4920 + i * 8) / 1e4, buf.readUInt32LE(4924 + i * 8) / 1e4]);
  if (points[0][0] !== 0 || points.some((p, i) => i && p[0] < points[i - 1][0])) throw new Error("unexpected rate curve");
  let curve = points[points.length - 1][1];
  for (let i = 1; i < points.length; i++){
    const [u0, r0] = points[i - 1], [u1, r1] = points[i];
    if (util <= u1){ curve = u1 === u0 ? r1 : r0 + (r1 - r0) * (util - u0) / (u1 - u0); break; }
  }
  const host = buf.readUInt16LE(4858) / 1e4;
  const take = buf[4870] / 100;
  const basis = buf[4865];
  if (basis !== 0 && basis !== 1) throw new Error(`unknown interest basis ${basis}`);
  const legacy = basis === 0;
  if (legacy && !(slotMs >= 150 && slotMs <= 800)) throw new Error(`implausible slot time ${slotMs} ms`);
  const factor = legacy ? NOMINAL_SLOT_MS / slotMs : 1;

  const borrowApr = (curve + host) * factor;
  const supplyApr = util * curve * (1 - take) * factor;
  /* Interest compounds once per accrual unit: per second for TrueApr, per
     slot for Legacy. */
  const units = legacy ? SECONDS_PER_YEAR * 1000 / slotMs : SECONDS_PER_YEAR;
  const apy = apr => (Math.pow(1 + apr / units, units) - 1) * 100;
  return {
    borrow: round(apy(borrowApr)), supply: round(apy(supplyApr)),
    borrowApr: borrowApr * 100, supplyApr: supplyApr * 100,
    utilization: round(util * 100), basis: legacy ? "Legacy" : "TrueApr", ...(legacy && { slotMs: round(slotMs, 1) })
  };
}

async function rpc(method, params){
  let last;
  for (const url of RPCS){
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch(e){ last = e; }
  }
  throw last || new Error("no Solana endpoint answered");
}

/** Recent Solana slot time in milliseconds, from the last 30 one-minute samples. */
export async function recentSlotMs(){
  const s = await rpc("getRecentPerformanceSamples", [30]);
  const slots = s.reduce((t, x) => t + x.numSlots, 0), secs = s.reduce((t, x) => t + x.samplePeriodSecs, 0);
  if (!slots) throw new Error("no performance samples");
  return secs * 1000 / slots;
}

/** Read one of SBOR's Kamino reserves by its token, e.g. "USDC" or "cbBTC". */
export async function readKaminoReserve(symbol){
  const r = KAMINO_RESERVES[symbol];
  if (!r) throw new Error(`no Kamino reserve configured for ${symbol}`);
  const acct = await rpc("getAccountInfo", [r.reserve, { encoding: "base64" }]);
  if (!acct?.value) throw new Error("reserve account not found");
  const buf = Buffer.from(acct.value.data[0], "base64");
  const legacy = buf[4865] === 0;
  return kaminoRates(buf, legacy ? await recentSlotMs() : null, r.mint);
}

if (import.meta.url === `file://${process.argv[1]}`){
  for (const s of Object.keys(KAMINO_RESERVES)){
    try { const r = await readKaminoReserve(s); console.log(`Kamino ${s}: borrow ${r.borrow}%, supply ${r.supply}%, utilization ${r.utilization}% (${r.basis}${r.slotMs ? `, ${r.slotMs} ms slots` : ""})`); }
    catch(e){ console.log(`Kamino ${s}: not read. ${e.message}`); }
  }
}
