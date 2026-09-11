/**
 * SBOR inversion monitor.
 *
 * An inversion is the same asset costing less to borrow at one venue than it
 * pays to supply at another. It should not happen: the spread between borrow
 * and supply is how a lending protocol earns. It can happen when a market is
 * incentivised, because rewards can push the effective cost of capital below
 * what supply pays elsewhere.
 *
 * Nothing here trades. SBOR does not take a position on its own rate. This
 * detects and publishes, and during validation it also pings the maintainer so
 * the detection can be checked against reality before anyone relies on it.
 *
 * Runs hourly, separately from the daily fixing, because an inversion can open
 * and close inside a day. It never writes a fixing and never touches history.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

/* While "validating", detections are published with that status and are not
   presented as a signal anyone should act on. Set to "live" once the detection
   has been checked against reality for a few days. The status is published, so
   the validation period is visible rather than a private window. */
const STATUS = process.env.SBOR_INVERSION_STATUS || "validating";

/* Below this the difference is noise, or it is eaten by fees and gas. */
const MIN_EDGE_BPS = 10;

const round = (n, d = 2) => Number(Number(n).toFixed(d));
const bps = (a, b) => Math.round((a - b) * 100);
const pct = n => Number(n).toFixed(2) + "%";
const log = (...a) => console.error(...a);

const latest = JSON.parse(readFileSync("api/v1/latest.json", "utf8"));

/* Group every market by the asset actually lent. Comparing different assets is
   an exchange rate bet, not arbitrage, so assets never mix. */
const byAsset = {};
for (const [label, ix] of Object.entries(latest.indices || {}))
  for (const m of ix.markets)
    (byAsset[m.asset] ||= []).push({ ...m, index: label });

const found = [];
for (const [asset, ms] of Object.entries(byAsset)){
  if (ms.length < 2) continue;
  let best = null;
  for (const borrowAt of ms)
    for (const supplyAt of ms){
      if (borrowAt.venue === supplyAt.venue) continue;
      const edge = bps(supplyAt.supply, borrowAt.borrow);
      if (edge >= MIN_EDGE_BPS && (!best || edge > best.edgeBps))
        best = {
          asset,
          index: borrowAt.index,
          borrowVenue: borrowAt.venue, borrowRate: borrowAt.borrow,
          borrowUtilisation: borrowAt.utilization ?? null,
          supplyVenue: supplyAt.venue, supplyRate: supplyAt.supply,
          supplyUtilisation: supplyAt.utilization ?? null,
          edgeBps: edge
        };
    }
  if (best) found.push(best);
}

const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const payload = {
  schema: "sbor.v1",
  checked: stamp,
  basedOnFixing: latest.fixing,
  status: STATUS,
  statusNote: STATUS === "validating"
    ? "This monitor is being validated. Detections are published so the validation period is visible, but they have not yet been checked against reality over a long enough run to be relied on."
    : "Live. Detections are published the moment they are found, to everyone at once.",
  minimumEdgeBps: MIN_EDGE_BPS,
  note: "An inversion is the same asset costing less to borrow at one venue than it pays to supply at another. Rates are compared as published by SBOR, before fees, gas, liquidation risk and any minimum position size. SBOR does not trade on its own rate and does not represent that any inversion is executable.",
  inversions: found
};

mkdirSync("api/v1", { recursive: true });
writeFileSync("api/v1/inversions.json", JSON.stringify(payload, null, 2) + "\n");

/* Append-only log. The file above is the current state; this is the record.
   An inversion that opens and closes inside an hour would otherwise leave no
   trace, and the whole point of watching hourly is to catch exactly that. */
if (found.length){
  let log_ = [];
  try { log_ = JSON.parse(readFileSync("api/v1/inversion-log.json", "utf8")); } catch {}
  for (const f of found){
    const last = [...log_].reverse().find(e =>
      e.asset === f.asset && e.borrowVenue === f.borrowVenue && e.supplyVenue === f.supplyVenue);
    /* Extend an open episode rather than writing a row every hour. */
    const oneHourAgo = Date.now() - 75 * 60 * 1000;
    if (last && Date.parse(last.lastSeen) > oneHourAgo){
      last.lastSeen = stamp;
      last.checks = (last.checks || 1) + 1;
      last.maxEdgeBps = Math.max(last.maxEdgeBps ?? last.edgeBps, f.edgeBps);
      last.lastEdgeBps = f.edgeBps;
    } else {
      log_.push({ firstSeen: stamp, lastSeen: stamp, checks: 1,
                  maxEdgeBps: f.edgeBps, lastEdgeBps: f.edgeBps,
                  status: STATUS, ...f });
    }
  }
  writeFileSync("api/v1/inversion-log.json", JSON.stringify(log_, null, 2) + "\n");
  log(`inversion log now has ${log_.length} episode(s)`);
}

if (!found.length){
  log(`no inversion at ${stamp} (status: ${STATUS})`);
} else {
  for (const f of found)
    log(`INVERSION ${f.asset}: supply ${f.supplyVenue} ${pct(f.supplyRate)} vs borrow ${f.borrowVenue} ${pct(f.borrowRate)}, ${f.edgeBps} bps`);
}

/* Tell the workflow whether to alert, and hand it the text. */
if (process.env.GITHUB_OUTPUT){
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_OUTPUT, `found=${found.length ? "true" : "false"}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `count=${found.length}\n`);
}

writeFileSync("inversion-alert.txt", found.length
  ? found.map(f =>
`${f.asset} is inverted across venues.

Supplying at ${f.supplyVenue} pays ${pct(f.supplyRate)}, utilisation ${f.supplyUtilisation == null ? "n/a" : pct(f.supplyUtilisation)}.
Borrowing the same asset at ${f.borrowVenue} costs ${pct(f.borrowRate)}, utilisation ${f.borrowUtilisation == null ? "n/a" : pct(f.borrowUtilisation)}.

Edge ${f.edgeBps} bps, before fees, gas and liquidation risk.

Status: ${STATUS}. Checked ${stamp}.`).join("\n\n")
  : "");
