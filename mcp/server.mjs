#!/usr/bin/env node
/**
 * SBOR MCP server.
 *
 * Exposes SBOR, the benchmark lending rate for Stacks, as tools any MCP client
 * can call: Claude, an agent framework, or anything else that speaks the
 * protocol.
 *
 * Reads the same public endpoints as everyone else. No key, no state, no
 * writes. If SBOR cannot give a trustworthy answer, the tools say so rather
 * than guessing. That matters most in compare_rate, which an agent may consult
 * before borrowing: a wrong verdict there is worse than no verdict.
 *
 * Run:  npx -y sbor-mcp
 * Or:   node mcp/server.mjs
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const VERSION = "1.1.2";
const BASE = process.env.SBOR_BASE || "https://sbor.xyz";
const UA = `sbor-mcp/${VERSION}`;
const TIMEOUT_MS = 10_000;
const STALE_AFTER_HOURS = 48;
const INDICES = ["SBOR-USD", "SBOR-BTC", "SBOR-STX"];

/* Small cache so an agent asking three questions in a row makes one request. */
const cache = new Map();
async function getJson(path, ttlMs = 60_000){
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const r = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!r.ok) throw new Error(`${path} responded ${r.status}`);
  const data = await r.json();
  cache.set(path, { at: Date.now(), data });
  return data;
}

const text = t => ({ content: [{ type: "text", text: t }] });
const refuse = t => ({ isError: true, content: [{ type: "text", text: t }] });
const fail = e => refuse(
  (e?.name === "TimeoutError"
    ? `SBOR did not respond within ${TIMEOUT_MS / 1000} seconds.`
    : `SBOR is unreachable or returned something unexpected: ${e?.message}.`)
  + ` Do not substitute an estimate. Fall back to your own logic or try again.`);

const pct = n => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) + "%" : "not published");
const usd = n => !Number.isFinite(n) ? "n/a"
  : n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : "$" + (n / 1e6).toFixed(1) + "M";

/* Age of a fixing in hours, or null when the timestamp cannot be parsed. An
   unparseable timestamp must read as unusable, never as fresh. */
function ageHours(iso){
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / 36e5 : null;
}
function freshness(d){
  const a = ageHours(d.fixing);
  if (a === null) return `Fixing timestamp "${d.fixing}" could not be read. Treat this data as unusable.`;
  if (a > STALE_AFTER_HOURS) return `STALE: the last fixing is ${a.toFixed(1)} hours old. Rates may have moved. Do not act on it.`;
  return `Fixing ${d.fixing}, ${a.toFixed(1)} hours old, methodology ${d.methodologyVersion}.`;
}

const server = new McpServer({ name: "sbor", version: VERSION });

/* ------------------------------------------------------------------ */
/* 1. the current fixing                                               */
/* ------------------------------------------------------------------ */
server.registerTool("get_rate", {
  title: "Get the current SBOR fixing",
  description:
    "The benchmark borrow and supply rate for lending on Stacks, read from " +
    "lending contract state. Use this to judge whether a lending offer is good: " +
    "borrowing above the SBOR borrow rate means paying more than the market, " +
    "supplying below the supply rate means earning less. Returns every currency " +
    "index unless one is named. Always read the freshness line first.",
  inputSchema: {
    index: z.enum(INDICES).optional().describe("Currency index. Omit for all of them.")
  }
}, async ({ index }) => {
  try {
    const d = await getJson("/api/v1/latest.json");
    if (index && !d.indices[index])
      return text(`${index} is not published in the current fixing. `
        + `When a market cannot be read, SBOR omits the index rather than publishing `
        + `a figure that is not real. Treat it as unknown, never as zero. `
        + `Published today: ${Object.keys(d.indices).join(", ")}.`);

    const wanted = index ? { [index]: d.indices[index] } : d.indices;
    const lines = Object.entries(wanted).map(([label, ix]) => {
      const n = ix.venues.length;
      const conc = `${n} ${n === 1 ? "venue, so a reading of that venue rather than a market average" : "venues"}`
        + `, largest ${(ix.largestConstituentWeight * 100).toFixed(0)}% of depth`;
      const allIn = ix.allInSupplyDiffers ? `, ${pct(ix.allInSupply)} all in with protocol yield` : "";
      return `${label}: borrow ${pct(ix.borrow)}, supply ${pct(ix.supply)}${allIn} (${conc})`;
    });

    const omitted = INDICES.filter(l => !d.indices[l]);
    return text([
      freshness(d),
      ...lines,
      omitted.length ? `Not published: ${omitted.join(", ")}. A market that cannot be read is omitted, not estimated.` : "",
      d.poxReference ? `Proof of Transfer staking yield ${pct(d.poxReference.apy)}. A staking yield, not a lending rate. Never add it to one.` : "",
      `Basis: ${d.basis}`,
      `Source: ${BASE}/api/v1/latest.json`
    ].filter(Boolean).join("\n"));
  } catch (e) { return fail(e); }
});

/* ------------------------------------------------------------------ */
/* 2. is this offer any good                                           */
/* ------------------------------------------------------------------ */
server.registerTool("compare_rate", {
  title: "Compare a rate against the SBOR benchmark",
  description:
    "Given a rate you have been offered, say whether it is above or below the " +
    "market for that currency, and by how much. This is the main reason SBOR exists. " +
    "Recommended use: if a borrow offer is more than 50 basis points above the " +
    "benchmark, stop and ask a human. Use SBOR to stop, never to start. " +
    "This tool refuses rather than guesses: an error result means there is no " +
    "trustworthy answer, not that the rate is bad.",
  inputSchema: {
    rate: z.number().gt(0).lte(100)
      .describe("The rate offered, as a percentage between 0 and 100. 4.2 means 4.2%, not 0.042."),
    side: z.enum(["borrow", "supply"]).describe("Whether you would be borrowing or supplying."),
    index: z.enum(INDICES).describe("Which currency.")
  }
}, async ({ rate, side, index }) => {
  try {
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100)
      return refuse(`The rate must be a percentage between 0 and 100, got ${rate}. 4.2% is 4.2, not 0.042.`);

    const d = await getJson("/api/v1/latest.json");

    /* A verdict an agent may act on must not rest on data SBOR cannot stand behind. */
    const a = ageHours(d.fixing);
    if (a === null)
      return refuse(`The fixing timestamp "${d.fixing}" could not be read, so the age of the data is unknown. No verdict. Fall back to your own logic.`);
    if (a > STALE_AFTER_HOURS)
      return refuse(`The last fixing is ${a.toFixed(1)} hours old, past the ${STALE_AFTER_HOURS} hour limit. No verdict on stale data. Fall back to your own logic.`);

    const ix = d.indices[index];
    if (!ix)
      return refuse(`${index} is not published in the current fixing, so there is no benchmark to compare against. `
        + `Treat this as unknown, not as zero. Published today: ${Object.keys(d.indices).join(", ")}.`);

    const bench = ix[side];
    if (typeof bench !== "number" || !Number.isFinite(bench))
      return refuse(`${index} has no usable ${side} rate in the current fixing. Treat this as unknown, not as zero.`);

    const diff = rate - bench;
    if (!Number.isFinite(diff)) return refuse(`Could not compute a difference. No verdict.`);
    const bps = Math.round(Math.abs(diff) * 100);

    let verdict;
    if (bps < 1) verdict = "at the market";
    else if (side === "borrow") verdict = diff > 0
      ? `above the market. You would be paying ${bps} basis points more than the benchmark`
      : `below the market. You would be paying ${bps} basis points less than the benchmark`;
    else verdict = diff > 0
      ? `above the market. You would be earning ${bps} basis points more than the benchmark`
      : `below the market. You would be earning ${bps} basis points less than the benchmark`;

    /* A fraction passed as a percentage cannot be caught with certainty,
       because rates this low genuinely occur on Stacks. So it is answered, and
       flagged loudly enough that it cannot be missed. */
    const unitsWarning = rate < 0.5
      ? `CHECK UNITS FIRST: this was read as ${rate}%, not ${(rate * 100).toFixed(1)}%. Rates this low do occur, so it has been answered as given. If you meant ${(rate * 100).toFixed(1)}%, ask again with ${(rate * 100).toFixed(1)}.`
      : "";

    const best = [...ix.markets]
      .filter(m => typeof m[side] === "number" && Number.isFinite(m[side]))
      .sort((p, q) => side === "borrow" ? p[side] - q[side] : q[side] - p[side])[0];

    const stop = side === "borrow" && diff * 100 > 50
      ? `This is more than 50 basis points above the benchmark. Recommended: stop and ask a human before borrowing.`
      : "";

    return text([
      unitsWarning,
      `${index} ${side} benchmark is ${pct(bench)}. Your ${rate.toFixed(2)}% is ${verdict}.`,
      stop,
      best ? `Best constituent today: ${best.venue} ${best.asset} at ${pct(best[side])}, utilization ${pct(best.utilization)}.` : "",
      ix.venues.length === 1 ? `Note: this index covers one venue, so it is a reading of that venue rather than a market average.` : "",
      freshness(d)
    ].filter(Boolean).join("\n"));
  } catch (e) { return fail(e); }
});

/* ------------------------------------------------------------------ */
/* 3. venue by venue                                                   */
/* ------------------------------------------------------------------ */
server.registerTool("list_markets", {
  title: "List the lending markets behind a rate",
  description:
    "Every venue and asset in an index, with its borrow rate, supply rate, " +
    "utilization, depth and weight. Utilization explains why a rate sits where it does.",
  inputSchema: {
    index: z.enum(INDICES).optional().describe("Currency index. Omit for all of them.")
  }
}, async ({ index }) => {
  try {
    const d = await getJson("/api/v1/latest.json");
    const entries = index
      ? (d.indices[index] ? [[index, d.indices[index]]] : [])
      : Object.entries(d.indices);
    if (!entries.length) return text(`${index} is not published in the current fixing. Treat it as unknown, not as zero.`);

    const out = entries.map(([label, ix]) =>
      `${label}\n` + ix.markets.map(m =>
        `  ${m.venue} ${m.asset}: borrow ${pct(m.borrow)}, supply ${pct(m.supply)}, `
        + `utilization ${pct(m.utilization)}, depth ${usd(m.depthUsd)}, weight ${(m.weight * 100).toFixed(1)}%`
        + (m.protocolYield ? `, plus ${pct(m.protocolYield)} protocol yield from holding the asset, not from the loan` : "")
      ).join("\n")).join("\n\n");
    return text([freshness(d), "", out, "", `Source: ${BASE}/api/v1/latest.json`].join("\n"));
  } catch (e) { return fail(e); }
});

/* ------------------------------------------------------------------ */
/* 4. history                                                          */
/* ------------------------------------------------------------------ */
server.registerTool("get_history", {
  title: "Get the SBOR history",
  description:
    "Daily fixings since the index began. Use this to see whether a rate is " +
    "unusual, or how the cost of capital has moved. Means are given per " +
    "methodology version, never across a change in how the number is built.",
  inputSchema: {
    index: z.enum(INDICES).describe("Which currency."),
    days: z.number().int().min(1).max(200).optional().describe("How many days back, up to 200. Default 30.")
  }
}, async ({ index, days = 30 }) => {
  try {
    const h = await getJson("/api/v1/history.json", 300_000);
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const rows = h.filter(r => r.date >= cutoff && r[index]).sort((p, q) => p.date.localeCompare(q.date));
    if (!rows.length) return text(`No ${index} fixings in the last ${days} days.`);

    const lines = rows.map(r => {
      const e = r[index];
      if (e.withdrawn) return `${r.date}: withdrawn. ${e.reason}`;
      return `${r.date}: borrow ${pct(e.borrow)}, supply ${pct(e.supply)}${r.methodologyVersion ? `  (v${r.methodologyVersion})` : "  (version not recorded)"}`;
    });

    const valid = rows.filter(r => !r[index].withdrawn && Number.isFinite(r[index].borrow));
    const withdrawn = rows.length - rows.filter(r => !r[index].withdrawn).length;

    /* A mean across a methodology change averages two different definitions of
       the same number, so it is given per version instead. */
    const byVersion = {};
    for (const r of valid) {
      const v = r.methodologyVersion ?? "not recorded";
      (byVersion[v] ||= []).push(r[index].borrow);
    }
    const versions = Object.keys(byVersion);
    const means = versions.map(v => {
      const xs = byVersion[v];
      return `  v${v}: ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)}% over ${xs.length} fixing${xs.length > 1 ? "s" : ""}`;
    });

    return text([
      `${index}, last ${days} days, ${rows.length} fixings`,
      ...lines,
      withdrawn ? `\n${withdrawn} withdrawn fixing${withdrawn > 1 ? "s are" : " is"} kept in the record and excluded from every mean.` : "",
      versions.length > 1
        ? `\nThis window spans ${versions.length} methodology versions, so there is no single mean. Mean borrow by version:\n${means.join("\n")}`
        : valid.length ? `\nSimple mean borrow over the period: ${means[0].split(": ")[1]}` : "",
      `\nFor a compounded term average use get_rate, which carries termAverages once a full window exists.`
    ].filter(Boolean).join("\n"));
  } catch (e) { return fail(e); }
});

/* ------------------------------------------------------------------ */
/* 5. how does Stacks compare                                          */
/* ------------------------------------------------------------------ */
server.registerTool("compare_chains", {
  title: "Compare Stacks rates against the same markets on other chains",
  description:
    "The same asset classes on the largest lending markets on Ethereum, Base, " +
    "Hyperliquid and Solana, plus SOFR, the US repo rate. Context only: none of " +
    "these is ever a constituent of an SBOR index, and the other chains come from " +
    "DefiLlama rather than contract state, so small differences are expected.",
  inputSchema: {
    index: z.enum(INDICES).optional().describe("Only markets comparable to this index. Omit for all.")
  }
}, async ({ index }) => {
  try {
    const d = await getJson("/api/v1/latest.json");
    const all = d.externalReference?.markets ?? [];
    const ext = (index ? all.filter(m => m.comparableTo === index) : all).map(m =>
      `  ${m.venue} ${m.asset}: borrow ${pct(m.borrow)}, supply ${pct(m.supply)}, `
      + `utilization ${pct(m.utilization)}, depth ${usd(m.depthUsd)}`
    );
    const stacks = Object.entries(d.indices)
      .filter(([l]) => !index || l === index)
      .map(([l, ix]) => `  ${l}: borrow ${pct(ix.borrow)}, supply ${pct(ix.supply)}`);

    const s = d.context?.sofr;
    const sofr = s && (!index || index === "SBOR-USD")
      ? `SOFR, the overnight US repo rate secured by US government debt: ${pct(s.rate)} for ${s.effectiveDate}.`
        + (Number.isFinite(s.average30day) ? ` Averages: 30 day ${pct(s.average30day)}, 90 day ${pct(s.average90day)}, 180 day ${pct(s.average180day)}.` : "")
        + ` A cheaper rate on Stacks reflects lower utilization, not lower risk.`
      : "";

    return text([
      freshness(d), "",
      "Stacks", ...stacks, "",
      ext.length ? "Elsewhere" : "", ...ext, ext.length ? "" : "",
      sofr,
      d.externalReference?.note ?? ""
    ].filter((x, i, arr) => x !== "" || (arr[i - 1] !== "" && i > 0)).join("\n").trim());
  } catch (e) { return fail(e); }
});

/* ------------------------------------------------------------------ */
/* 6. how the number is made                                           */
/* ------------------------------------------------------------------ */
server.registerTool("get_methodology", {
  title: "How SBOR is calculated",
  description:
    "The full methodology and integration policy: how the fixing is built, " +
    "what is excluded and why, and what SBOR will and will not do. Read this " +
    "before quoting a rate in anything that matters.",
  inputSchema: {}
}, async () => {
  try {
    const r = await fetch(`${BASE}/llms.txt`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!r.ok) throw new Error(`llms.txt responded ${r.status}`);
    return text(await r.text());
  } catch (e) { return fail(e); }
});

await server.connect(new StdioServerTransport());
