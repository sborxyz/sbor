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
import { writeFileSync, readFileSync } from "node:fs";

const BASE = process.env.SBOR_BASE || "https://sbor.xyz";
const MODEL = process.env.BRIEF_MODEL || "claude-sonnet-5";
/* Reading the API is quick. The model thinks before it writes and that takes
   longer than a fetch, so the two get different allowances. */
const TIMEOUT = 20_000;
const MODEL_TIMEOUT = 120_000;
const log = (...a) => console.error(...a);

const F = n => (n == null || !Number.isFinite(Number(n))) ? null : Number(Number(n).toFixed(2));
const bps = (a, b) => (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b))
  ? null : Math.round((a - b) * 100);
const pctChg = (a, b) => (a == null || b == null || !b) ? null : Number((((a - b) / b) * 100).toFixed(1));

/* Inside the fixing job the brief runs seconds after the commit, before the
   site has rebuilt, so the website would still show yesterday. SBOR_LOCAL makes
   it read the files the fixing just wrote. Run on its own, it reads the site. */
const LOCAL = process.env.SBOR_LOCAL === "1";

async function get(path){
  if (LOCAL) return JSON.parse(readFileSync(path.replace(/^\//, ""), "utf8"));
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
      borrowPct: F(n.borrow), borrowChange1dBps: bps(n.borrow, a?.borrow), borrowChange7dBps: bps(n.borrow, b?.borrow),
      supplyPct: F(n.supply), supplyChange1dBps: bps(n.supply, a?.supply),
      utilizationPct: F(n.utilization), utilizationChange1dBps: bps(n.utilization, a?.utilization),
      depthUsd: n.depthUsd, depthChange1dPercent: pctChg(n.depthUsd, a?.depthUsd),
      venues: n.venues ?? null,
      markets: (n.markets || []).map(m => {
        const am = (a?.markets || []).find(x => x.v === m.v && x.a === m.a);
        return {
          venue: m.v, asset: m.a,
          borrowPct: F(m.b), borrowChange1dBps: bps(m.b, am?.b),
          supplyPct: F(m.s), supplyChange1dBps: bps(m.s, am?.s),
          utilizationPct: F(m.u), utilizationChange1dBps: bps(m.u, am?.u),
          depthUsd: m.d, depthChange1dPercent: pctChg(m.d, am?.d),
          protocolYieldPct: F(m.py)
        };
      })
    };
  }),

  staking: {
    poxApyPct: F(px(today).apy),
    /* No change across a measurement correction: it would read as a market move. */
    poxApyChange1dBps: (px(today).measurement ?? 1) === (px(d1).measurement ?? 1) ? bps(px(today).apy, px(d1).apy) : null,
    cycle: px(today).cycle ?? null,
    crossSmoothed: px(today).stxPerBtcSmoothed ?? null,
    crossSpot: px(today).stxPerBtc ?? null,
    crossSpotChange1dPercent: pctChg(px(today).stxPerBtc, px(d1).stxPerBtc),
    nativeStackingPct: F(today.ctx?.nativeStacking),
    stBtcPct: F(today.ctx?.stBtc),
    liquidityCostBps: today.ctx?.liquidityCostBps ?? null,
    liquidityCostChange1dBps: (today.ctx?.liquidityCostBps != null && d1.ctx?.liquidityCostBps != null)
      ? today.ctx.liquidityCostBps - d1.ctx.liquidityCostBps : null
  },

  world: {
    sofrPct: F(today.ctx?.sofr), sofrChange1dBps: bps(today.ctx?.sofr, d1.ctx?.sofr),
    sofrDate: today.ctx?.sofrDate ?? null,
    btcUsd: today.ctx?.btcUsd, btcChange1dPercent: pctChg(today.ctx?.btcUsd, d1.ctx?.btcUsd),
    stxUsd: today.ctx?.stxUsd, stxChange1dPercent: pctChg(today.ctx?.stxUsd, d1.ctx?.stxUsd),
    sbtcSupply: today.ctx?.sbtcSupply, sbtcSupplyChange1dPercent: pctChg(today.ctx?.sbtcSupply, d1.ctx?.sbtcSupply)
  },

  offStacks: (today.external || []).map(m => {
    const a = (d1.external || []).find(x => x.v === m.v && x.a === m.a);
    return { venue: m.v, asset: m.a, borrowPct: F(m.b), borrowChange1dBps: bps(m.b, a?.b),
             supplyPct: F(m.s), utilizationPct: F(m.u), depthUsd: m.d };
  })
};

/* ---------- what crossed a threshold ---------- */

const flags = [];
for (const ix of facts.indices){
  if (!ix.published && ix.publishedYesterday) flags.push(`${ix.label} is not published today. It was yesterday.`);
  if (!ix.published) continue;
  if (ix.borrowChange1dBps != null && Math.abs(ix.borrowChange1dBps) >= 25)
    flags.push(`${ix.label} borrow moved ${ix.borrowChange1dBps > 0 ? "+" : ""}${ix.borrowChange1dBps} bps to ${ix.borrowPct}%.`);
  for (const m of ix.markets){
    if (m.utilizationPct != null && m.utilizationPct >= 90)
      flags.push(`${m.venue} ${m.asset} is ${m.utilizationPct}% utilized. Withdrawals may be constrained.`);
    if (m.utilizationChange1dBps != null && Math.abs(m.utilizationChange1dBps) >= 300)
      flags.push(`${m.venue} ${m.asset} utilization moved ${m.utilizationChange1dBps > 0 ? "+" : ""}${m.utilizationChange1dBps} basis points to ${m.utilizationPct}%.`);
    if (m.borrowChange1dBps != null && Math.abs(m.borrowChange1dBps) >= 40)
      flags.push(`${m.venue} ${m.asset} borrow moved ${m.borrowChange1dBps > 0 ? "+" : ""}${m.borrowChange1dBps} bps to ${m.borrowPct}%.`);
    if (m.depthChange1dPercent != null && Math.abs(m.depthChange1dPercent) >= 8)
      flags.push(`${m.venue} ${m.asset} depth moved ${m.depthChange1dPercent > 0 ? "+" : ""}${m.depthChange1dPercent}%.`);
  }
}
if (facts.world.sofrChange1dBps != null && Math.abs(facts.world.sofrChange1dBps) >= 10)
  flags.push(`SOFR moved ${facts.world.sofrChange1dBps > 0 ? "+" : ""}${facts.world.sofrChange1dBps} bps to ${facts.world.sofrPct}%, which is large for an overnight rate.`);
if ((px(today).measurement ?? 1) !== (px(d1).measurement ?? 1))
  flags.push(`SBOR-PoX is measured the corrected way from today: the chain's exact cycle window and that cycle's own STX locked. Today's figure is not comparable with yesterday's, so no change is reported.`);
if (facts.staking.crossSpotChange1dPercent != null && Math.abs(facts.staking.crossSpotChange1dPercent) >= 5)
  flags.push(`The BTC to STX cross moved ${facts.staking.crossSpotChange1dPercent}% on spot. The seven day mean absorbs most of it.`);
if (today.methodologyVersion !== d1.methodologyVersion)
  flags.push(`Methodology changed from ${d1.methodologyVersion} to ${today.methodologyVersion}. Figures either side are on a different basis.`);

/* Same exposure legs. Borrowing a yield bearing token means owing its yield, so
   the raw rates suggest carry that is not there. Computed rather than described,
   because an agent reading the raw rates would get this wrong. */
const stx = facts.indices.find(i => i.label === "SBOR-STX");
if (stx?.published){
  const plain = stx.markets.find(m => m.asset === "STX");
  const yld   = stx.markets.find(m => m.asset === "stSTX");
  if (plain && yld && yld.protocolYieldPct != null){
    const py = yld.protocolYieldPct;
    facts.sameExposure = [
      { leg: "supply STX, borrow stSTX", earn: plain.supplyPct, trueCost: F(yld.borrowPct + py),
        netBps: Math.round((plain.supplyPct - (yld.borrowPct + py)) * 100),
        ignoringYieldBps: Math.round((plain.supplyPct - yld.borrowPct) * 100) },
      { leg: "supply stSTX, borrow STX", earn: F(yld.supplyPct + py), trueCost: plain.borrowPct,
        netBps: Math.round(((yld.supplyPct + py) - plain.borrowPct) * 100),
        ignoringYieldBps: Math.round((yld.supplyPct - plain.borrowPct) * 100) }
    ];
    for (const l of facts.sameExposure)
      if (l.netBps > 0) flags.push(`Same exposure: ${l.leg} nets +${l.netBps} bps after the protocol yield. Worth checking whether it is real.`);
  }
}

/* A protocol changing its own parameters is always worth a line, because it
   moves rates without any borrower doing anything. Read from the change feed
   the fixing just wrote. A missing or unreadable feed is simply skipped. */
try {
  const feed = await get("/api/v1/changes.json");
  const show = v => (typeof v === "number" ? `${v}` : v ?? "none");
  for (const c of (feed.changes || []).filter(c => c.date === facts.date)){
    flags.push(c.parameter === "market"
      ? `New market in the fixing for the first time: ${c.market}.`
      : `Parameter change read from the contract: ${c.market}, ${c.label}, from ${show(c.from)} to ${show(c.to)}. The protocol changed this itself; it is not a market move.`);
  }
} catch (e) { log(`change feed not read: ${e.message}`); }
facts.flags = flags;

/* Every move written out whole: what moved, from where, to where. On 23
   September the model paired the Zest STX market's 150 bps fall with the
   SBOR-STX index level of 0.46%, when the market was at 0.92%. It had both
   numbers side by side and still crossed them, so it is no longer asked to pair
   anything: it quotes a phrase that already carries its own start and end. */
const moves = [];
function addMove(subject, field, now, changeBps){
  if (now == null || changeBps == null || changeBps === 0) return;
  const was = Number((now - changeBps / 100).toFixed(2));
  moves.push({
    subject, field, fromPct: was, toPct: now, changeBps,
    phrase: `${subject} ${field} ${changeBps > 0 ? "up" : "down"} ${Math.abs(changeBps)} basis points, from ${was.toFixed(2)}% to ${Number(now).toFixed(2)}%`
  });
}
for (const ix of facts.indices){
  if (!ix.published) continue;
  addMove(`${ix.label} index`, "borrow", ix.borrowPct, ix.borrowChange1dBps);
  addMove(`${ix.label} index`, "supply", ix.supplyPct, ix.supplyChange1dBps);
  addMove(`${ix.label} index`, "utilization", ix.utilizationPct, ix.utilizationChange1dBps);
  for (const m of ix.markets){
    addMove(`${m.venue} ${m.asset} market`, "borrow", m.borrowPct, m.borrowChange1dBps);
    addMove(`${m.venue} ${m.asset} market`, "supply", m.supplyPct, m.supplyChange1dBps);
    addMove(`${m.venue} ${m.asset} market`, "utilization", m.utilizationPct, m.utilizationChange1dBps);
  }
}
facts.moves = moves;

log(`brief for ${facts.date}: ${flags.length} flag(s)`);

/* ---------- write ---------- */

const SYSTEM = `You write the morning brief for SBOR, the benchmark lending rate for Stacks. You are writing for the person who maintains it, who already knows what every field means.

RULES, in order of importance.

0. UNITS. Get these wrong and the brief is worthless.

A field ending **Bps** is a change in basis points. One basis point is one hundredth of one percentage point. A borrow rate going from 2.30% to 2.56% is a **26 basis point** move. It is not 26%, not "up 26%", and not 26 points.

**Never write "points" when you mean basis points.** A point is one hundred basis points. Utilization moving from 84.83% to 85.43% is 60 basis points, which is 0.6 of a point. Writing "60 points" claims a move a hundred times larger than the one that happened. Write "basis points" in full every time, or write "bps". Never "points" alone.

A field ending **Percent** is a percentage change, so write it with a percent sign: depth up 8.2%.

A field ending **Pct** is a level already expressed as a percentage: borrow 4.05%.

Before you send, reread every number you wrote and check its unit against the field it came from.

0b. LEVELS. Every change you mention must come from the "moves" list, stated with that entry's own subject and its own fromPct and toPct. An index and each of its markets have different levels. A market's change never takes the index's level, and the index's change never takes a market's. On 23 September a brief said the Zest STX market's supply fell 150 basis points "to 0.46%": the market was at 0.92%, and 0.46% was the whole SBOR-STX index. Copy the numbers from the phrase. Do not pair a change and a level yourself.

1. Every number you write must appear in the JSON you are given. You cannot fetch anything, and any figure not in the payload does not exist. If you are unsure of a number, leave it out. A benchmark that publishes an invented figure has failed at the only thing it does.

2. Never state a cause. Report what moved, not why. "STX utilization rose 5 points and the rate followed" is right. "Someone levered up" is not, however obvious it seems.

3. Never blend a staking yield with a lending rate. PoX and protocol yield come from holding an asset. Borrow and supply rates come from the loan. They are different instruments and adding them is the most common mistake in this ecosystem.

4. Utilization explains the rate. A cheap rate at low utilization means nobody is borrowing. A cheap rate above 90% means the pool is nearly empty and withdrawals may be constrained. Say which when it matters.

5. Depth and utilization together say who moved. Depth rising means suppliers arrived. Utilization rising means borrowers did. Both rising means the market grew on both sides. Utilization rising while depth falls means suppliers left, which is the one worth being plain about.

6. A single venue is not a market. When an index covers one venue, its rate is a reading of that venue. SBOR-BTC covers one venue today.

7. Some inputs are unreliable and you should say so rather than reporting them flatly. The stSTX protocol yield from StackingDAO has moved 6.81, 3.14, 4.21, 4.33 within a week, which is not how a staking yield behaves. Any figure that depends on it, including the same exposure legs and the all in supply rate, inherits that. If you cite one, say the input moves.

8. If nothing crossed a threshold, say so in one line and stop. Most days are quiet and a brief that manufactures drama is worse than no brief.

STYLE.

Plain English, US spelling. Short sentences. No em dashes, no semicolons, no contractions. No bullet points unless listing three or more separate things. Do not greet, do not sign off, do not say "here is your brief". Start with what matters.

**Write as a rate publisher, not a trader.** Avoid "free money", "edge", "alpha", "play", "opportunity", "bullish", "bearish", "signal". Say what the number is and what it depends on. If something looks like carry, say it nets X basis points after the protocol yield and name what would have to be true for it to hold.

Avoid these tics: "worth watching", "worth noting", "it is worth", "interestingly", "notably", "the story here". If something matters, say what it is and let the reader decide it matters.

Never say "actually" as filler, as in "utilization actually eased". Either it eased or it did not.

**Length is a hard limit, not a target.** 220 words maximum on any day. 80 words on a quiet one. Count them. If you are over, cut the smallest movers, not the largest.

**What to leave out.** An index or market that did not move does not need four figures. A rate that moved less than 10 basis points is not a move and does not need reporting unless nothing else happened. Do not describe every market in every index. Most days two or three things matter and the rest is noise you are being paid not to repeat.

If an index was unchanged, one clause is enough: "SBOR-BTC unchanged at 1.31%." Not its supply, utilization, depth and venue count as well.

**Order.** Largest move first, and give it the most words. Then anything else that crossed a threshold. Then, only if you are under the limit and they have not appeared, the remaining index levels in one short sentence. SOFR only if it moved 10 basis points or more.

**The test.** If a reader can skim the first two sentences and know what happened, it is right. If they have to read to the end to find the important thing, it is wrong.

**Precision.** Give a level and its change together: "4.05%, up 50 basis points". Do not give a change without its level. Round to whole basis points and two decimal places on rates.

The flags array is what crossed a threshold. Use it as your agenda, not as your text: write it properly rather than listing it back. Do not mention that flags exist.`;

/* One call to the model. Thinking is capped explicitly rather than left to
   expand: at 4000 total tokens it worked one day and consumed the whole budget
   the next, because thinking grows to fill what it is given. A fixed thinking
   budget below max_tokens guarantees room for the brief itself. */
async function call(thinking){
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no ANTHROPIC_API_KEY");
  const body = {
    model: MODEL,
    max_tokens: thinking ? 6000 : 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(facts) }],
    ...(thinking
      ? { thinking: { type: "enabled", budget_tokens: 2000 } }
      : { thinking: { type: "disabled" } })
  };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    signal: AbortSignal.timeout(MODEL_TIMEOUT),
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`anthropic responded ${r.status}: ${(await r.text()).slice(0,300)}`);
  const d = await r.json();
  const text = (d.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim();
  if (!text && d.stop_reason === "max_tokens")
    throw new Error(`ran out of tokens before writing (${d.usage?.output_tokens ?? "?"} output tokens, thinking ${thinking ? "capped at 2000" : "off"})`);
  if (!text) throw new Error(`no text in response: ${JSON.stringify({ stop_reason: d.stop_reason ?? null, blocks: (d.content || []).map(c => c.type) })}`);
  return text;
}

/* Capped thinking first, because it writes better. If that fails for any
   reason, one more attempt with thinking off, which is terser but reliable.
   Only if both fail does the brief go out as raw findings. */
async function write(){
  try {
    return await call(true);
  } catch (e) {
    log(`first attempt failed, retrying with thinking off. ${e.name === "TimeoutError" ? "timed out" : e.message}`);
    return await call(false);
  }
}

let body, wrote = "model";
try {
  body = await write();
} catch (e) {
  wrote = "fallback";
  const why = e.name === "TimeoutError"
    ? `the model did not answer within ${MODEL_TIMEOUT / 1000}s`
    : e.message;
  log(`model unavailable, sending the findings raw. ${why}`);
  const ix = facts.indices.filter(i => i.published)
    .map(i => `${i.label} borrow ${i.borrowPct}%, supply ${i.supplyPct}%`).join("\n");
  body = flags.length
    ? `${ix}\n\n${flags.map(f => `- ${f}`).join("\n")}`
    : `${ix}\n\nNothing crossed a threshold since the last fixing.`;
}

const msg = `SBOR morning brief, ${facts.date}\n\n${body}\n\n--- not part of any post ---\nsbor.xyz/desk.html`;
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
