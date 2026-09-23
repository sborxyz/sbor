#!/usr/bin/env node
/**
 * The change feed: what a lending protocol changed, and when.
 *
 * Every fixing records the protocol parameters SBOR reads while computing
 * rates: Granite's interest rate curve and reserve share, and for each Zest
 * market its reserve factor, vault and underlying token, plus which Zest data
 * contract answered. This compares today's values with the last known ones and
 * appends any difference to api/v1/changes.json.
 *
 * Why it matters: a rate can move because borrowers moved, or because the
 * protocol changed the curve under them. From the rate alone the two look the
 * same. This is the record that tells them apart.
 *
 * Rules it keeps:
 * - A value that could not be read today is not a change. It is skipped, and
 *   the last known value stays as the baseline. Never estimate.
 * - A market seen for the first time is recorded as first seen, but only once
 *   a baseline exists, so the first run records nothing and just starts it.
 * - Running twice in a day records nothing twice, since the second run
 *   compares against the baseline the first one left.
 *
 * Runs as its own step after the fixing, and can never stop it publishing.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const LATEST = process.env.SBOR_LATEST || "api/v1/latest.json";
const OUT = process.env.SBOR_CHANGES || "api/v1/changes.json";
const log = (...a) => console.error(...a);

/* Human names for the fields, so an entry reads on its own. */
const LABEL = {
  dataContract: "data contract",
  reserveFactor: "reserve factor (%)",
  vaultId: "vault id",
  underlying: "underlying token",
  baseRate: "base rate (%)",
  slope1: "slope before the kink (%)",
  slope2: "slope after the kink (%)",
  kink: "kink (% utilization)",
  reserveShare: "reserve share (%)"
};

const same = (a, b) =>
  typeof a === "number" && typeof b === "number"
    ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
    : a === b;
const known = v => v !== null && v !== undefined;

const latest = JSON.parse(readFileSync(LATEST, "utf8"));
const now = latest.parameters?.markets;
if (!now || !Object.keys(now).length){
  log("changes: this fixing carries no parameters, nothing to compare");
  process.exit(0);
}

/* A missing file means this is the first run. A file that exists but cannot
   be read is different: starting over would overwrite the whole record, so
   stop and let the workflow report the failure instead. */
let feed = null;
if (existsSync(OUT)){
  try { feed = JSON.parse(readFileSync(OUT, "utf8")); }
  catch (e) { log(`changes: ${OUT} exists but cannot be read, refusing to overwrite it. ${e.message}`); process.exit(1); }
  if (!Array.isArray(feed?.changes)){ log(`changes: ${OUT} has no changes list, refusing to overwrite it`); process.exit(1); }
}
if (!feed){
  feed = {
    schema: "sbor-changes-1",
    note: "Changes to lending protocol parameters, detected by comparing each fixing with the last known values. Newest first. Each entry gives the fixing that first saw the change, the market, the parameter, and the value before and after. A parameter that could not be read is never recorded as a change. The baseline holds the last known value of every parameter. Recording began on 24 September 2026, so nothing before that date is covered.",
    updated: null,
    baseline: null,
    changes: []
  };
}

const at = latest.fixing;
const date = String(at).slice(0, 10);
const found = [];

if (feed.baseline?.markets){
  const prev = feed.baseline.markets;
  for (const [market, fields] of Object.entries(now)){
    const was = prev[market];
    if (!was){
      found.push({ date, fixing: at, market, parameter: "market", label: "market", from: null, to: "first seen" });
      continue;
    }
    for (const [field, value] of Object.entries(fields)){
      if (!known(value)) continue;                  // not read today: not a change
      const old = was[field];
      if (!known(old)) continue;                    // nothing earlier to compare with
      if (!same(old, value))
        found.push({ date, fixing: at, market, parameter: field, label: LABEL[field] || field, from: old, to: value });
    }
  }
}

/* The baseline keeps the last known value of everything ever seen, so a read
   that fails today, or a market missing for a day, does not reset it. */
const merged = JSON.parse(JSON.stringify(feed.baseline?.markets || {}));
for (const [market, fields] of Object.entries(now)){
  merged[market] = merged[market] || {};
  for (const [field, value] of Object.entries(fields))
    if (known(value)) merged[market][field] = value;
}

const firstRun = !feed.baseline;
feed.baseline = { fixing: at, markets: merged };
feed.changes = [...found, ...feed.changes];
feed.updated = at;
writeFileSync(OUT, JSON.stringify(feed, null, 2) + "\n");

if (firstRun) log(`changes: baseline started with ${Object.keys(merged).length} markets, nothing to compare yet`);
else if (!found.length) log("changes: no parameter changed");
else for (const c of found)
  log(`changes: ${c.market} ${c.label}: ${c.from ?? "none"} -> ${c.to}`);
