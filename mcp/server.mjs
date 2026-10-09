#!/usr/bin/env node
/**
 * SBOR MCP server.
 *
 * Exposes SBOR, benchmark lending rates for Bitcoin DeFi, as tools any MCP
 * client can call: Claude, an agent framework, or anything else that speaks the
 * protocol. Rates are read from contract state on Ethereum, Base, Arc,
 * Arbitrum, BNB Chain and Stacks, and each day's fixing is also posted on-chain, on Arc, Base,
 * Hyperliquid, Solana and Stacks.
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

const VERSION = "1.3.0";
const BASE = process.env.SBOR_BASE || "https://sbor.xyz";
const UA = `sbor-mcp/${VERSION}`;
const TIMEOUT_MS = 10_000;
const STALE_AFTER_HOURS = 48;
const INDICES = ["SBOR-USD", "SBOR-BTC", "SBOR-STX"];

/* Borrowing dollars against bitcoin. From methodology 1.13.0, which takes
   effect with the fixing of 14 October 2026, SBOR's headline is
   BTC-COLLATERAL-USD: every dollar stablecoin lent against plain 1:1 bitcoin,
   on every chain SBOR reads, with a rate per stablecoin beside it once $25M or
   more of it carries weight. BTC-COLLATERAL-USDC keeps its name as the USDC
   rate. Before that date only BTC-COLLATERAL-USDC exists, from Morpho on Base,
   Ethereum and Arc, and the other codes answer "not published yet". */
const HEADLINE = "BTC-COLLATERAL-USD";
const BTC_REF = "BTC-COLLATERAL-USDC";
const BTC_CODES = [HEADLINE, BTC_REF, "BTC-COLLATERAL-USDT", "BTC-COLLATERAL-RLUSD", "BTC-COLLATERAL-PYUSD", "BTC-COLLATERAL-USD1"];
const BENCHMARKS = [...INDICES, ...BTC_CODES];
const EFFECTIVE_113 = "14 October 2026";
const NOTICE_113 = "https://github.com/sborxyz/sbor/blob/main/METHODOLOGY-1.13.0.md";
const isBtc = code => BTC_CODES.includes(code);

/* What each bitcoin-collateral code measures, in the fixing at hand. */
function btcWhat(d, code){
  if (!d.bitcoinCollateralUsd)
    return "a reference, not an SBOR index: what it costs to borrow USDC against bitcoin wrapped by a custodian (cbBTC, WBTC, cirBTC), from the Morpho markets on Base, Ethereum and Arc whose only collateral is that bitcoin, weighted by the USDC supplied to each. A newly added market phases in over 30 days. Rates are effective APY";
  const tok = code.replace("BTC-COLLATERAL-", "");
  const base = "every eligible market whose only collateral is plain 1:1 bitcoin (WBTC, cbBTC, BTCB, kBTC, cirBTC, tBTC, sBTC), on Morpho, Lista and Granite, read from contract state and weighted by what is supplied times a 30-day phase-in for new markets. Rates are effective APY";
  if (code === HEADLINE) return `the SBOR headline: what it costs to borrow any dollar stablecoin against plain bitcoin, across ${base}`;
  return `the ${tok} rate under the SBOR headline: what it costs to borrow ${tok}${tok === "USDC" ? " (or USDCx on Stacks)" : ""} against plain bitcoin, across ${base}`;
}

/* One bitcoin-collateral rate in a common shape, or a reason it is absent. */
function btcRate(d, code){
  const head = d.bitcoinCollateralUsd;
  if (!head && code !== BTC_REF)
    return { absent: `${code} is not published yet. It starts with methodology 1.13.0, from the fixing of ${EFFECTIVE_113} (${NOTICE_113}). Until then compare with ${BTC_REF}.` };
  const name = m => ({ ...m, venue: `${m.venue || "Morpho"} on ${m.chain}`, asset: `${m.collateral}/${m.loan || "USDC"}` });
  if (code === BTC_REF){
    const r = d.bitcoinCollateralUsdc;
    if (!r) return { absent: `${code} is not in the current fixing. Treat it as unknown, never as zero.` };
    return { borrow: r.borrow, supply: r.supply, depthUsd: r.depthUsd, withheld: r.withheld, notRead: r.notRead, markets: (r.markets || []).map(name) };
  }
  if (code === HEADLINE)
    return { borrow: head.borrow, supply: head.supply, depthUsd: head.depthUsd, withheld: head.withheld, notRead: head.notRead,
             venues: head.venues, chains: head.chains, largest: head.largestConstituentWeight, markets: (head.markets || []).map(name) };
  const sub = head.subRates?.[code], group = code.replace("BTC-COLLATERAL-", "");
  if (!sub) return { absent: `${code} is not published in the current fixing: a stablecoin gets its own rate once $25M or more of it carries weight. Compare with ${HEADLINE}, the rate across every dollar stablecoin.` };
  const ms = (head.markets || []).filter(m => m.group === group);
  const w = ms.reduce((a, m) => a + (m.weight || 0), 0);
  return { borrow: sub.borrow, supply: sub.supply, depthUsd: sub.depthUsd, withheld: sub.withheld,
           markets: ms.map(m => ({ ...name(m), weight: w ? m.weight / w : 0 })) };
}
const btcLine = (d, code) => {
  const r = btcRate(d, code);
  if (r.absent) return r.absent;
  if (typeof r.borrow !== "number")
    return `${code}: not published in the current fixing${r.withheld ? `, ${r.withheld}` : ""}. Treat it as unknown, never as zero.`;
  return `${code}: borrow ${pct(r.borrow)} APY, supply ${pct(r.supply)} APY, across ${usd(r.depthUsd)} supplied`
    + (r.chains ? `, ${r.chains} chains, ${r.venues} venues, largest market ${(r.largest * 100).toFixed(0)}% of the weight` : "") + `. This is ${btcWhat(d, code)}.`;
};
/* Every bitcoin-collateral line the fixing carries, headline first. */
const btcLines = d => d.bitcoinCollateralUsd
  ? [btcLine(d, HEADLINE), ...Object.keys(d.bitcoinCollateralUsd.subRates || {}).filter(k => k !== HEADLINE).map(k => btcLine(d, k))]
  : [btcLine(d, BTC_REF)];

/* Each day's fixing is also posted on-chain, for contracts and agents that
   read chains rather than APIs. The JSON API remains the authoritative record. */
const ONCHAIN = "Also on-chain each day: on Arc and on Hyperliquid's HyperEVM, contract 0x56B5417de539153994fF6785F8a3b56421C9eb4f, and on Base, contract 0xfc968C7A39bA80b1F6E3c0c058311EbD5d724323 (latest(bytes32)); on Stacks, contract SP2SRS600PZ70VHY09CK06FSYKW546NY2ARG6N8CD.sbor-fixings (get-latest); on Solana, program 85uzArk6VwzWG6mxZC7D2jLEPGhFL2SXzJs7P9zQUSz9, rates account 85F1segB7Mrsj8ZFsGBGCpNHfuu1qEwLxmQEykphtFtF. Rates there are in basis points.";
const NOT_ADVICE = "Market data, not financial advice.";

/* All SBOR tools only read published data. */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

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
  : n >= 1e9 ? "$" + (n / 1e9).toFixed(1) + "B" : "$" + (n / 1e6).toFixed(1) + "M";

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
  annotations: READ_ONLY,
  description:
    "SBOR's benchmark borrow and supply rates, read from lending contract state: " +
    `${HEADLINE}, what it costs to borrow dollars against bitcoin, with a rate per stablecoin ` +
    "(from 14 October 2026), and the currency indices for lending on Stacks. " +
    "Use this to judge whether a lending offer is good: " +
    "borrowing above the SBOR borrow rate means paying more than the market, " +
    "supplying below the supply rate means earning less. Returns every currency " +
    "index unless one is named. Always read the freshness line first.",
  inputSchema: {
    index: z.enum(BENCHMARKS).optional().describe(`${HEADLINE} for borrowing any dollar stablecoin against bitcoin, BTC-COLLATERAL-<stablecoin> for one stablecoin, or a Stacks currency index. Omit for all of them.`)
  }
}, async ({ index }) => {
  try {
    const d = await getJson("/api/v1/latest.json");
    if (isBtc(index))
      return text([freshness(d), btcLine(d, index), ONCHAIN, `Source: ${BASE}/api/v1/latest.json`].join("\n"));
    if (index && !d.indices[index])
      return text(`${index} is not published in the current fixing. `
        + `When a market cannot be read, or its rate is not set by the market, SBOR `
        + `omits the index rather than publishing a figure it cannot stand behind. `
        + `Treat it as unknown, never as zero. `
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
      ...(index ? [] : btcLines(d)),
      ...(index || !d.bitcoinCollateralUsd ? [] : ["SBOR Stacks, lending on Stacks:"]),
      ...lines,
      omitted.length ? `Not published: ${omitted.join(", ")}. A market that cannot be read is omitted, not estimated.` : "",
      d.poxReference ? `Proof of Transfer staking yield ${pct(d.poxReference.apy)}. A staking yield, not a lending rate. Never add it to one.` : "",
      `Basis: ${d.basis}`,
      ONCHAIN,
      `Source: ${BASE}/api/v1/latest.json`
    ].filter(Boolean).join("\n"));
  } catch (e) { return fail(e); }
});

/* ------------------------------------------------------------------ */
/* 2. is this offer any good                                           */
/* ------------------------------------------------------------------ */
server.registerTool("compare_rate", {
  title: "Compare a rate against the SBOR benchmark",
  annotations: READ_ONLY,
  description:
    "Given a rate you have been offered, say whether it is above or below the " +
    "market for that currency, and by how much. This is the main reason SBOR exists. " +
    "Recommended use: if a borrow offer is more than 50 basis points above the " +
    "benchmark, stop and ask a human. Use SBOR to stop, never to start. " +
    `For a dollar loan against bitcoin, compare with that stablecoin's rate (for example ${BTC_REF}) where one is published, else with ${HEADLINE}; ` +
    "for lending on Stacks against other collateral, with the index for the currency. " +
    "This tool refuses rather than guesses: an error result means there is no " +
    "trustworthy answer, not that the rate is bad.",
  inputSchema: {
    rate: z.number().gt(0).lte(100)
      .describe("The rate offered, as a percentage between 0 and 100. 4.2 means 4.2%, not 0.042."),
    side: z.enum(["borrow", "supply"]).describe("Whether you would be borrowing or supplying."),
    index: z.enum(BENCHMARKS).describe(`Which benchmark: ${HEADLINE} or BTC-COLLATERAL-<stablecoin> for borrowing dollars against bitcoin, or a Stacks currency index.`)
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

    /* The bitcoin-collateral reference has the same shape where it matters:
       a borrow and supply rate, and markets. */
    const isRef = isBtc(index);
    const br = isRef ? btcRate(d, index) : null;
    if (br?.absent) return refuse(br.absent);
    const ix = isRef
      ? (typeof br.borrow === "number" ? { borrow: br.borrow, supply: br.supply, markets: br.markets } : null)
      : d.indices[index];
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

    /* Only a full member can be named best: a market still phasing in is
       listed by list_markets, never recommended. A new market's rate can be
       mechanically low for weeks while its rate model adjusts. */
    const best = [...ix.markets]
      .filter(m => typeof m[side] === "number" && Number.isFinite(m[side]))
      .filter(m => typeof m.phaseIn !== "number" || m.phaseIn >= 1)
      .filter(m => typeof m.weight !== "number" || m.weight > 0)
      .sort((p, q) => side === "borrow" ? p[side] - q[side] : q[side] - p[side])[0];

    const stop = side === "borrow" && diff * 100 > 50
      ? `This is more than 50 basis points above the benchmark. Recommended: stop and ask a human before borrowing.`
      : "";

    return text([
      unitsWarning,
      `${index} ${side} benchmark is ${pct(bench)}. Your ${rate.toFixed(2)}% is ${verdict}.`,
      stop,
      best ? `Best constituent today: ${best.venue} ${best.asset} at ${pct(best[side])}, utilization ${pct(best.utilization)}.` : "",
      !isRef && ix.venues.length === 1 ? `Note: this index covers one venue, so it is a reading of that venue rather than a market average.` : "",
      isRef ? `${index} is ${btcWhat(d, index)}.` : `If this is a dollar loan against bitcoin, compare with ${d.bitcoinCollateralUsd ? HEADLINE + " or the stablecoin's own rate" : BTC_REF} instead: a Stacks index prices lending on Stacks.`,
      freshness(d),
      NOT_ADVICE
    ].filter(Boolean).join("\n"));
  } catch (e) { return fail(e); }
});

/* ------------------------------------------------------------------ */
/* 3. venue by venue                                                   */
/* ------------------------------------------------------------------ */
server.registerTool("list_markets", {
  title: "List the lending markets behind a rate",
  annotations: READ_ONLY,
  description:
    "Every venue and asset in an index, with its borrow rate, supply rate, " +
    "utilization, depth and weight. Utilization explains why a rate sits where it does.",
  inputSchema: {
    index: z.enum(BENCHMARKS).optional().describe(`${HEADLINE}, BTC-COLLATERAL-<stablecoin>, or a Stacks currency index. Omit for the Stacks indices.`)
  }
}, async ({ index }) => {
  try {
    const d = await getJson("/api/v1/latest.json");
    if (isBtc(index)){
      const ref = btcRate(d, index);
      if (ref.absent) return text(ref.absent);
      if (!ref.markets?.length) return text(`${index} is not published in the current fixing. Treat it as unknown, not as zero.`);
      return text([freshness(d), "", `${index}, ${btcWhat(d, index)}.`, ...ref.markets.map(m =>
        `  ${m.venue}, ${m.asset}${m.flags?.length ? ` [${m.flags.join(", ")}]` : ""}: borrow ${pct(m.borrow)}, supply ${pct(m.supply)}, `
        + `utilization ${pct(m.utilization)}, depth ${usd(m.depthUsd)}`
        + (typeof m.weight === "number" ? `, weight ${(m.weight * 100).toFixed(1)}%` : "")
        + (typeof m.phaseIn === "number" && m.phaseIn < 1 ? `, phasing in (${(m.phaseIn * 100).toFixed(0)}% of its full weight)` : "")),
        ref.notRead ? `Not read today: ${ref.notRead.join("; ")}. A rate is withheld when the markets not read carried a quarter or more of its weight.` : "",
        "", `Source: ${BASE}/api/v1/latest.json`].filter(Boolean).join("\n"));
    }
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
  annotations: READ_ONLY,
  description:
    "Daily fixings since each rate began. Use this to see whether a rate is " +
    "unusual, or how the cost of capital has moved. Means are given per " +
    "methodology version, never across a change in how the number is built.",
  inputSchema: {
    index: z.enum(BENCHMARKS).describe(`A Stacks currency index, ${HEADLINE} (from 14 October 2026), or BTC-COLLATERAL-<stablecoin>.`),
    days: z.number().int().min(1).max(200).optional().describe("How many days back, up to 200. Default 30.")
  }
}, async ({ index, days = 30 }) => {
  try {
    const h = await getJson("/api/v1/history.json", 300_000);
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    /* The bitcoin-collateral rates are kept compactly in each row: btcUsdc for
       BTC-COLLATERAL-USDC, btcCollateralUsd for the headline and, under sub,
       each stablecoin's rate. A withheld day has a null borrow. */
    const entry = r => {
      if (!isBtc(index)) return r[index];
      const c = index === BTC_REF ? r.btcUsdc : index === HEADLINE ? r.btcCollateralUsd : r.btcCollateralUsd?.sub?.[index];
      if (!c) return null;
      return c.b == null ? { withdrawn: true, reason: "withheld: markets not read carried too much of its weight" } : { borrow: c.b, supply: c.s };
    };
    const rows = h.filter(r => r.date >= cutoff && entry(r)).sort((p, q) => p.date.localeCompare(q.date));
    if (!rows.length) return text(`No ${index} fixings in the last ${days} days.`
      + (isBtc(index) && index !== BTC_REF ? ` It starts with methodology 1.13.0, from the fixing of ${EFFECTIVE_113}.` : ""));

    const lines = rows.map(r => {
      const e = entry(r);
      if (e.withdrawn) return `${r.date}: withdrawn. ${e.reason}`;
      return `${r.date}: borrow ${pct(e.borrow)}, supply ${pct(e.supply)}${r.methodologyVersion ? `  (v${r.methodologyVersion})` : "  (version not recorded)"}`;
    });

    const valid = rows.filter(r => !entry(r).withdrawn && Number.isFinite(entry(r).borrow));
    const withdrawn = rows.length - rows.filter(r => !entry(r).withdrawn).length;

    /* A mean across a methodology change averages two different definitions of
       the same number, so it is given per version instead. */
    const byVersion = {};
    for (const r of valid) {
      const v = r.methodologyVersion ?? "not recorded";
      (byVersion[v] ||= []).push(entry(r).borrow);
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
  annotations: READ_ONLY,
  description:
    "The same asset classes on the largest lending markets on Ethereum, Base, " +
    "Hyperliquid and Solana, plus SOFR, the US repo rate, and what it costs to " +
    "borrow dollars against bitcoin. Context only: none of " +
    "these is ever a constituent of an SBOR index. Every rate is read from the " +
    "venues' contracts (Aave on Ethereum and Base, HyperLend on Hyperliquid, Kamino " +
    "on Solana, Morpho for the bitcoin-collateral markets); DefiLlama picks the " +
    "largest market per chain, gives its size, and stands in only if a read fails.",
  inputSchema: {
    index: z.enum(INDICES).optional().describe("Only markets comparable to this index. Omit for all.")
  }
}, async ({ index }) => {
  try {
    const d = await getJson("/api/v1/latest.json");
    const all = d.externalReference?.markets ?? [];
    const ext = (index ? all.filter(m => m.comparableTo === index) : all).map(m =>
      `  ${m.venue} ${m.asset}: borrow ${pct(m.borrow)}, supply ${pct(m.supply)}, `
      + `utilization ${pct(m.utilization)}, `
      + (m.depthBasis === "supplied" ? `total supplied ${usd(m.depthUsd)}` : `total supplied n/a`)
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

    const code = d.bitcoinCollateralUsd ? HEADLINE : BTC_REF, ref = btcRate(d, code);
    const refLine = typeof ref.borrow === "number" && (!index || index === "SBOR-USD")
      ? `Borrowing dollars against bitcoin (${code}): ${pct(ref.borrow)} APY, across ${usd(ref.depthUsd)} supplied, read from the contracts. A dollar on Stacks is borrowed against any crypto collateral, not only bitcoin.`
      : "";

    return text([
      freshness(d), "",
      "Stacks", ...stacks, "",
      ...(refLine ? [refLine, ""] : []),
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
  annotations: READ_ONLY,
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
