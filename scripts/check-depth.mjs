#!/usr/bin/env node
/**
 * How DefiLlama reports depth for Stacks lending pools.
 *
 * Written 23 September 2026 to answer two questions before touching the
 * methodology:
 *
 * 1. fetch.mjs takes Zest's depth from any Stacks pool on DefiLlama whose
 *    symbol matches, with no check on the project. If more than one project
 *    lists the same symbol, the last in the list wins. Which project does
 *    each figure actually come from?
 *
 * 2. For Aave, DefiLlama's tvlUsd turned out to be supplied minus borrowed,
 *    what is left to borrow, not the size of the market. Granite's depth is
 *    read on-chain as total assets, everything supplied. If Zest's figure is
 *    the other kind, SBOR-USD weights its two venues on different measures.
 *
 * Read only. Prints, writes nothing.
 */
const POOLS = "https://yields.llama.fi/pools";
const BORROW = ["https://yields.llama.fi/lendBorrow", "https://yields.llama.fi/poolsBorrow"];
const DEPTH_ALIAS = { SBTC:"sBTC", USDC:"USDCx", USDH:"USDh", STX:"STX", STSTX:"stSTX", STSTXBTC:"stSTXbtc" };

const get = async u => { const r = await fetch(u, { headers:{ accept:"application/json" } }); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); };
const m = n => (n == null || !Number.isFinite(Number(n))) ? "n/a".padStart(10) : ("$" + (Number(n) / 1e6).toFixed(2) + "M").padStart(10);

const pools = (await get(POOLS)).data || [];
let borrowRows = [];
for (const u of BORROW){ try { const j = await get(u); borrowRows = Array.isArray(j) ? j : (j.data || []); if (borrowRows.length) break; } catch {} }
const byPool = Object.fromEntries(borrowRows.map(r => [r.pool, r]));

const stacks = pools.filter(p => p.chain === "Stacks");
console.log(`\nEvery Stacks pool on DefiLlama (${stacks.length}), in the order fetch.mjs sees them.\n`);
console.log("project".padEnd(22) + "symbol".padEnd(12) + "tvlUsd".padStart(10) + "supplied".padStart(11) + "borrowed".padStart(11) + "  sup-bor".padStart(11) + "  tvl is");

const picked = {};
for (const p of stacks){
  const b = byPool[p.pool];
  const sup = Number(b?.totalSupplyUsd), bor = Number(b?.totalBorrowUsd);
  let kind = "no supply/borrow data";
  if (Number.isFinite(sup) && Number.isFinite(bor) && sup > 0){
    const avail = sup - bor;
    kind = Math.abs(p.tvlUsd - avail) / Math.max(avail, 1) < 0.02 ? "what is left to borrow"
         : Math.abs(p.tvlUsd - sup) / sup < 0.02 ? "total supplied"
         : "neither, check";
    console.log(p.project.slice(0, 21).padEnd(22) + String(p.symbol).slice(0, 11).padEnd(12) + m(p.tvlUsd) + m(sup).padStart(11) + m(bor).padStart(11) + m(avail).padStart(11) + "  " + kind);
  } else {
    console.log(p.project.slice(0, 21).padEnd(22) + String(p.symbol).slice(0, 11).padEnd(12) + m(p.tvlUsd) + "".padStart(33) + "  " + kind);
  }
  const alias = DEPTH_ALIAS[String(p.symbol).toUpperCase()];
  if (alias && p.tvlUsd > 0) picked[alias] = { project: p.project, tvlUsd: Math.round(p.tvlUsd), kind };
}

console.log("\nWhat fetch.mjs ends up using as depth, since the last matching pool wins:\n");
for (const [a, v] of Object.entries(picked)) console.log(`  ${a.padEnd(9)} ${m(v.tvlUsd)}  from ${v.project}, which is ${v.kind}`);
console.log("\nGranite's depth in SBOR is read on-chain as total-assets, which is total supplied.\n");
