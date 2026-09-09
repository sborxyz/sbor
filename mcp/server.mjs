#!/usr/bin/env node
/**
 * SBOR MCP server.
 *
 * Exposes the Stacks Bitcoin Offered Rate as tools any MCP client can call:
 * Claude, an agent framework, or anything else that speaks the protocol.
 *
 * Reads the same public endpoints as everyone else. No key, no state, no
 * writes. If SBOR is unreachable the tools say so rather than guessing.
 *
 * Run:  npx -y @sbor/mcp
 * Or:   node mcp/server.mjs
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.SBOR_BASE || "https://sbor.xyz";
const UA = "sbor-mcp/1.0";

/* Small cache so an agent asking three questions in a row makes one request. */
const cache = new Map();
async function getJson(path, ttlMs = 60_000){
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const r = await fetch(`${BASE}${path}`, { headers: { accept:"application/json", "user-agent":UA } });
  if (!r.ok) throw new Error(`${path} responded ${r.status}`);
  const data = await r.json();
  cache.set(path, { at: Date.now(), data });
  return data;
}

const text = t => ({ content: [{ type:"text", text: t }] });
const fail = e => ({ isError: true, content: [{ type:"text",
  text: `SBOR is unreachable or returned something unexpected: ${e.message}. `
      + `Do not substitute an estimate. Fall back to your own logic or try again.` }] });

const pct = n => (typeof n === "number" ? n.toFixed(2) + "%" : "not published");
const usd = n => n >= 1e9 ? "$" + (n/1e9).toFixed(2) + "B"
                          : "$" + (n/1e6).toFixed(1) + "M";

const server = new McpServer({ name: "sbor", version: "1.0.0" });

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
    "index unless one is named.",
  inputSchema: {
    index: z.enum(["SBOR-USD","SBOR-BTC","SBOR-STX"]).optional()
      .describe("Currency index. Omit for all of them.")
  }
}, async ({ index }) => {
  try {
    const d = await getJson("/api/v1/latest.json");
    const wanted = index ? { [index]: d.indices[index] } : d.indices;
    if (index && !d.indices[index])
      return text(`${index} is not published in the current fixing. `
        + `When a market cannot be read, SBOR omits the index rather than publishing `
        + `a figure that is not real. Published today: ${Object.keys(d.indices).join(", ")}.`);

    const lines = Object.entries(wanted).map(([label, ix]) => {
      const conc = `${ix.venues.length} ${ix.venues.length === 1 ? "venue" : "venues"}`
        + `, largest ${(ix.largestConstituentWeight*100).toFixed(0)}% of depth`;
      const allIn = ix.allInSupplyDiffers
        ? `, ${pct(ix.allInSupply)} all in with protocol yield` : "";
      return `${label}: borrow ${pct(ix.borrow)}, supply ${pct(ix.supply)}${allIn} (${conc})`;
    });

    const omitted = ["SBOR-USD","SBOR-BTC","SBOR-STX"].filter(l => !d.indices[l]);
    return text([
      `SBOR fixing ${d.fixing}, methodology ${d.methodologyVersion}`,
      ...lines,
      omitted.length ? `Not published: ${omitted.join(", ")}. A market that cannot be read is omitted, not estimated.` : "",
      d.poxReference ? `PoX staking yield ${pct(d.poxReference.apy)}, a staking yield and not a lending rate.` : "",
      `Basis: ${d.basis}`,
      `Source: ${BASE}/api/v1/latest.json`
    ].filter(Boolean).join("\n"));
  } catch(e){ return fail(e); }
});

/* ------------------------------------------------------------------ */
/* 2. is this offer any good                                           */
/* ------------------------------------------------------------------ */
server.registerTool("compare_rate", {
  title: "Compare a rate against the SBOR benchmark",
  description:
    "Given a rate you have been offered, say whether it is above or below the " +
    "market for that currency, and by how much. This is the main reason SBOR exists.",
  inputSchema: {
    rate: z.number().describe("The rate offered, as a percentage. 4.2 means 4.2%."),
    side: z.enum(["borrow","supply"]).describe("Whether you would be borrowing or supplying."),
    index: z.enum(["SBOR-USD","SBOR-BTC","SBOR-STX"]).describe("Which currency.")
  }
}, async ({ rate, side, index }) => {
  try {
    const d = await getJson("/api/v1/latest.json");
    const ix = d.indices[index];
    if (!ix) return text(`${index} is not published in the current fixing, so there is no benchmark to compare against today.`);
    const bench = ix[side];
    if (typeof bench !== "number") return text(`${index} has no published ${side} rate today.`);

    const diff = rate - bench;
    const bps = Math.round(Math.abs(diff) * 100);
    let verdict;
    if (Math.abs(diff) < 0.01) verdict = "at the market";
    else if (side === "borrow") verdict = diff > 0
      ? `above the market. You would be paying ${bps} basis points more than the benchmark`
      : `below the market. You would be paying ${bps} basis points less than the benchmark`;
    else verdict = diff > 0
      ? `above the market. You would be earning ${bps} basis points more than the benchmark`
      : `below the market. You would be earning ${bps} basis points less than the benchmark`;

    const cheapest = [...ix.markets].sort((a,b) =>
      side === "borrow" ? a.borrow - b.borrow : b.supply - a.supply)[0];

    return text([
      `${index} ${side} benchmark is ${pct(bench)}. Your ${rate.toFixed(2)}% is ${verdict}.`,
      `Best constituent today: ${cheapest.venue} ${cheapest.asset} at ${pct(cheapest[side])}, `
        + `utilisation ${pct(cheapest.utilization)}.`,
      ix.venues.length === 1
        ? `Note: this index covers one venue, so it is a reading of that venue rather than a market average.`
        : ""
    ].filter(Boolean).join("\n"));
  } catch(e){ return fail(e); }
});

/* ------------------------------------------------------------------ */
/* 3. venue by venue                                                   */
/* ------------------------------------------------------------------ */
server.registerTool("list_markets", {
  title: "List the lending markets behind a rate",
  description:
    "Every venue and asset in an index, with its borrow rate, supply rate, " +
    "utilisation, depth and weight. Utilisation explains why a rate sits where it does.",
  inputSchema: {
    index: z.enum(["SBOR-USD","SBOR-BTC","SBOR-STX"]).optional()
      .describe("Currency index. Omit for all of them.")
  }
}, async ({ index }) => {
  try {
    const d = await getJson("/api/v1/latest.json");
    const entries = index
      ? (d.indices[index] ? [[index, d.indices[index]]] : [])
      : Object.entries(d.indices);
    if (!entries.length) return text(`${index} is not published in the current fixing.`);

    const out = entries.map(([label, ix]) =>
      `${label}\n` + ix.markets.map(m =>
        `  ${m.venue} ${m.asset}: borrow ${pct(m.borrow)}, supply ${pct(m.supply)}, `
        + `utilisation ${pct(m.utilization)}, depth ${usd(m.depthUsd)}, weight ${(m.weight*100).toFixed(1)}%`
        + (m.protocolYield ? `, plus ${pct(m.protocolYield)} protocol yield from the asset itself` : "")
      ).join("\n")).join("\n\n");
    return text(out + `\n\nSource: ${BASE}/api/v1/latest.json`);
  } catch(e){ return fail(e); }
});

/* ------------------------------------------------------------------ */
/* 4. history                                                          */
/* ------------------------------------------------------------------ */
server.registerTool("get_history", {
  title: "Get the SBOR history",
  description:
    "Daily fixings since the index began. Use this to see whether a rate is " +
    "unusual, or how the cost of capital has moved.",
  inputSchema: {
    index: z.enum(["SBOR-USD","SBOR-BTC","SBOR-STX"]).describe("Which currency."),
    days: z.number().int().min(1).max(365).optional().describe("How many days back. Default 30.")
  }
}, async ({ index, days = 30 }) => {
  try {
    const h = await getJson("/api/v1/history.json", 300_000);
    const cutoff = new Date(Date.now() - days*864e5).toISOString().slice(0,10);
    const rows = h.filter(r => r.date >= cutoff && r[index]);
    if (!rows.length) return text(`No ${index} fixings in the last ${days} days.`);

    const lines = rows.map(r => {
      const e = r[index];
      if (e.withdrawn) return `${r.date}: withdrawn. ${e.reason}`;
      return `${r.date}: borrow ${pct(e.borrow)}, supply ${pct(e.supply)}`;
    });
    const withdrawn = rows.filter(r => r[index].withdrawn).length;
    const valid = rows.filter(r => !r[index].withdrawn && typeof r[index].borrow === "number");
    const avg = valid.length
      ? (valid.reduce((a,r)=>a+r[index].borrow,0)/valid.length).toFixed(2) : null;
    return text([
      `${index}, last ${days} days, ${rows.length} fixings`,
      ...lines,
      withdrawn ? `\n${withdrawn} fixing${withdrawn>1?"s":""} in this window ${withdrawn>1?"were":"was"} withdrawn and ${withdrawn>1?"are":"is"} excluded from the mean. Withdrawn fixings stay in the record rather than being deleted.` : "",
      avg ? `\nSimple mean borrow over the period: ${avg}%. For a compounded term average use get_rate, which carries termAverages once a full window exists.` : ""
    ].filter(Boolean).join("\n"));
  } catch(e){ return fail(e); }
});

/* ------------------------------------------------------------------ */
/* 5. how does Stacks compare                                          */
/* ------------------------------------------------------------------ */
server.registerTool("compare_chains", {
  title: "Compare Stacks rates against the largest lending market elsewhere",
  description:
    "Reference rates from Aave V3 on Ethereum for the same asset classes, " +
    "published beside the Stacks indices. Context only: these are never " +
    "constituents of an SBOR index.",
  inputSchema: {}
}, async () => {
  try {
    const d = await getJson("/api/v1/latest.json");
    if (!d.externalReference) return text("No external reference in the current fixing.");
    const ext = d.externalReference.markets.map(m =>
      `${m.venue} ${m.asset}: borrow ${pct(m.borrow)}, supply ${pct(m.supply)}, `
      + `utilisation ${pct(m.utilization)}, depth ${usd(m.depthUsd)} (compare with ${m.comparableTo})`
    ).join("\n");
    const stacks = Object.entries(d.indices).map(([l,ix]) =>
      `${l}: borrow ${pct(ix.borrow)}, supply ${pct(ix.supply)}`).join("\n");
    return text(`Stacks\n${stacks}\n\nElsewhere\n${ext}\n\n${d.externalReference.note}`);
  } catch(e){ return fail(e); }
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
    const r = await fetch(`${BASE}/llms.txt`, { headers:{ "user-agent":UA } });
    if (!r.ok) throw new Error(`llms.txt responded ${r.status}`);
    return text(await r.text());
  } catch(e){ return fail(e); }
});

await server.connect(new StdioServerTransport());
