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

/* Rootstock is deliberately absent. It is the closest comparison there is,
   another Bitcoin sidechain with a bitcoin-backed asset lent on it at a similar
   scale, but DefiLlama has no lending yield adapters for the chain: its nine
   listed pools are all DEX pairs, an RWA product and a bridge. LayerBank,
   Sovryn Lend, Tropykus and Segment have TVL coverage and no rates. Including
   it means reading Rootstock contracts directly, as SBOR does for Granite.
   Do not re-add it by guessing project slugs. That has been tried.

   What we compare against, and which SBOR index it sits beside.
   Each entry lists candidate protocols rather than one, and the deepest
   matching pool wins. That way a venue losing its lead does not silently
   freeze the comparison on a shallow pool. */
const WANTED = [
  { chain:"Ethereum", symbol:"USDC",  display:"USDC",  against:"SBOR-USD",
    projects:["aave-v3"] },
  { chain:"Ethereum", symbol:"WBTC",  display:"WBTC",  against:"SBOR-BTC",
    projects:["aave-v3"] },
  { chain:"Ethereum", symbol:"CBBTC", display:"cbBTC", against:"SBOR-BTC",
    projects:["aave-v3"] },
  /* Base carries most cbBTC activity and is the closest comparison to the
     Stacks thesis: bitcoin on an Ethereum L2 against bitcoin on a Bitcoin L2. */
  { chain:"Base", symbol:"CBBTC", display:"cbBTC", against:"SBOR-BTC",
    projects:["aave-v3","moonwell","morpho-blue","compound-v3"] },
  { chain:"Base", symbol:"USDC",  display:"USDC",  against:"SBOR-USD",
    projects:["aave-v3","moonwell","morpho-blue","compound-v3"] }
];

/* DefiLlama project slug to something a person would recognise. */
const VENUE_NAME = {
  "aave-v3":"Aave V3", "moonwell":"Moonwell", "morpho-blue":"Morpho",
  "compound-v3":"Compound V3", "layerbank":"LayerBank",
  "sovryn-lend":"Sovryn", "sovryn":"Sovryn",
  "tropykus-rsk":"Tropykus", "tropykus-finance":"Tropykus",
  "segment-finance":"Segment"
};

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
    /* Deepest matching pool across the candidate protocols, so a small
       duplicate listing cannot win. */
    /* chain and symbol may each be a string or a list of acceptable values,
       because naming differs between sources and changes over time */
    const chains  = [].concat(w.chain);
    const symbols = [].concat(w.symbol).map(x => x.toUpperCase());
    const matches = data.filter(p =>
      w.projects.includes(p.project) &&
      chains.includes(p.chain) &&
      symbols.includes(String(p.symbol).toUpperCase()) &&
      (p.tvlUsd || 0) > 0);
    if (!matches.length){
      log(`  external: no ${symbols.join("/")} pool on ${chains.join("/")} among ${w.projects.join(", ")}`);
      continue;
    }
    const p = matches.sort((a,b) => (b.tvlUsd||0) - (a.tvlUsd||0))[0];
    const label = `${VENUE_NAME[p.project] || p.project}, ${p.chain}`;

    const bRec = borrowBy[p.pool];
    const apr = borrowAprOf(bRec);
    /* utilisation: borrowed over supplied, from the same borrow dataset */
    const sup = Number(bRec?.totalSupplyUsd), bor = Number(bRec?.totalBorrowUsd);
    const utilization = (Number.isFinite(sup) && Number.isFinite(bor) && sup > 0)
      ? round(bor / sup * 100) : null;
    const underlying = Array.isArray(p.underlyingTokens) ? p.underlyingTokens[0] : null;
    const entry = {
      asset: w.display || p.symbol,
      venue: label,
      comparableTo: w.against,
      supply: round(p.apyBase ?? 0),
      borrow: apr == null ? null : round(apr),
      ...(utilization != null && { utilization }),
      depthUsd: Math.round(p.tvlUsd),
      pool: p.pool,
      url: aaveUrl(underlying),
      dataUrl: `https://defillama.com/yields/pool/${p.pool}`
    };
    log(`  external ${entry.asset} @ ${label}: supply=${entry.supply}% borrow=${entry.borrow ?? "n/a"}% util=${entry.utilization ?? "n/a"}% depth=${entry.depthUsd}`);
    out.push(entry);
  }
  if (!out.length) throw new Error("no external reference pools resolved");
  return {
    note: "Reference rates from the largest lending markets off this chain, published for comparison only. The deepest pool on each chain is used, so the venue named can change. These are not constituents of any SBOR index and never enter a fixing. Rates come from DefiLlama rather than from contract state, and are shown as the source publishes them, so they are not on the same basis as the SBOR indices.",
    source: "DefiLlama",
    markets: out
  };
}

if (import.meta.url === `file://${process.argv[1]}`){
  externalReference()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error("FAILED:", e.message); process.exit(1); });
}
