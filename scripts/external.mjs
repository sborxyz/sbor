/**
 * External reference rates.
 *
 * SBOR measures Stacks. These are the equivalent rates on the largest lending
 * market outside it, published beside the indices so a reader can see what the
 * same asset class costs elsewhere. They are never constituents of any SBOR
 * index and never affect a fixing.
 *
 * Source: DefiLlama pools and lend/borrow datasets. No key required.
 */
const POOLS = "https://yields.llama.fi/pools";
const BORROW_URLS = [
  "https://yields.llama.fi/lendBorrow",
  "https://yields.llama.fi/poolsBorrow"
];

/* What we compare against, and which SBOR index it sits beside. */
const WANTED = [
  { project:"aave-v3", chain:"Ethereum", symbol:"USDC",  against:"SBOR-USD", label:"Aave V3, Ethereum" },
  { project:"aave-v3", chain:"Ethereum", symbol:"WBTC",  against:"SBOR-BTC", label:"Aave V3, Ethereum" },
  { project:"aave-v3", chain:"Ethereum", symbol:"CBBTC", against:"SBOR-BTC", label:"Aave V3, Ethereum" }
];

/* Aave keys its reserve pages on the underlying token address, which the pool
   data carries, so each row links to the exact market it reports. */
const AAVE_MARKET = "proto_mainnet_v3";
const aaveUrl = underlying => underlying
  ? `https://app.aave.com/reserve-overview/?underlyingAsset=${String(underlying).toLowerCase()}&marketName=${AAVE_MARKET}`
  : "https://app.aave.com/markets/";

const round = (n, d = 2) => Number(Number(n).toFixed(d));
const log = (...a) => console.error(...a);

async function getJson(u){
  const r = await fetch(u, { headers:{ accept:"application/json" } });
  if(!r.ok) throw new Error(`${u} responded ${r.status}`);
  return r.json();
}

function borrowAprOf(rec){
  if (!rec) return null;
  for (const k of ["apyBaseBorrow","apyBorrow","borrowApy"])
    if (typeof rec[k] === "number") return rec[k];
  return null;
}

export async function externalReference(){
  const { data = [] } = await getJson(POOLS);

  let borrowRes = null;
  for (const u of BORROW_URLS){
    try { borrowRes = await getJson(u); break; } catch(e){ log(`  external borrow source ${u}: ${e.message}`); }
  }
  const list = !borrowRes ? [] : (Array.isArray(borrowRes) ? borrowRes : (borrowRes.data || []));
  const borrowBy = Object.fromEntries(list.map(b => [b.pool, b]));

  const out = [];
  for (const w of WANTED){
    /* Pick the deepest matching pool, so a small duplicate listing cannot win. */
    const matches = data.filter(p =>
      p.project === w.project &&
      p.chain === w.chain &&
      String(p.symbol).toUpperCase() === w.symbol &&
      (p.tvlUsd || 0) > 0);
    if (!matches.length){ log(`  external: no pool for ${w.symbol} on ${w.label}`); continue; }
    const p = matches.sort((a,b) => (b.tvlUsd||0) - (a.tvlUsd||0))[0];

    const apr = borrowAprOf(borrowBy[p.pool]);
    const underlying = Array.isArray(p.underlyingTokens) ? p.underlyingTokens[0] : null;
    const entry = {
      asset: p.symbol,
      venue: w.label,
      comparableTo: w.against,
      supply: round(p.apyBase ?? 0),
      borrow: apr == null ? null : round(apr),
      depthUsd: Math.round(p.tvlUsd),
      pool: p.pool,
      url: aaveUrl(underlying),
      dataUrl: `https://defillama.com/yields/pool/${p.pool}`
    };
    log(`  external ${p.symbol} @ ${w.label}: supply=${entry.supply}% borrow=${entry.borrow ?? "n/a"}% depth=${entry.depthUsd} url=${entry.url}`);
    out.push(entry);
  }
  if (!out.length) throw new Error("no external reference pools resolved");
  return {
    note: "Reference rates from the largest lending market outside Stacks, published for comparison only. These are not constituents of any SBOR index and never enter a fixing. Borrow rates are published as APR by the source and shown as read.",
    source: "DefiLlama",
    markets: out
  };
}

if (import.meta.url === `file://${process.argv[1]}`){
  externalReference()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error("FAILED:", e.message); process.exit(1); });
}
