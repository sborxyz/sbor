#!/usr/bin/env node
/**
 * Who used SBOR's MCP server in the last 24 hours, from the worker's own logs.
 *
 * Reads Cloudflare's Workers Observability for the sbor-mcp worker with a
 * read-only key (CLOUDFLARE_API_TOKEN, permission Workers Observability:Read)
 * and prints one line, sent to Telegram by the workflow: connections from AI
 * apps by name, tool calls by tool and by app, and the count of directories and
 * monitors that only check the server is up.
 *
 * Nothing personal is read or kept: the logs hold an app's name, its software's
 * user-agent, the tool and the benchmark, never a person, an address or a rate.
 * Tool calls are fetched one by one and counted here, because grouped counts can
 * return only the top few groups; connections, which are mostly monitors, are
 * counted by Cloudflare, grouped by app.
 */
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "fb684d5e1039819b2b733050b38e203b";
const SERVICE = "sbor-mcp";
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/observability/telemetry/query`;
const HOURS = Number(process.env.USAGE_HOURS || 24);

/* AI apps, matched loosely on the name an app gives itself. Everything else is
   a directory, registry, crawler or uptime monitor. */
const AI_APPS = [
  ["Claude Code", /claude[-_ ]?code/i],
  ["Claude", /anthropic|claude/i],
  ["ChatGPT", /openai|chatgpt/i],
  ["Cursor", /cursor/i],
  ["Codex", /codex/i],
  ["Windsurf", /windsurf|codeium/i],
  ["VS Code", /vs ?code|visual studio code|copilot/i],
  ["Gemini", /gemini/i],
  ["Perplexity", /perplexity/i],
  ["Muse", /\bmuse\b|meta-ai/i],
  ["Goose", /goose/i],
  ["Cline", /\bcline\b/i]
];
const appOf = name => (AI_APPS.find(([, re]) => re.test(String(name || ""))) || [null])[0];

async function query(body){
  const r = await fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`Cloudflare responded ${r.status}: ${JSON.stringify(j.errors || j).slice(0, 300)}`);
  return j.result || {};
}

const base = (view, extra) => ({
  queryId: `sbor-usage-${view}`,
  view, dry: false,
  timeframe: { from: Date.now() - HOURS * 3600e3, to: Date.now() },
  ...extra
});
const service = { key: "$metadata.service", operation: "eq", type: "string", value: SERVICE };

/* Individual tool-call records. */
async function toolCalls(){
  const res = await query(base("events", { limit: 1000, parameters: {
    datasets: ["cloudflare-workers"],
    filters: [service, { key: "event", operation: "eq", type: "string", value: "tool" }]
  }}));
  const list = res.events?.events || res.events || [];
  return (Array.isArray(list) ? list : []).map(e => ({
    tool: e.tool ?? e.$metadata?.tool ?? e.source?.tool,
    ua: e.ua ?? e.source?.ua ?? null
  })).filter(t => t.tool);
}

/* Connections, fetched as individual records and counted here. Cloudflare's
   grouped counts stop early on high-volume data and returned partial numbers
   (mcpbeat at 1 a day instead of about 80), so nothing is grouped by the API.
   Records from before 7 October 2026 carry no ua. */
const CONNECT_LIMIT = 2000;
async function connections(){
  const res = await query(base("events", { limit: CONNECT_LIMIT, parameters: {
    datasets: ["cloudflare-workers"],
    filters: [service, { key: "event", operation: "eq", type: "string", value: "connect" }]
  }}));
  const list = res.events?.events || res.events || [];
  const rows = (Array.isArray(list) ? list : []).map(e => ({
    client: String(e.client ?? e.source?.client ?? "unknown"),
    ua: e.ua ?? e.source?.ua ?? null
  }));
  const counts = {};
  for (const r of rows){ const k = r.client + "\u0000" + (r.ua ?? ""); counts[k] = (counts[k] || 0) + 1; }
  const mapping = Object.entries(counts).map(([k, n]) => { const [client, ua] = k.split("\u0000"); return { client, ua: ua || null, n }; });
  const byClient = {};
  for (const m of mapping) byClient[m.client] = (byClient[m.client] || 0) + m.n;
  return { conns: Object.entries(byClient).map(([client, n]) => ({ client, n })), mapping, capped: rows.length >= CONNECT_LIMIT };
}

const tally = (items, keyOf) => items.reduce((m, x) => { const k = keyOf(x); m[k] = (m[k] || 0) + (x.n ?? 1); return m; }, {});
const fmt = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");

export function summarize(conns, tools, mapping = conns, capped = false){
  const uaToApp = {};
  for (const c of mapping){ const app = appOf(c.client); if (app && c.ua) uaToApp[c.ua] = app; }
  const aiConns = conns.filter(c => appOf(c.client));
  const monitors = conns.filter(c => !appOf(c.client));
  const byApp = tally(aiConns, c => appOf(c.client));
  const byTool = tally(tools, t => t.tool);
  const toolsByApp = tally(tools, t => uaToApp[t.ua] || "unattributed");
  const nMon = monitors.reduce((s, c) => s + c.n, 0);
  const nMonNames = new Set(monitors.map(c => c.client)).size;
  const parts = [];
  parts.push(aiConns.length ? `AI apps connected ${aiConns.reduce((s, c) => s + c.n, 0)} times (${fmt(byApp)})` : "no AI app connected");
  parts.push(tools.length ? `${tools.length} tool calls (${fmt(byTool)}; by app: ${fmt(toolsByApp)})` : "no tool calls");
  parts.push(`${capped ? "at least " : ""}${nMon.toLocaleString("en-US")} ${nMon === 1 ? "check" : "checks"} from ${nMonNames} ${nMonNames === 1 ? "directory or monitor" : "directories and monitors"}`);
  return `SBOR's MCP server, last ${HOURS} hours, from Cloudflare's sampled logs: ${parts.join("; ")}.`;
}

async function main(){
  if (!process.env.CLOUDFLARE_API_TOKEN){ console.log("usage: no CLOUDFLARE_API_TOKEN, nothing read"); return; }
  const [{ conns, mapping, capped }, tools] = await Promise.all([connections(), toolCalls()]);
  if (process.env.USAGE_DEBUG) console.error(JSON.stringify({ records: conns.reduce((t, c) => t + c.n, 0), capped, conns: conns.slice(0, 12), tools: tools.slice(0, 10) }));
  console.log(summarize(conns, tools, mapping, capped));
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch(e => { console.log(`usage: not read. ${e.message}`); process.exitCode = 1; });
