#!/usr/bin/env node
/**
 * Tests for the SBOR MCP server. Run: npm test (in mcp/), or node mcp/test/run.mjs
 *
 * Each case is a bad day SBOR has had, or one a reviewer found: a withdrawn
 * fixing, a withheld index, a missing or broken file, stale data, a market at
 * weight 0, a tiny market named "best". The server under test is the real
 * server.mjs, started as a client would start it, reading a local copy of
 * SBOR's files that this script serves and bends per case.
 *
 * It never touches the fixing, the site or the network: the files come from
 * test/fixtures, a snapshot of 17 November 2026, re-dated so its last day is
 * always today.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = p => fileURLToPath(new URL(p, import.meta.url));
const load = f => JSON.parse(readFileSync(here(`./fixtures/${f}`), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o));

/* Re-date the snapshot: its last fixing becomes a minute ago. */
const SNAP_DAY = "2026-11-17";
const fixTime = new Date(Date.now() - 60_000);
const TODAY = fixTime.toISOString().slice(0, 10);
const shiftDays = Math.round((Date.parse(TODAY) - Date.parse(SNAP_DAY)) / 864e5);
const shift = day => new Date(Date.parse(day) + shiftDays * 864e5).toISOString().slice(0, 10);
const WITHDRAWN_DAY = shift("2026-09-05"), WITHHELD_DAY = shift("2026-10-08");

const base = () => {
  const latest = load("latest.json");
  latest.fixing = fixTime.toISOString().replace(/\.\d+Z$/, "Z");
  const history = load("history.json").map(r => ({ ...r, date: shift(r.date) }));
  const withdrawals = load("withdrawals.json");
  withdrawals.asOf = TODAY;
  withdrawals.withdrawals = withdrawals.withdrawals.map(e => ({ ...e, date: shift(e.date) }));
  return { latest, history, withdrawals };
};

/* Each scenario bends the base files. null means the file answers 404. */
const scenarios = {
  normal: f => f,
  withheld: f => {
    delete f.latest.indices["SBOR-BTC"];
    f.latest.withheld = { "SBOR-BTC": { reason: "Withheld: TEST REASON the only market reads zero." } };
    return f;
  },
  absentNoReason: f => { delete f.latest.indices["SBOR-BTC"]; return f; },
  withdrawnToday: f => {
    f.withdrawals.withdrawals.push({ date: TODAY, index: "SBOR-USD", reason: "TEST withdrawal." },
                                   { date: TODAY, index: "btcCollateralUsd", reason: "TEST headline withdrawal." });
    return f;
  },
  noWithdrawalsFile: f => { f.withdrawals = null; return f; },
  badAsOf: f => { f.withdrawals.asOf = "latest"; return f; },
  behindAsOf: f => { f.withdrawals.asOf = shift("2026-11-15"); return f; },
  noFixing: f => { delete f.latest.fixing; return f; },
  stale: f => { f.latest.fixing = new Date(Date.now() - 60 * 36e5).toISOString(); return f; }
};
const files = Object.fromEntries(Object.entries(scenarios).map(([k, bend]) => [k, bend(clone(base()))]));

const http = createServer((req, res) => {
  const [, scen, ...rest] = req.url.split("/");
  const f = files[scen], path = "/" + rest.join("/");
  const body = !f ? null
    : path === "/api/v1/latest.json" ? f.latest
    : path === "/api/v1/history.json" ? f.history
    : path === "/api/v1/withdrawals.json" ? f.withdrawals
    : null;
  if (body === null || body === undefined){ res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});
await new Promise(r => http.listen(0, "127.0.0.1", r));
const PORT = http.address().port;

/* One real server per scenario, started over stdio as a client would. */
const clients = {};
async function call(scen, tool, args = {}){
  if (!clients[scen]){
    const t = new StdioClientTransport({
      command: process.execPath, args: [here("../server.mjs")],
      env: { ...process.env, SBOR_BASE: `http://127.0.0.1:${PORT}/${scen}`, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" }
    });
    clients[scen] = new Client({ name: "sbor-test", version: "0" });
    await clients[scen].connect(t);
  }
  const r = await clients[scen].callTool({ name: tool, arguments: args });
  return { error: Boolean(r.isError), text: (r.content || []).map(c => c.text).join("\n") };
}

let passed = 0;
const failures = [];
async function test(name, fn){
  try { await fn(); passed++; console.log(`  ok    ${name}`); }
  catch (e){ failures.push(name); console.log(`  FAIL  ${name}\n        ${String(e.message).split("\n").join("\n        ")}`); }
}
const has = (r, s) => { if (!r.text.includes(s)) throw new Error(`expected to find "${s}" in:\n${r.text.slice(0, 900)}`); };
const hasNot = (r, s) => { if (r.text.includes(s)) throw new Error(`expected NOT to find "${s}" in:\n${r.text.slice(0, 900)}`); };
const answers = r => { if (r.error) throw new Error(`expected an answer, got a refusal:\n${r.text.slice(0, 600)}`); };
const refuses = r => { if (!r.error) throw new Error(`expected a refusal, got an answer:\n${r.text.slice(0, 600)}`); };

console.log("SBOR MCP server tests\n");

/* ---- a normal day ---- */
await test("six tools are listed", async () => {
  await call("normal", "get_rate", { index: "SBOR-USD" });
  const { tools } = await clients.normal.listTools();
  if (tools.length !== 6) throw new Error(`expected 6 tools, got ${tools.length}`);
});
await test("get_rate: the headline, the Stacks indices, no warning", async () => {
  const r = await call("normal", "get_rate"); answers(r);
  has(r, "BTC-COLLATERAL-USD: borrow"); has(r, "SBOR-USD: borrow"); hasNot(r, "Not yet confirmed"); hasNot(r, "STALE");
});
await test("compare_rate: a borrow offer far above the market says stop", async () => {
  const r = await call("normal", "compare_rate", { rate: 9, side: "borrow", index: "BTC-COLLATERAL-USD" }); answers(r);
  has(r, "above the market"); has(r, "stop and ask a human");
});
await test("compare_rate: a 0% offer is answered, not refused", async () => {
  const r = await call("normal", "compare_rate", { rate: 0, side: "supply", index: "SBOR-USD" }); answers(r);
  has(r, "below the market"); hasNot(r, "CHECK UNITS");
});
await test("compare_rate: a negative rate is refused", async () => {
  let r; try { r = await call("normal", "compare_rate", { rate: -1, side: "borrow", index: "SBOR-USD" }); } catch { return; }
  refuses(r);
});
await test("compare_rate: only a main market is named, never 'best'", async () => {
  const r = await call("normal", "compare_rate", { rate: 5, side: "borrow", index: "BTC-COLLATERAL-USD" }); answers(r);
  has(r, "lowest rate among the main markets"); hasNot(r, "Best constituent");
  hasNot(r, "main markets today (each at least 5% of the weight): Granite");   /* 0.2% of the weight */
  hasNot(r, "main markets today (each at least 5% of the weight): Lista");     /* under 5% */
});
await test("compare_rate: a supply offer is also judged all in (staking yield)", async () => {
  const r = await call("normal", "compare_rate", { rate: 3, side: "supply", index: "SBOR-STX" }); answers(r);
  has(r, "above the market"); has(r, "All in"); has(r, "basis points below");
});
await test("compare_rate: an incomplete all-in rate is said", async () => {
  const r = await call("normal", "compare_rate", { rate: 1, side: "supply", index: "SBOR-BTC" }); answers(r);
  has(r, "incomplete");
});
await test("list_markets: a market at weight 0 is labelled", async () => {
  const r = await call("normal", "list_markets", { index: "BTC-COLLATERAL-USD" }); answers(r);
  has(r, "[weight 0: listed, not part of the rate today]");
});
await test("get_history: 30 days is 30 days, not 31", async () => {
  const r = await call("normal", "get_history", { index: "SBOR-USD", days: 30 }); answers(r);
  const n = r.text.split("\n").filter(l => /^\d{4}-\d{2}-\d{2}:/.test(l)).length;
  if (n !== 30) throw new Error(`expected 30 dated lines, got ${n}`);
});
await test("get_history: a withdrawn fixing is WITHDRAWN, out of the mean", async () => {
  const r = await call("normal", "get_history", { index: "SBOR-BTC", days: 200 }); answers(r);
  has(r, `${WITHDRAWN_DAY}: WITHDRAWN after publication.`); has(r, "1 withdrawn");
});
await test("get_history: a withheld day is 'not published' with SBOR's reason, never 'withdrawn'", async () => {
  const r = await call("normal", "get_history", { index: "SBOR-BTC", days: 200 }); answers(r);
  has(r, `${WITHHELD_DAY}: not published. Withheld: Zest V2 sBTC`); hasNot(r, `${WITHHELD_DAY}: withdrawn`); has(r, "never a zero");
});
await test("get_history: the headline does not list days before it existed", async () => {
  const r = await call("normal", "get_history", { index: "BTC-COLLATERAL-USD", days: 200 }); answers(r);
  hasNot(r, `${shift("2026-10-01")}:`); has(r, `${shift("2026-10-14")}: borrow`);
});
await test("compare_chains: the Stacks indices and the headline", async () => {
  const r = await call("normal", "compare_chains"); answers(r);
  has(r, "SBOR-USD: borrow"); has(r, "Borrowing dollars against bitcoin"); hasNot(r, "Not yet confirmed");
});

/* ---- an index SBOR withheld ---- */
await test("withheld index: get_rate gives SBOR's reason, not 'could not be read'", async () => {
  const r = await call("withheld", "get_rate", { index: "SBOR-BTC" }); answers(r);
  has(r, "TEST REASON"); hasNot(r, "cannot be read");
  const all = await call("withheld", "get_rate"); has(all, "TEST REASON");
});
await test("withheld index: compare_rate refuses, with the reason", async () => {
  const r = await call("withheld", "compare_rate", { rate: 2, side: "borrow", index: "SBOR-BTC" }); refuses(r); has(r, "TEST REASON");
});
await test("withheld index: compare_chains names it, does not skip it", async () => {
  const r = await call("withheld", "compare_chains"); answers(r); has(r, "SBOR-BTC is not published"); has(r, "TEST REASON");
});
await test("absent index with no reason: said plainly, never a zero", async () => {
  const r = await call("absentNoReason", "get_rate", { index: "SBOR-BTC" }); answers(r);
  has(r, "no reason is recorded"); has(r, "never as zero");
});

/* ---- a fixing withdrawn after publication ---- */
await test("withdrawn today: get_rate reports it, never the rate", async () => {
  const r = await call("withdrawnToday", "get_rate", { index: "SBOR-USD" }); answers(r);
  has(r, "WITHDRAWN"); has(r, "TEST withdrawal."); hasNot(r, "SBOR-USD: borrow");
});
await test("withdrawn today: a withdrawal keyed by the history's short name is caught", async () => {
  const r = await call("withdrawnToday", "get_rate", { index: "BTC-COLLATERAL-USD" }); answers(r);
  has(r, "TEST headline withdrawal."); hasNot(r, "BTC-COLLATERAL-USD: borrow");
});
await test("withdrawn today: compare_rate refuses", async () => {
  const r = await call("withdrawnToday", "compare_rate", { rate: 3, side: "borrow", index: "SBOR-USD" }); refuses(r); has(r, "WITHDRAWN");
});
await test("withdrawn today: list_markets and compare_chains do not show it as a rate", async () => {
  const m = await call("withdrawnToday", "list_markets", { index: "SBOR-USD" }); has(m, "WITHDRAWN");
  const c = await call("withdrawnToday", "compare_chains"); has(c, "WITHDRAWN"); hasNot(c, "SBOR-USD: borrow"); hasNot(c, "Borrowing dollars against bitcoin");
});
await test("withdrawn today: get_history shows it withdrawn too", async () => {
  const r = await call("withdrawnToday", "get_history", { index: "SBOR-USD", days: 3 }); answers(r); has(r, `${TODAY}: WITHDRAWN`);
});

/* ---- the list of withdrawals cannot be trusted: fail closed ---- */
for (const [scen, why] of [["noWithdrawalsFile", "missing"], ["badAsOf", "has a bad date"], ["behindAsOf", "is behind the fixing"], ["noFixing", "cannot be matched: no fixing time"]])
  await test(`withdrawals list ${why}: compare_rate refuses, get_rate warns`, async () => {
    refuses(await call(scen, "compare_rate", { rate: 3, side: "borrow", index: "SBOR-USD" }));
    const r = await call(scen, "get_rate", { index: "SBOR-USD" }); has(r, scen === "noFixing" ? "could not be read" : "Not yet confirmed");
  });
await test("withdrawals list behind: get_history names the unconfirmed days", async () => {
  const r = await call("behindAsOf", "get_history", { index: "SBOR-USD", days: 5 }); answers(r);
  has(r, "Not yet confirmed"); has(r, TODAY);
});

/* ---- stale data ---- */
await test("stale fixing: compare_rate refuses, get_rate says STALE", async () => {
  refuses(await call("stale", "compare_rate", { rate: 3, side: "borrow", index: "SBOR-USD" }));
  has(await call("stale", "get_rate", { index: "SBOR-USD" }), "STALE");
});

for (const c of Object.values(clients)) await c.close();
http.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
