/**
 * SBOR fixing pipeline.
 *
 * Rates are read directly from Zest's on-chain data contract, which publishes
 * both a supply APY and a borrow APY per asset. Depth comes from DefiLlama.
 * Writes api/latest.json, api/history.json and latest.txt. No API key required.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fetchCallReadOnlyFunction, contractPrincipalCV, cvToValue } from "@stacks/transactions";
import { poxReference } from "./pox.mjs";

const POOLS_URL = "https://yields.llama.fi/pools";
const STACKINGDAO_APY = "https://app.stackingdao.com/api/apy?v=2";

/* Protocol yield carried by the asset itself, not by the loan. StackingDAO
   derives it from PoX reward claims, net of pool commission, over stSTX
   supply. Published beside the lending rate, never inside the fixing. */
async function protocolYields(){
  try {
    const r = await fetch(STACKINGDAO_APY, { headers:{ accept:"application/json" } });
    if(!r.ok) throw new Error(`responded ${r.status}`);
    const d = await r.json();
    log(`  stackingdao apy payload: ${JSON.stringify(d).slice(0,400)}`);
    /* Shape is not contractually stable, so pull the first plausible number
       for each asset rather than assuming a key. */
    const pick = (...keys) => {
      for (const k of keys){
        const v = k.split(".").reduce((o,part) => o?.[part], d);
        const n = Number(v);
        if (Number.isFinite(n) && n > 0 && n < 100) return Number(n.toFixed(2));
      }
      return null;
    };
    const out = {};
    const st = pick("ststx","stStx","stSTX","apy","stx","ststx.apy","data.ststx");
    if (st !== null) out.stSTX = st;
    const sb = pick("ststxbtc","stStxBtc","stSTXbtc","btc","ststxbtc.apy","data.ststxbtc");
    if (sb !== null) out.stSTXbtc = sb;
    log(`  protocol yields resolved: ${JSON.stringify(out)}`);
    return out;
  } catch(e){
    log(`  protocol yield source unavailable, omitted. ${e.message}`);
    return {};
  }
}

/* Zest V2. Deployer, data contract, and the asset principals it keys on. */
const ZEST = {
  venue: "Zest V2",
  deployer: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7",
  dataContracts: ["v0-5-data", "v0-1-data"],   // current first, previous as fallback
  assets: [
    { symbol:"sBTC",     currency:"BTC", address:"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", contract:"sbtc-token" },
    { symbol:"USDCx",    currency:"USD", address:"SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE", contract:"usdcx" },
    { symbol:"USDh",     currency:"USD", address:"SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG", contract:"usdh-token-v1" },
    { symbol:"STX",      currency:"STX", address:"SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7", contract:"wstx" },
    { symbol:"stSTX",    currency:"STX", address:"SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG", contract:"ststx-token" },
    /* collateral only, reported but never in a fixing */
    { symbol:"stSTXbtc", currency:null,  address:"SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG", contract:"ststxbtc-token-v2" }
  ]
};

/* Granite. Single USDCx market. Rates are derived from the interest rate
   curve and current utilisation, exactly as Granite's own math SDK does. */
const GRANITE = {
  venue: "Granite",
  /* The USDCx market spans two deployments: v1 holds state-v1, the v2 upgrade
     redeployed the interest rate module. Try both for each contract. */
  deployers: [
    "SPSX722NK9V3A8D3CVQT0CDY4EBQ3E9FSDDE61FT",
    "SP3M2BYF7RGF8WKW5FVDNJ6WR8D7AR9BHDXAKPXZE"
  ],
  irContract: "linear-kinked-ir-v1",
  stateContract: "state-v1",
  asset: "USDCx",
  currency: "USD"
};
const SECONDS_IN_YEAR = 31_536_000;

/* Bump whenever the calculation changes. Every fixing records the version it
   was produced under, so any historical figure can be traced to its method. */
const METHODOLOGY_VERSION = "1.3.1";

/* Below this, on both sides at once, a funded market is not reporting. */
const RATE_FLOOR = 0.05;

/* Term averages, in days. Published only once the full window exists. */
const TERMS = [30, 90, 180];

/* Compounded average of daily fixings over a window, actual/365, the same
   construction SOFR uses for its 30, 90 and 180 day averages. Returns null
   until the window is complete, so an average is never published on partial
   data. */
function termAverage(history, label, side, days, today){
  const start = new Date(Date.parse(today) - (days - 1) * 864e5)
                  .toISOString().slice(0, 10);
  const rows = history.filter(r =>
    r.date >= start && r.date <= today &&
    r[label] && !r[label].withdrawn && typeof r[label][side] === "number");
  if (rows.length < days) return null;          // window not yet complete
  const growth = rows.reduce((a, r) => a * (1 + r[label][side] / 100 / 365), 1);
  return Number((((growth - 1) * 365 / days) * 100).toFixed(2));
}

/* DefiLlama symbol -> our symbol, for matching depth */
const DEPTH_ALIAS = { SBTC:"sBTC", USDC:"USDCx", USDH:"USDh", STX:"STX", STSTX:"stSTX", STSTXBTC:"stSTXbtc" };

const META = {
  USD: { label:"SBOR-USD", currency:"USD",
         headline:"What money costs in dollars on Stacks." },
  BTC: { label:"SBOR-BTC", currency:"BTC",
         headline:"What it costs to borrow sBTC on Stacks." },
  STX: { label:"SBOR-STX", currency:"STX",
         headline:"What money costs in STX on Stacks." }
};

const YIELD_SOURCE = {
  sBTC:  "Bitcoin protocol yield via dual stacking, paid on enrolment",
  stSTX: "PoX staking yield on the underlying, derived by StackingDAO from PoX reward claims net of pool commission"
};

const round = (n, d = 2) => Number(Number(n).toFixed(d));
/* One run per day is the official fixing and is the only run written to
   history. Other runs refresh the current reading only. */
const IS_FIXING = process.env.SBOR_FIXING === "1";
const log = (...a) => console.error(...a);
let LAST_READER = null;   // which Zest data contract answered most recently

async function depthBySymbol(){
  const r = await fetch(POOLS_URL, { headers:{ accept:"application/json" } });
  if(!r.ok) throw new Error(`pools responded ${r.status}`);
  const { data = [] } = await r.json();
  const out = {};
  for (const p of data.filter(p => p.chain === "Stacks")){
    const sym = DEPTH_ALIAS[String(p.symbol).toUpperCase()];
    if (sym && p.tvlUsd > 0) out[sym] = Math.round(p.tvlUsd);
  }
  return out;
}

async function apysFor(asset){
  let v = null, used = null, errs = [];
  for (const c of ZEST.dataContracts){
    try {
      const res = await fetchCallReadOnlyFunction({
        contractAddress: ZEST.deployer,
        contractName: c,
        functionName: "get-asset-apys",
        functionArgs: [contractPrincipalCV(asset.address, asset.contract)],
        senderAddress: ZEST.deployer,
        network: "mainnet"
      });
      v = cvToValue(res, true); used = c; break;
    } catch(e){ errs.push(`${c}: ${e.message}`); }
  }
  if (v === null) throw new Error(`no data contract answered. ${errs.join(" | ")}`);
  LAST_READER = used;
  const t = v?.value ?? v;                       // unwrap (ok ...) if present
  log(`    ${asset.symbol} via ${used}: ${JSON.stringify(v).slice(0,300)}`);
  const supply = Number(t["supply-apy"]?.value ?? t["supply-apy"]) / 100;
  const borrow = Number(t["borrow-apy"]?.value ?? t["borrow-apy"]) / 100;
  if (!Number.isFinite(supply) || !Number.isFinite(borrow))
    throw new Error(`unexpected shape: ${JSON.stringify(v).slice(0,200)}`);
  return { supply, borrow };
}

/* Read a read-only function and return the plain JS value. */
async function readOnly(address, contract, fn, args = []){
  const res = await fetchCallReadOnlyFunction({
    contractAddress: address, contractName: contract, functionName: fn,
    functionArgs: args, senderAddress: address, network: "mainnet"
  });
  return cvToValue(res, true);
}

const numOf = v => Number(v?.value ?? v);

/* Try each deployer until one answers. */
async function tryDeployers(contract, fn){
  const errs = [];
  for (const d of GRANITE.deployers){
    try {
      const v = await readOnly(d, contract, fn);
      log(`  granite ${contract}.${fn} resolved at ${d}`);
      return v;
    } catch(e){ errs.push(`${d}: ${e.message}`); }
  }
  throw new Error(`${contract}.${fn} not found. ${errs.join(" | ")}`);
}

async function graniteMarket(){
  const ir  = await tryDeployers(GRANITE.irContract, "get-ir-params");
  const st0 = await tryDeployers(GRANITE.stateContract, "get-accrue-interest-params");
  const st  = st0?.value ?? st0;

  log("  granite raw ir-params:", JSON.stringify(ir));
  log("  granite raw accrue-params:", JSON.stringify(st));

  /* on-chain fixed point: rate params use 1e12, balances use token decimals */
  const ONE12 = 1e12;
  const baseIR = numOf(ir["base-ir"]) / ONE12;
  const slope1 = numOf(ir["ir-slope-1"]) / ONE12;
  const slope2 = numOf(ir["ir-slope-2"]) / ONE12;
  const kink   = numOf(ir["utilization-kink"]) / ONE12;

  const totalAssets = numOf(st["total-assets"]);
  const openInterest = numOf(st["lp-interest"]) + numOf(st["staked-interest"]) + numOf(st["protocol-interest"]);
  /* rate curve params use 1e12; the reserve percentage uses Granite's
     SCALING-FACTOR of 1e8 */
  const ONE8 = 1e8;
  const reservePct = numOf(st["protocol-reserve-percentage"]) / ONE8;

  const ur = totalAssets > 0 ? openInterest / totalAssets : 0;
  const apr = ur < kink
    ? slope1 * ur + baseIR
    : slope2 * (ur - kink) + slope1 * kink + baseIR;

  const borrow = ((1 + apr / SECONDS_IN_YEAR) ** SECONDS_IN_YEAR - 1) * 100;
  const lpApr  = apr * (1 - reservePct) * ur;
  const supply = ur === 0 ? 0 : ((1 + lpApr / SECONDS_IN_YEAR) ** SECONDS_IN_YEAR - 1) * 100;

  log(`  granite derived: ur=${(ur*100).toFixed(2)}% apr=${(apr*100).toFixed(2)}% ` +
      `borrow=${borrow.toFixed(2)}% supply=${supply.toFixed(2)}% reservePct=${(reservePct*100).toFixed(2)}%`);

  return { borrow, supply, totalAssetsRaw: totalAssets };
}

const main = async () => {
  const depth = await depthBySymbol();
  log("depth from DefiLlama:", JSON.stringify(depth));
  const protoYield = await protocolYields();

  const markets = [];
  for (const a of ZEST.assets){
    try {
      const { supply, borrow } = await apysFor(a);
      const d = depth[a.symbol] ?? 0;
      log(`  ${a.symbol}: supply=${round(supply)}% borrow=${round(borrow)}% depth=${d}`);
      if (!a.currency){ log(`    (collateral only, excluded from fixings)`); continue; }
      if (d <= 0){ log(`    (no depth, skipped)`); continue; }
      /* Plausibility floor. A funded lending market does not price money at
         effectively nothing on both sides. When it reads that way the venue is
         not reporting, so the market is treated as unreadable rather than as
         a real rate of zero. */
      if (borrow < RATE_FLOOR && supply < RATE_FLOOR){
        log(`    (both rates below the ${RATE_FLOOR}% plausibility floor, treated as unreadable and excluded)`);
        continue;
      }
      markets.push({
        venue: ZEST.venue, asset: a.symbol, currency: a.currency,
        borrow: round(borrow), supply: round(supply),
        ...(protoYield[a.symbol] != null && { protocolYield: protoYield[a.symbol] }),
        ...(YIELD_SOURCE[a.symbol] && { protocolYieldSource: YIELD_SOURCE[a.symbol] }),
        depthUsd: d, phaseIn: 1
      });
    } catch(e){
      log(`  ${a.symbol}: read failed, excluded. ${e.message}`);
    }
  }
  /* Granite, USDCx market. Depth read on-chain, USDCx is dollar denominated. */
  try {
    const g = await graniteMarket();
    const depthUsd = Math.round(g.totalAssetsRaw / 1e6);   // USDCx has 6 decimals
    if (depthUsd > 0 && Number.isFinite(g.borrow) && Number.isFinite(g.supply)){
      log(`  Granite ${GRANITE.asset}: supply=${round(g.supply)}% borrow=${round(g.borrow)}% depth=${depthUsd}`);
      markets.push({
        venue: GRANITE.venue, asset: GRANITE.asset, currency: GRANITE.currency,
        borrow: round(g.borrow), supply: round(g.supply),
        depthUsd, phaseIn: 1
      });
    } else {
      log(`  Granite: implausible values, excluded. depth=${depthUsd} borrow=${g.borrow} supply=${g.supply}`);
    }
  } catch(e){
    log(`  Granite: read failed, excluded. ${e.message}`);
  }

  if (!markets.length) throw new Error("No markets could be read. Aborting rather than writing an empty fixing.");

  const indices = {};
  for (const cur of Object.keys(META)){
    const ms = markets.filter(m => m.currency === cur)
                      .sort((a,b) => b.depthUsd - a.depthUsd);
    if (!ms.length){ log(`  ${META[cur].label}: no readable market, index omitted from this fixing`); continue; }
    const total = ms.reduce((a,m) => a + m.depthUsd * m.phaseIn, 0);
    ms.forEach(m => { m.weight = round(m.depthUsd * m.phaseIn / total, 4); });
    const venues = [...new Set(ms.map(m => m.venue))];
    const allIn = ms.reduce((a,m) => a + (m.supply + (m.protocolYield || 0)) * m.weight, 0);
    const supplyOnly = ms.reduce((a,m) => a + m.supply * m.weight, 0);
    indices[META[cur].label] = {
      ...META[cur],
      borrow: round(ms.reduce((a,m) => a + m.borrow * m.weight, 0)),
      supply: round(supplyOnly),
      allInSupply: round(allIn),
      allInSupplyDiffers: round(allIn - supplyOnly) > 0,
      ...(ms.some(m => m.protocolYieldSource && !m.protocolYield) && {
        allInSupplyIncomplete: true,
        allInSupplyNote: "One or more constituents carry protocol yield that has no programmatic source today, so it is not included in this figure. allInSupply therefore equals the lending rate and understates what a supplier receives. See the market entries for which assets are affected."
      }),
      venues,
      largestConstituentWeight: round(Math.max(...ms.map(m => m.weight)), 4),
      markets: ms.map(({ currency, ...rest }) => rest)
    };
  }

  /* PoX staking yield. Published beside the lending indices, never inside them.
     A failure here must not stop the fixing. */
  let pox = null;
  try { pox = await poxReference(); log(`  PoX reference: ${pox.apy}% APY (cycle ${pox.cycle})`); }
  catch(e){ log(`  PoX reference unavailable, omitted. ${e.message}`); }

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const day = stamp.slice(0,10);

  const latest = {
    name:"SBOR",
    description:"Stacks Bitcoin Offered Rate. Benchmark lending rate for Stacks. Public good, free to reference.",
    url:"https://sbor.xyz",
    bns:["sbor.btc","sbor.stx"],
    fixing: stamp,
    methodologyVersion: METHODOLOGY_VERSION,
    isDailyFixing: IS_FIXING,
    basis:"APY, annually compounded",
    ...(LAST_READER && { zestDataContract: LAST_READER }),
    method:"https://sbor.xyz/llms.txt",
    source:"Lending rates read from Zest v0-5-data and Granite contract state on Stacks mainnet. Zest depth from DefiLlama, Granite depth read on-chain. Protocol yield from StackingDAO. BTC to STX rate for the staking reference from Bitflow.",
    indices,
    ...(pox && { poxReference: pox }),
    notes:[
      "The fixing is published once daily at 11:00 UTC.",
      "Rates are read from contract state, not from any venue's published figure.",
      "Protocol yield belongs to the asset, not the loan, and is excluded from every fixing.",
      "Currencies are never blended into a single figure.",
      "stSTXbtc is collateral only and is excluded from all fixings.",
      "Rates are quoted on the instrument actually lent. SBOR-BTC measures sBTC, not native bitcoin. SBOR-USD measures USDCx and USDh, not bank dollars.",
      "poxReference is a staking yield, not a lending rate. It is published beside the indices and never blended into them.",
      "A funded market whose borrow and supply rates both read below 0.05% is treated as not reporting and excluded from the fixing, rather than published as a rate of effectively zero.",
      "termAverages are compounded averages of the daily fixings over 30, 90 and 180 days, actual/365, the same construction SOFR uses. An average is null until its full window of fixings exists.",
      "allInSupply adds protocol yield to the lending rate, which is what a supplier actually receives. The fixing itself is the lending rate alone, because protocol yield comes from the asset and can change or end independently of the lending market.",
      "Protocol yield for stSTX and stSTXbtc is sourced from StackingDAO, which derives it from PoX reward claims net of pool commission over stSTX supply. Where a source cannot be reached, the index is marked allInSupplyIncomplete and the yield is left out rather than estimated.",
      "The stBTC figure published by StackingDAO is a placeholder until bond rewards begin streaming, so it is deliberately not read here."
    ]
  };

  const payload = { schema: "sbor.v1", ...latest };
  mkdirSync("api/v1", { recursive:true });
  writeFileSync("api/v1/latest.json", JSON.stringify(payload, null, 2) + "\n");
  writeFileSync("api/latest.json", JSON.stringify(payload, null, 2) + "\n");  // unversioned alias

  const lines = [
    `SBOR fixing ${stamp}`,
    `currency  borrow%  supply%`,
    ...Object.entries(indices).map(([k,v]) =>
      `${k.padEnd(9)} ${String(v.borrow).padEnd(8)} ${v.supply}`),
    `basis=APY source=https://sbor.xyz/api/latest.json`
  ];
  writeFileSync("latest.txt", lines.join("\n") + "\n");

  if (IS_FIXING){
    let history = [];
    try { history = JSON.parse(readFileSync("api/v1/history.json","utf8")); }
    catch { try { history = JSON.parse(readFileSync("api/history.json","utf8")); } catch {} }
    history = history.filter(r => r.date !== day);
    history.push({
      date: day,
      fixedAt: stamp,
      methodologyVersion: METHODOLOGY_VERSION,
      ...(pox && { "SBOR-POX": { apy: pox.apy, cycle: pox.cycle } }),
      ...Object.fromEntries(Object.entries(indices).map(([k,v]) => [k, {
        borrow: v.borrow, supply: v.supply,
        venues: v.venues.length,
        largestConstituentWeight: v.largestConstituentWeight,
        depthUsd: v.markets.reduce((a,m)=>a+m.depthUsd,0)
      }]))
    });
    history.sort((a,b) => a.date.localeCompare(b.date));

    /* Term averages, computed from the record including today's fixing. */
    for (const [label, ix] of Object.entries(indices)){
      const avg = {};
      for (const d of TERMS){
        const b = termAverage(history, label, "borrow", d, day);
        const sup = termAverage(history, label, "supply", d, day);
        avg[`d${d}`] = (b === null && sup === null) ? null : { borrow: b, supply: sup };
      }
      ix.termAverages = avg;
      const first = history.find(r => r[label] && !r[label].withdrawn);
      if (first) ix.seriesBegan = first.date;
    }
    const withAverages = { schema:"sbor.v1", ...latest, indices };
    writeFileSync("api/v1/latest.json", JSON.stringify(withAverages, null, 2) + "\n");
    writeFileSync("api/latest.json", JSON.stringify(withAverages, null, 2) + "\n");

    const hist = JSON.stringify(history, null, 2) + "\n";
    writeFileSync("api/v1/history.json", hist);
    writeFileSync("api/history.json", hist);

    /* Full immutable snapshot of the day, so any past fixing can be audited
       down to its individual constituents rather than just its headline. */
    mkdirSync("api/v1/archive", { recursive:true });
    writeFileSync(`api/v1/archive/${day}.json`, JSON.stringify(withAverages, null, 2) + "\n");
    console.log(`archived api/v1/archive/${day}.json`);
    console.log(`daily fixing recorded, history rows: ${history.length}`);
  } else {
    console.log("intraday refresh, history unchanged");
  }

  console.log(lines.join("\n"));
};

main().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
