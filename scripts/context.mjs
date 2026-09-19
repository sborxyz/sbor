/**
 * Context the fixing does not need but the record should keep.
 *
 * None of this enters an index. It is recorded because a rate is easier to
 * understand later if you know what the world looked like when it was set, and
 * because a day not recorded cannot be recovered.
 *
 * Nothing here may break a fixing. Every source fails independently and is
 * simply absent if it cannot be read.
 */
import { fetchCallReadOnlyFunction, cvToValue } from "@stacks/transactions";

const SOFR   = "https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json";
/* The averages are a separate series with its own endpoint. The rate endpoint
   does not carry them, which is why they read as null if you only fetch that. */
const SOFR_AVG = "https://markets.newyorkfed.org/api/rates/secured/sofrai/last/1.json";
const PRICES = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,blockstack&vs_currencies=usd";
const HIRO   = "https://api.hiro.so";
/* npm publishes download counts openly, with no key and no account. It is the
   only adoption number SBOR can evidence without tracking anyone, which matters:
   SBOR has no registration and no logging because it does not watch who reads
   it. Recorded daily so there is a series rather than a rolling window. */
const NPM    = "https://api.npmjs.org/downloads/point";
const PKG    = "sbor-mcp";

const SBTC = { address:"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", contract:"sbtc-token" };

const round = (n,d=2) => Number(Number(n).toFixed(d));
const log = (...a) => console.error(...a);

async function getJson(u){
  const r = await fetch(u, { headers:{ accept:"application/json" } });
  if(!r.ok) throw new Error(`${u} responded ${r.status}`);
  return r.json();
}

/* SOFR. The dollar benchmark SBOR is modelled on, published by the New York
   Fed for the previous business day. Free, no key. Recorded so SBOR-USD can be
   read against the cost of a dollar secured by US government debt. */
async function sofr(){
  const d = await getJson(SOFR);
  const r = d?.refRates?.[0];
  if (!r || typeof r.percentRate !== "number") throw new Error("unexpected shape");

  /* The 30, 90 and 180 day averages are the same construction SBOR uses for its
     own term averages, so they are the only like for like comparison that
     exists. They live on a separate endpoint and are fetched separately. A
     failure here must not lose the rate itself. */
  let avg = {};
  try {
    const a = await getJson(SOFR_AVG);
    const row = a?.refRates?.[0];
    const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    if (row) avg = {
      average30day:  num(row.average30day),
      average90day:  num(row.average90day),
      average180day: num(row.average180day),
      indexValue:    num(row.index),
      averagesDate:  row.effectiveDate ?? null
    };
    log(`  sofr averages: 30d ${avg.average30day}, 90d ${avg.average90day}, 180d ${avg.average180day}`);
  } catch(e){
    log(`  sofr averages unavailable, omitted. ${e.message}`);
  }

  return {
    rate: r.percentRate,
    effectiveDate: r.effectiveDate,
    percentile1: r.percentPercentile1 ?? null,
    percentile99: r.percentPercentile99 ?? null,
    volumeBillions: r.volumeInBillions ?? null,
    ...avg,
    source: "Federal Reserve Bank of New York"
  };
}

/* Spot prices. Not used in any calculation: the fixing needs only the BTC to
   STX rate, which comes from Bitflow. These are recorded so a past fixing can
   be read in the money of its day. */
async function prices(){
  const p = await getJson(PRICES);
  const btc = Number(p.bitcoin?.usd), stx = Number(p.blockstack?.usd);
  if (!btc || !stx) throw new Error("missing a price");
  return { btcUsd: btc, stxUsd: stx, source: "CoinGecko" };
}

/* How much sBTC exists. Whether Bitcoin capital on Stacks is growing at all is
   the context every rate here sits inside. Read on-chain rather than reported. */
async function sbtcSupply(){
  const res = await fetchCallReadOnlyFunction({
    contractAddress: SBTC.address, contractName: SBTC.contract,
    functionName: "get-total-supply", functionArgs: [],
    senderAddress: SBTC.address, network: "mainnet"
  });
  const v = cvToValue(res, true);
  const raw = Number(v?.value?.value ?? v?.value ?? v);
  if (!Number.isFinite(raw)) throw new Error(`unexpected shape: ${JSON.stringify(v).slice(0,120)}`);
  return { sats: raw, sbtc: round(raw / 1e8, 8), source: "sbtc-token contract" };
}

/* Where Bitcoin was when this fixing was taken. One number, and it anchors
   every fixing to the chain it settles on. */
async function chainHeight(){
  const p = await getJson(`${HIRO}/v2/pox`);
  const burn = Number(p.current_burnchain_block_height ?? p.current_cycle?.burn_block_height);
  return {
    burnBlockHeight: Number.isFinite(burn) ? burn : null,
    rewardCycle: p.current_cycle?.id ?? null,
    stackedUstx: p.current_cycle?.stacked_ustx ?? null,
    source: "Hiro /v2/pox"
  };
}

/* Downloads of the MCP server. Not a count of agents, and it should never be
   described as one: a download is a machine fetching a package, which may be a
   person trying it once, a CI job, or a mirror. It is a floor on interest
   rather than a measure of use. */
async function npmDownloads(){
  const windows = { lastDay: "last-day", lastWeek: "last-week", lastMonth: "last-month" };
  const out = { package: PKG, source: "npm registry, api.npmjs.org" };
  for (const [key, w] of Object.entries(windows)){
    try {
      const d = await getJson(`${NPM}/${w}/${PKG}`);
      const n = Number(d?.downloads);
      if (Number.isFinite(n)) out[key] = n;
    } catch(e){ /* one window failing should not lose the others */ }
  }
  if (out.lastDay == null && out.lastWeek == null) throw new Error("no download figures returned");
  out.note = "A download is a machine fetching the package. It is a floor on interest, not a count of agents or of people.";
  return out;
}

export async function contextBlock(){
  const out = {};
  for (const [key, fn] of Object.entries({ sofr, prices, sbtcSupply, chainHeight, npmDownloads })){
    try { out[key] = await fn(); }
    catch(e){ log(`  context ${key} unavailable, omitted. ${e.message}`); }
  }
  if (out.sofr && out.prices) log(`  context: SOFR ${out.sofr.rate}% (${out.sofr.effectiveDate}), BTC $${out.prices.btcUsd}, STX $${out.prices.stxUsd}`);
  if (out.sbtcSupply) log(`  context: sBTC supply ${out.sbtcSupply.sbtc}`);
  if (out.chainHeight?.burnBlockHeight) log(`  context: burn block ${out.chainHeight.burnBlockHeight}, cycle ${out.chainHeight.rewardCycle}`);
  if (out.npmDownloads) log(`  npm ${PKG}: ${out.npmDownloads.lastDay ?? "?"} today, ${out.npmDownloads.lastWeek ?? "?"} this week, ${out.npmDownloads.lastMonth ?? "?"} this month`);
  return Object.keys(out).length ? {
    note: "Context recorded alongside the fixing. None of this enters an index or affects a rate. It is kept because a rate is easier to understand later if you know what the world looked like when it was set.",
    ...out
  } : null;
}

if (import.meta.url === `file://${process.argv[1]}`){
  contextBlock().then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error("FAILED:", e.message); process.exit(1); });
}
