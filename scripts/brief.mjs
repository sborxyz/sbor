#!/usr/bin/env node
/**
 * The morning brief.
 *
 * Reads the published record, computes every number itself, and asks a model to
 * write what moved in plain words. The model is given facts and nothing else: it
 * cannot fetch, cannot compute, and is told explicitly that any figure not in
 * the payload does not exist. A benchmark that publishes an invented number has
 * failed at the only thing it does.
 *
 * If the model is unreachable the brief still goes out, as the raw findings.
 * Silence would be the worst outcome.
 */
import { writeFileSync } from "node:fs";

const BASE = process.env.SBOR_BASE || "https://sbor.xyz";
const MODEL = process.env.BRIEF_MODEL || "claude-sonnet-5";
const TIMEOUT = 20_000;
const log = (...a) => console.error(...a);

const F = n => (n == null || !Number.isFinite(Number(n))) ? null : Number(Number(n).toFixed(2));
const bps = (a, b) => (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b))
  ? null : Math.round((a - b) * 100);
const pctChg = (a, b) => (a == null || b == null || !b) ? null : Number((((a - b) / b) * 100).toFixed(1));

async function get(path){
  const r = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT)
  });
  if (!r.ok) throw new Error(`${path} responded ${r.status}`);
  return r.json();
}

/* ---------- gather ---------- */

const [history, latest] = await Promise.all([
  get("/api/v1/history.json"),
  get("/api/v1/latest.json")
]);

history.sort((a, b) => a.date.localeCompare(b.date));
const today = history[history.length - 1] || {};
const d1    = history[history.length - 2] || {};
const d7    = history[Math.max(0, history.length - 8)] || {};

if (!today.date) { log("no history"); process.exit(1); }

const INDICES = ["SBOR-USD", "SBOR-BTC", "SBOR-STX"];
const px = r => r["SBOR-PoX"] || {};

/* Every figure the brief may mention is computed here. Nothing else exists. */
const facts = {
  date: today.date,
  fixing: latest.fixing,
  methodologyVersion: latest.methodologyVersion,
  fixingsInRecord: history.length,
  comparedWith: { previous: d1.date ?? null, sevenBack: d7.date ?? null },

  indices: INDICES.map(label => {
    const n = today[label], a = d1[label], b = d7[label];
    if (!n) return { label, published: false, publishedYesterday: !!a };
    return {
      label, published: true,
      borrow: F(n.borrow), borrow1d: bps(n.borrow, a?.borrow), borrow7d: bps(n.borrow, b?.borrow),
      supply: F(n.supply), supply1d: bps(n.supply, a?.supply),
      utilization: F(n.utilization), utilization1d: bps(n.utilization, a?.utilization),
      depthUsd: n.depthUsd, depth1dPct: pctChg(n.depthUsd, a?.depthUsd),
      venues: n.venues ?? null,
      markets: (n.markets || []).map(m => {
        const am = (a?.markets || []).find(x => x.v === m.v && x.a === m.a);
        return {
          venue: m.v, asset: m.a,
          borrow: F(m.b), borrow1d: bps(m.b, am?.b),
          supply: F(m.s), supply1d: bps(m.s, am?.s),
          utilization: F(m.u), utilization1d: bps(m.u, am?.u),
          depthUsd: m.d, depth1dPct: pctChg(m.d, am?.d),
          protocolYield: F(m.py)
        };
      })
    };
  }),

  staking: {
    poxApy: F(px(today).apy), poxApy1d: bps(px(today).apy, px(d1).apy),
    cycle: px(today).cycle ?? null,
    crossSmoothed: px(today).stxPerBtcSmoothed ?? null,
    crossSpot: px(today).stxPerBtc ?? null,
    crossSpot1dPct: pctChg(px(today).stxPerBtc, px(d1).stxPerBtc),
    nativeStacking: F(today.ctx?.nativeStacking),
    stBtc: F(today.ctx?.stBtc),
    liquidityCostBps: today.ctx?.liquidityCostBps ?? null,
    liquidityCost1d: (today.ctx?.liquidityCostBps != null && d1.ctx?.liquidityCostBps != null)
      ? today.ctx.liquidityCostBps - d1.ctx.liquidityCostBps : null
  },

  world: {
    sofr: F(today.ctx?.sofr), sofr1d: bps(today.ctx?.sofr, d1.ctx?.sofr),
    sofrDate: today.ctx?.sofrDate ?? null,
    btcUsd: today.ctx?.btcUsd, btc1dPct: pctChg(today.ctx?.btcUsd, d1.ctx?.btcUsd),
    stxUsd: today.ctx?.stxUsd, stx1dPct: pctChg(today.ctx?.stxUsd, d1.ctx?.stxUsd),
    sbtcSupply: today.ctx?.sbtcSupply, sbtcSupply1dPct: pctChg(today.ctx?.sbtcSupply, d1.ctx?.sbtcSupply)
  },

  offStacks: (today.external || []).map(m => {
    const a = (d1.external || []).find(x => x.v === m.v && x.a === m.a);
    return { venue: m.v, asset: m.a, borrow: F(m.b), borrow1d: bps(m.b, a?.b),
             supply: F(m.s), utilization: F(m.u), depthUsd: m.d };
  })
};

/* ---------- what crossed a threshold ---------- */

const flags = [];
for (const ix of facts.indices){
  if (!ix.published && ix.publishedYesterday) flags.push(`${ix.label} is not published today. It was yesterday.`);
  if (!ix.published) continue;
  if (ix.borrow1d != null && Math.abs(ix.borrow1d) >= 25)
    flags.push(`${ix.label} borrow moved ${ix.borrow1d > 0 ? "+" : ""}${ix.borrow1d} bps to ${ix.borrow}%.`);
  for (const m of ix.markets){
    if (m.utilization != null && m.utilization >= 90)
      flags.push(`${m.venue} ${m.asset} is ${m.utilization}% utilized. Withdrawals may be constrained.`);
    if (m.utilization1d != null && Math.abs(m.utilization1d) >= 300)
      flags.push(`${m.venue} ${m.asset} utilization moved ${(m.utilization1d/100).toFixed(1)} points to ${m.utilization}%.`);
    if (m.borrow1d != null && Math.abs(m.borrow1d) >= 40)
      flags.push(`${m.venue} ${m.asset} borrow moved ${m.borrow1d > 0 ? "+" : ""}${m.borrow1d} bps to ${m.borrow}%.`);
    if (m.depth1dPct != null && Math.abs(m.depth1dPct) >= 8)
      flags.push(`${m.venue} ${m.asset} depth moved ${m.depth1dPct > 0 ? "+" : ""}${m.depth1dPct}%.`);
  }
}
if (facts.world.sofr1d != null && Math.abs(facts.world.sofr1d) >= 10)
  flags.push(`SOFR moved ${facts.world.sofr1d > 0 ? "+" : ""}${facts.world.sofr1d} bps to ${facts.world.sofr}%, which is large for an overnight rate.`);
if (facts.staking.crossSpot1dPct != null && Math.abs(facts.staking.crossSpot1dPct) >= 5)
  flags.push(`The BTC to STX cross moved ${facts.staking.crossSpot1dPct}% on spot. The seven day mean absorbs most of it.`);
if (today.methodologyVersion !== d1.methodologyVersion)
  flags.push(`Methodology changed from ${d1.methodologyVersion} to ${today.methodologyVersion}. Figures either side are on a different basis.`);

/* Same exposure legs. Borrowing a yield bearing token means owing its yield, so
   the raw rates suggest carry that is not there. Computed rather than described,
   because an agent reading the raw rates would get this wrong. */
const stx = facts.indices.find(i => i.label === "SBOR-STX");
if (stx?.published){
  const plain = stx.markets.find(m => m.asset === "STX");
  const yld   = stx.markets.find(m => m.asset === "stSTX");
  if (plain && yld && yld.protocolYield != null){
    const py = yld.protocolYield;
    facts.sameExposure = [
      { leg: "supply STX, borrow stSTX", earn: plain.supply, trueCost: F(yld.borrow + py),
        netBps: Math.round((plain.supply - (yld.borrow + py)) * 100),
        ignoringYieldBps: Math.round((plain.supply - yld.borrow) * 100) },
      { leg: "supply stSTX, borrow STX", earn: F(yld.supply + py), trueCost: plain.borrow,
        netBps: Math.round(((yld.supply + py) - plain.borrow) * 100),
        ignoringYieldBps: Math.round((yld.supply - plain.borrow) * 100) }
    ];
    for (const l of facts.sameExposure)
      if (l.netBps > 0) flags.push(`Same exposure: ${l.leg} nets +${l.netBps} bps after the protocol yield. Worth checking whether it is real.`);
  }
}
facts.flags = flags;

log(`brief for ${facts.date}: ${flags.length} flag(s)`);

/* ---------- write ---------- */

const SYSTEM = `You write the morning brief for SBOR, the benchmark lending rate for Stacks. You are writing for the person who maintains it, who already knows what every field means.

RULES, in order of importance.

1. Every number you write must appear in the JSON you are given. You cannot fetch anything, and any figure not in the payload does not exist. If you are unsure of a number, leave it out. A benchmark that publishes an invented figure has failed at the only thing it does.

2. Never state a cause. Report what moved, not why. "STX utilization rose 5 points and the rate followed" is right. "Someone levered up" is not, however obvious it seems.

3. Never blend a staking yield with a lending rate. PoX and protocol yield come from holding an asset. Borrow and supply rates come from the loan. They are different instruments and adding them is the most common mistake in this ecosystem.

4. Utilization explains the rate. A cheap rate at low utilization means nobody is borrowing. A cheap rate above 90% means the pool is nearly empty and withdrawals may be constrained. Say which when it matters.

5. If nothing crossed a threshold, say so in one line and stop. Most days are quiet and a brief that manufactures drama is worse than no brief.

STYLE.
Plain English, US spelling. Short sentences. No em dashes. No bullet points unless listing three or more separate things. Do not greet, do not sign off, do not say "here is your brief". Start with what matters.

Aim for 120 words on a quiet day and up to 250 when something genuinely moved. Lead with the largest move. Mention the three index rates once each. Note SOFR only if it moved or if the gap to SBOR-USD is worth remarking on.

The flags array is what crossed a threshold. Use it as your agenda, not as your text: write it properly rather than listing it back.`;

async function write(){
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no ANTHROPIC_API_KEY");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    signal: AbortSignal.timeout(TIMEOUT),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(facts) }]
    })
  });
  if (!r.ok) throw new Error(`anthropic responded ${r.status}: ${(await r.text()).slice(0,200)}`);
  const d = await r.json();
  const text = (d.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim();
  if (!text) throw new Error("empty response");
  return text;
}

let body, wrote = "model";
try {
  body = await write();
} catch (e) {
  wrote = "fallback";
  log(`model unavailable, sending the findings raw. ${e.message}`);
  const ix = facts.indices.filter(i => i.published)
    .map(i => `${i.label} borrow ${i.borrow}%, supply ${i.supply}%`).join("\n");
  body = flags.length
    ? `${ix}\n\n${flags.map(f => `- ${f}`).join("\n")}`
    : `${ix}\n\nNothing crossed a threshold since the last fixing.`;
}

const msg = `SBOR morning brief, ${facts.date}\n\n${body}\n\n——— not part of any post ———\nsbor.xyz/desk.html`;
writeFileSync("brief.txt", msg + "\n");
log(`brief written by ${wrote}, ${msg.length} chars`);

/* ---------- send ---------- */

const TG = process.env.TELEGRAM_BOT_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;
if (TG && CHAT){
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text: msg, disable_web_page_preview: true })
  });
  if (!r.ok) log(`telegram ${r.status}: ${(await r.text()).slice(0,200)}`);
  else log("sent");
} else {
  log("no telegram credentials, brief written to brief.txt only");
  console.log(msg);
}
