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
const PRICES = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,blockstack&vs_currencies=usd";
const HIRO   = "https://api.hiro.so";

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
  return {
    rate: r.percentRate,
    effectiveDate: r.effectiveDate,
    percentile1: r.percentPercentile1 ?? null,
    percentile99: r.percentPercentile99 ?? null,
    volumeBillions: r.volumeInBillions ?? null,
    average30day: r.average30day ?? null,
    average90day: r.average90day ?? null,
    average180day: r.average180day ?? null,
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

export async function contextBlock(){
  const out = {};
  for (const [key, fn] of Object.entries({ sofr, prices, sbtcSupply, chainHeight })){
    try { out[key] = await fn(); }
    catch(e){ log(`  context ${key} unavailable, omitted. ${e.message}`); }
  }
  if (out.sofr && out.prices) log(`  context: SOFR ${out.sofr.rate}% (${out.sofr.effectiveDate}), BTC $${out.prices.btcUsd}, STX $${out.prices.stxUsd}`);
  if (out.sbtcSupply) log(`  context: sBTC supply ${out.sbtcSupply.sbtc}`);
  if (out.chainHeight?.burnBlockHeight) log(`  context: burn block ${out.chainHeight.burnBlockHeight}, cycle ${out.chainHeight.rewardCycle}`);
  return Object.keys(out).length ? {
    note: "Context recorded alongside the fixing. None of this enters an index or affects a rate. It is kept because a rate is easier to understand later if you know what the world looked like when it was set.",
    ...out
  } : null;
}

if (import.meta.url === `file://${process.argv[1]}`){
  contextBlock().then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error("FAILED:", e.message); process.exit(1); });
}
