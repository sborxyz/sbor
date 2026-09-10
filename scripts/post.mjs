/**
 * SBOR post drafter.
 *
 * Compares today's fixing with yesterday's and writes a ready-to-post draft to
 * post.txt when something actually moved. If nothing moved it writes a line
 * saying so, and you post nothing. A benchmark that posts every day about
 * nothing is noise.
 *
 * Nothing here posts anywhere. It writes a file for a human to read, copy and
 * decide on.
 *
 * Rules it follows, from the posting rules:
 *   - lead with the number, never with what SBOR is
 *   - never state a cause, only what moved
 *   - 280 characters, a link counts as 23
 *   - no em dashes
 */
import { readFileSync, writeFileSync } from "node:fs";

const LINK = "sbor.xyz";
const LINK_COST = 23;          // X counts any link as 23 characters
const LIMIT = 280;

/* Thresholds. Below these, nothing is worth saying. */
const RATE_MOVE_BPS = 25;      // a borrow or supply rate moving this much
const POX_MOVE_BPS = 50;       // the staking yield moving this much
const UTIL_HIGH = 80;          // utilisation crossing up through this
const UTIL_LOW = 20;           // or down through this

const bps = (a, b) => Math.round((a - b) * 100);
const sign = n => (n > 0 ? "+" : "") + n;
const pct = n => n.toFixed(2) + "%";

const latest = JSON.parse(readFileSync("api/v1/latest.json", "utf8"));
let history = [];
try { history = JSON.parse(readFileSync("api/v1/history.json", "utf8")); } catch {}

const today = latest.fixing.slice(0, 10);
const prior = [...history].reverse().find(r => r.date < today) || null;
const poxOf = r => r && (r["SBOR-PoX"] || r["SBOR-POX"]);

const drafts = [];

/* ---------- 1. a rate moved ---------- */
if (prior){
  for (const [label, ix] of Object.entries(latest.indices)){
    const was = prior[label];
    if (!was || was.withdrawn) continue;

    const db = typeof was.borrow === "number" ? bps(ix.borrow, was.borrow) : null;
    const ds = typeof was.supply === "number" ? bps(ix.supply, was.supply) : null;
    if (db === null && ds === null) continue;
    if (Math.abs(db ?? 0) < RATE_MOVE_BPS && Math.abs(ds ?? 0) < RATE_MOVE_BPS) continue;

    const moved = Math.abs(db ?? 0) >= Math.abs(ds ?? 0)
      ? { side: "Borrowing", now: ix.borrow, then: was.borrow, d: db, key: "borrow" }
      : { side: "Supplying", now: ix.supply, then: was.supply, d: ds, key: "supply" };

    /* name the venue with the most extreme rate on that side, factually */
    const best = [...ix.markets].sort((a, b) =>
      moved.key === "borrow" ? a.borrow - b.borrow : b.supply - a.supply)[0];

    drafts.push({
      why: `${label} ${moved.key} moved ${sign(moved.d)} bps`,
      text:
`${label} ${moved.key} rate: ${pct(moved.then)} to ${pct(moved.now)}.

${sign(moved.d)} bps in a day.

Cheapest constituent now ${best.venue} ${best.asset} at ${pct(best[moved.key])}, utilisation ${pct(best.utilization)}.

${LINK}`
    });
  }
}

/* ---------- 2. an index returned or dropped out ---------- */
if (prior){
  const nowSet = new Set(Object.keys(latest.indices));
  const wasSet = new Set(Object.keys(prior).filter(k => k.startsWith("SBOR-") && k !== "SBOR-PoX" && k !== "SBOR-POX"));
  for (const label of nowSet) if (!wasSet.has(label)) drafts.push({
    why: `${label} returned`,
    text:
`${label} is publishing again.

Borrow ${pct(latest.indices[label].borrow)}, supply ${pct(latest.indices[label].supply)}.

It was omitted while the market could not be read. SBOR leaves an index out rather than publish a figure that is not real.

${LINK}`
  });
  for (const label of wasSet) if (!nowSet.has(label)) drafts.push({
    why: `${label} dropped out`,
    text:
`${label} is not published today.

The market could not be read, so the index is omitted rather than filled in with a number that is not real.

It returns when the read does.

${LINK}`
  });
}

/* ---------- 3. the staking yield stepped ---------- */
{
  const now = latest.poxReference, was = poxOf(prior);
  if (now && was && typeof was.apy === "number"){
    const d = bps(now.apy, was.apy);
    const cycleChanged = was.cycle && now.cycle !== was.cycle;
    if (Math.abs(d) >= POX_MOVE_BPS || cycleChanged){
      drafts.push({
        why: cycleChanged ? `PoX cycle ${was.cycle} to ${now.cycle}` : `PoX moved ${sign(d)} bps`,
        text: cycleChanged
? `Reward cycle ${now.cycle} settled.

${now.btcPaid.toFixed(2)} BTC paid to STX stackers, against ${now.stxLocked.toLocaleString("en-US")} STX locked.

SBOR-PoX: ${pct(was.apy)} to ${pct(now.apy)}.

${LINK}`
: `SBOR-PoX: ${pct(was.apy)} to ${pct(now.apy)}, ${sign(d)} bps.

Same cycle, same payout. The move is the BTC to STX rate, now ${Math.round(now.stxPerBtc).toLocaleString("en-US")} STX per BTC.

${LINK}`
      });
    }
  }
}

/* ---------- 4. utilisation crossed a threshold ---------- */
if (prior){
  for (const [label, ix] of Object.entries(latest.indices)){
    for (const m of ix.markets){
      if (typeof m.utilization !== "number") continue;
      const wasIx = prior[label];
      if (!wasIx || typeof wasIx.depthUsd !== "number") continue;
      /* history rows do not carry per market utilisation, so only flag the
         extremes as a standing condition rather than a crossing */
      if (m.utilization >= UTIL_HIGH) drafts.push({
        why: `${m.venue} ${m.asset} utilisation ${m.utilization}%`,
        text:
`${m.venue} ${m.asset} is ${pct(m.utilization)} utilised.

Borrow ${pct(m.borrow)}, supply ${pct(m.supply)}.

Above 80% a lending market prices steeply, and withdrawals get harder.

${LINK}`
      });
      else if (m.utilization <= UTIL_LOW && m.depthUsd > 1e6) drafts.push({
        why: `${m.venue} ${m.asset} utilisation ${m.utilization}%`,
        text:
`${m.venue} ${m.asset}: $${(m.depthUsd/1e6).toFixed(1)}M supplied, ${pct(m.utilization)} of it borrowed.

Borrow ${pct(m.borrow)}, supply ${pct(m.supply)}.

Cheap money with capacity behind it.

${LINK}`
      });
    }
  }
}

/* ---------- 5. an inversion ----------
   A real inversion is the same asset costing less to borrow at one venue than
   it pays to supply at another. Comparing different assets is an exchange rate
   bet, not arbitrage, so assets are grouped before comparing. */
{
  const byAsset = {};
  for (const [label, ix] of Object.entries(latest.indices))
    for (const m of ix.markets)
      (byAsset[m.asset] ||= []).push({ ...m, index: label });

  for (const [asset, ms] of Object.entries(byAsset)){
    if (ms.length < 2) continue;                       // needs two venues
    /* Check every venue pair. Borrowing at one and supplying at another is the
       trade, so the best pair is not necessarily the cheapest borrow and the
       best supply, which may sit at the same venue. */
    let best = null;
    for (const borrowAt of ms)
      for (const supplyAt of ms){
        if (borrowAt.venue === supplyAt.venue) continue;
        const edge = supplyAt.supply - borrowAt.borrow;
        if (edge > 0 && (!best || edge > best.edge))
          best = { borrowAt, supplyAt, edge };
      }
    if (!best) continue;

    drafts.push({
      why: `INVERSION on ${asset}: supply ${best.supplyAt.venue} ${best.supplyAt.supply}% vs borrow ${best.borrowAt.venue} ${best.borrowAt.borrow}%`,
      text:
`${asset} is inverted across venues.

Supplying at ${best.supplyAt.venue} pays ${pct(best.supplyAt.supply)}. Borrowing the same asset at ${best.borrowAt.venue} costs ${pct(best.borrowAt.borrow)}.

${sign(bps(best.supplyAt.supply, best.borrowAt.borrow))} bps, before fees, gas and liquidation risk.

${LINK}`
    });
  }
}

/* ---------- 6. a term average published for the first time ---------- */
for (const [label, ix] of Object.entries(latest.indices)){
  for (const [k, v] of Object.entries(ix.termAverages || {})){
    if (!v || typeof v.borrow !== "number") continue;
    const days = k.replace("d", "");
    const wasIx = prior && prior[label];
    if (wasIx && wasIx[`avg${days}`]) continue;   // only announce once
    drafts.push({
      why: `${label} ${days}-day average first published`,
      text:
`${label} now has a ${days} day average.

Borrow ${pct(v.borrow)}, supply ${pct(v.supply)}.

Compounded from ${days} daily fixings. Term averages publish only once the full window exists.

${LINK}`
    });
  }
}

/* ---------- write it out ---------- */
const len = t => t.replace(/https?:\/\/\S+|sbor\.xyz/g, "").length + LINK_COST;

const out = [];
out.push(`SBOR post drafts, fixing ${latest.fixing}`);
out.push(prior ? `Compared with ${prior.date}` : `No prior fixing on record`);
out.push("");

if (!drafts.length){
  out.push("Nothing moved enough to be worth posting.");
  out.push("");
  out.push("Thresholds: a rate moving 25 bps, the staking yield moving 50 bps or");
  out.push("changing cycle, an index appearing or dropping out, utilisation above");
  out.push("80% or below 20%, an inversion, or a term average publishing.");
} else {
  out.push(`${drafts.length} thing${drafts.length>1?"s":""} worth saying. Pick one. Do not post more than one a day.`);
  out.push("");
  drafts.forEach((d, i) => {
    const n = len(d.text);
    out.push(`--- ${i+1}. ${d.why} ${n > LIMIT ? `(${n} chars, OVER LIMIT)` : `(${n} chars)`}`);
    out.push("");
    out.push(d.text);
    out.push("");
  });
  out.push("Check the numbers against the site before posting. Never state a cause.");
}

const text = out.join("\n") + "\n";
writeFileSync("post.txt", text);
console.log(text);

/* A JSON copy so a notifier can send one clean message per draft rather than
   one wall of text. Not published, working file only. */
writeFileSync("post.json", JSON.stringify({
  fixing: latest.fixing,
  comparedWith: prior ? prior.date : null,
  drafts: drafts.map(d => ({ why: d.why, chars: len(d.text), text: d.text }))
}, null, 2) + "\n");

/* Tell the workflow whether there is anything worth a notification, so a quiet
   day stays quiet. */
if (process.env.GITHUB_OUTPUT){
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_OUTPUT, `has_drafts=${drafts.length ? "true" : "false"}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `draft_count=${drafts.length}\n`);
}
