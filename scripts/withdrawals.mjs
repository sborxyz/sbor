/**
 * Every fixing withdrawn after publication, in one small file:
 * api/v1/withdrawals.json.
 *
 * A withdrawal is recorded in the history shards (a row's index marked
 * withdrawn, with the reason). Readers that only need to know whether a fixing
 * was withdrawn should not have to download the whole history to find out,
 * so this file lists every withdrawal ever made, across every shard, with
 * asOf: the date of the latest fixing it was built with. A reader treats a
 * fixing dated after asOf as not yet checked.
 *
 * Run by the daily fixing, after the fixing is written. After a withdrawal is
 * made by hand in the history shards, run it again (node scripts/withdrawals.mjs)
 * and commit the result with the correction.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

/* History keys each series by its own short name; the file uses the labels
   readers know. */
const LABELS = { btcUsdc: "BTC-COLLATERAL-USDC", btcCollateralUsd: "BTC-COLLATERAL-USD" };

const latest = JSON.parse(readFileSync("api/v1/latest.json", "utf8"));
const shards = readdirSync("api/v1").filter(f => /^history-\d{4}\.json$/.test(f)).sort();
if (!shards.length) throw new Error("no history shards found in api/v1");

const withdrawals = [];
for (const f of shards){
  for (const row of JSON.parse(readFileSync(`api/v1/${f}`, "utf8"))){
    for (const [key, v] of Object.entries(row)){
      if (v && typeof v === "object" && v.withdrawn)
        withdrawals.push({ date: row.date, index: LABELS[key] ?? key, reason: v.reason ?? null });
    }
  }
}
withdrawals.sort((a, b) => a.date.localeCompare(b.date) || a.index.localeCompare(b.index));

writeFileSync("api/v1/withdrawals.json", JSON.stringify({
  schema: "sbor.v1",
  note: "Every fixing withdrawn after publication. A withdrawn fixing stays in the archive and the history as published, but it is not a valid reading. asOf is the date of the latest fixing this list was built with: a fixing dated after asOf has not been checked yet.",
  asOf: String(latest.fixing).slice(0, 10),
  fixing: latest.fixing,
  count: withdrawals.length,
  withdrawals
}, null, 2) + "\n");
console.error(`withdrawals.json: ${withdrawals.length} withdrawal(s), as of ${String(latest.fixing).slice(0, 10)}`);
