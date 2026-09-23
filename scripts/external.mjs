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
import { readAaveReserve } from "./aave.mjs";

const POOLS = "https://yields.llama.fi/pools";

/* Chains where Aave is read from its contracts rather than from DefiLlama,
   from 23 September 2026. DefiLlama reports Aave as a simple annual rate;
   the contracts give the same rate, which is converted here to effective APY,
   the basis every SBOR index uses, so the comparison is like for like. */
const AAVE_CONTRACT_CHAINS = new Set(["Ethereum", "Base"]);
const BORROW_URLS = [
  "https://yields.llama.fi/lendBorrow",
  "https://yields.llama.fi/poolsBorrow"
];

/* Solana: chain is "Solana", and the slugs that matter are "kamino-lend" and
   "jupiter-lend". Checked 14 Sep: 89 BTC or USDC pools, 22 distinct pairs.
   Jupiter Lend holds about $481M of USDC against Kamino's $25M, so the
   deepest-pool rule picks Jupiter for dollars and Kamino for bitcoin.

   Hyperliquid appears in DefiLlama as chain "Hyperliquid L1", and HyperLend's
   project slug is "hyperlend-pooled" rather than "hyperlend". Checked 14 Sep:
   530 pools, 476 distinct project and symbol pairs. Most HyperLend pools return
   apyBase 0, so their supply side may not be populated there.

   Rootstock is deliberately absent. It is the closest comparison there is,
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
    projects:["aave-v3","moonwell","morpho-blue","compound-v3"] },
  /* Hyperliquid. UBTC is Unit's wrapped bitcoin on HyperEVM, lent on HyperLend
     and through Morpho. A chain with real traction and a bitcoin market, so the
     same comparison as cbBTC on Base. */
  { chain:"Hyperliquid L1", symbol:["UBTC","WBTC"], display:"UBTC", against:"SBOR-BTC",
    projects:["hyperlend-pooled","hyperlend","hyperbeat","morpho-blue","hyperdrive","felix-cdp"] },
  { chain:"Hyperliquid L1", symbol:["USDC","USDT0","USDE"], display:"USDC", against:"SBOR-USD",
    projects:["hyperlend-pooled","hyperlend","hyperbeat","morpho-blue","hyperdrive","felix-cdp"] },
  /* Solana. Kamino is the largest BTC lending book there, mostly cbBTC. Worth
     comparing because it is the clearest example of the pattern SBOR measures:
     a large supply of wrapped bitcoin that almost nobody borrows, so the rate
     is nothing. */
  { chain:"Solana", symbol:["CBBTC","WBTC","XBTC","ZBTC","LBTC"], display:"cbBTC", against:"SBOR-BTC",
    projects:["kamino-lend","jupiter-lend","save","solend","marginfi","drift","loopscale"] },
  { chain:"Solana", symbol:["USDC","USDT"], display:"USDC", against:"SBOR-USD",
    projects:["kamino-lend","jupiter-lend","save","solend","marginfi","drift","loopscale"] }
];

/* DefiLlama project slug to something a person would recognize. */
const VENUE_NAME = {
  "aave-v3":"Aave V3", "moonwell":"Moonwell", "morpho-blue":"Morpho",
  "compound-v3":"Compound V3", "layerbank":"LayerBank",
  "sovryn-lend":"Sovryn", "sovryn":"Sovryn",
  "tropykus-rsk":"Tropykus", "tropykus-finance":"Tropykus",
  "segment-finance":"Segment",
  "hyperlend":"HyperLend", "hyperlend-pooled":"HyperLend",
  "hyperbeat":"Hyperbeat", "hyperdrive":"Hyperdrive", "felix-cdp":"Felix",
  "kamino-lend":"Kamino", "jupiter-lend":"Jupiter Lend", "save":"Save",
  "solend":"Solend", "marginfi":"marginfi", "drift":"Drift",
  "loopscale":"Loopscale"
};

/* Where each row links. Aave keys its reserve pages on the underlying token
   address and a per-chain market name, so an Aave row links to the exact
   market it reports. Every other venue links to its DefiLlama pool page,
   which is always correct and links on to the venue. Until 22 September every
   row was built as an Aave link, including Morpho, HyperLend and Kamino, and
   Aave on Base carried the Ethereum market name, so those links were wrong. */
const AAVE_MARKETS = {
  Ethereum: "proto_mainnet_v3", Base: "proto_base_v3", Arbitrum: "proto_arbitrum_v3",
  Optimism: "proto_optimism_v3", Polygon: "proto_polygon_v3", Avalanche: "proto_avalanche_v3"
};
function venueUrl(project, chain, underlying, pool){
  const market = AAVE_MARKETS[chain];
  if (project === "aave-v3" && market && underlying)
    return `https://app.aave.com/reserve-overview/?underlyingAsset=${String(underlying).toLowerCase()}&marketName=${market}`;
  return `https://defillama.com/yields/pool/${pool}`;
}

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

/* contracts: false returns the DefiLlama figures alone. Used only by the test
   in aave.mjs, which needs something independent to compare against. */
export async function externalReference({ contracts = true } = {}){
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
    /* Depth is the right tiebreaker between two complete readings, but a
       complete smaller market beats an incomplete larger one. A borrow rate
       with no utilization beside it does not explain anything, which is the
       one thing this comparison is for. So rank on completeness first, then
       depth. Jupiter Lend on Solana is the case that forced this: $481M of
       USDC and no borrow side published at all. */
    const complete = cand => {
      const rec = borrowBy[cand.pool];
      const sup = Number(rec?.totalSupplyUsd), bor = Number(rec?.totalBorrowUsd);
      return (borrowAprOf(rec) != null ? 2 : 0)
           + (Number.isFinite(sup) && Number.isFinite(bor) && sup > 0 ? 1 : 0);
    };
    const ranked = [...matches].sort((a,b) =>
      complete(b) - complete(a) || (b.tvlUsd||0) - (a.tvlUsd||0));
    const p = ranked[0];
    const deepest = [...matches].sort((a,b) => (b.tvlUsd||0)-(a.tvlUsd||0))[0];
    if (p !== deepest)
      log(`  external: ${w.display} on ${chains[0]} using ${p.project} ` +
          `($${Math.round((p.tvlUsd||0)/1e6)}M, complete) over ${deepest.project} ` +
          `($${Math.round((deepest.tvlUsd||0)/1e6)}M, borrow side not published)`);
    const label = `${VENUE_NAME[p.project] || p.project}, ${p.chain}`;

    const bRec = borrowBy[p.pool];
    const apr = borrowAprOf(bRec);
    /* utilization: borrowed over supplied, from the same borrow dataset */
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
      url: venueUrl(p.project, p.chain, underlying, p.pool),
      dataUrl: `https://defillama.com/yields/pool/${p.pool}`,
      source: "DefiLlama"
    };

    /* Read Aave from the contract where we can. If the read fails for any
       reason, the DefiLlama figure stands and the entry says so: the
       comparison is never lost to a failed read. */
    if (contracts && p.project === "aave-v3" && AAVE_CONTRACT_CHAINS.has(p.chain) && underlying){
      try {
        const c = await readAaveReserve(p.chain, underlying);
        entry.borrow = c.borrow;
        entry.supply = c.supply;
        entry.nominalBorrow = round(c.borrowApr);
        entry.nominalSupply = round(c.supplyApr);
        if (c.utilization != null) entry.utilization = c.utilization;
        entry.source = "contract";
      } catch (e) {
        log(`  external ${entry.asset} @ ${label}: contract read failed, using DefiLlama. ${e.message}`);
      }
    }
    log(`  external ${entry.asset} @ ${label}: supply=${entry.supply}% borrow=${entry.borrow ?? "n/a"}% util=${entry.utilization ?? "n/a"}% depth=${entry.depthUsd} (${entry.source})`);
    out.push(entry);
  }
  if (!out.length) throw new Error("no external reference pools resolved");
  return {
    note: "Reference rates from the largest lending markets off this chain, published for comparison only. One market is selected per chain: a venue that publishes a borrow rate and utilization is preferred over one that does not, and depth decides between those that publish both, so the venue named can change. These are not constituents of any SBOR index and never enter a fixing. Aave on Ethereum and on Base is read from Aave's contracts and converted to effective APY, the same basis as the SBOR indices, with the simple annual rate kept as nominalBorrow and nominalSupply. The other venues come from DefiLlama and are shown as it publishes them, so they are not on quite the same basis. Each market's source field says which. depthUsd comes from DefiLlama for every venue and is used only to choose between venues.",
    source: "Aave contracts on Ethereum and Base; DefiLlama for the other venues",
    markets: out
  };
}

if (import.meta.url === `file://${process.argv[1]}`){
  externalReference()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error("FAILED:", e.message); process.exit(1); });
}
