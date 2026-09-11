/**
 * SBOR-PoX: the native Bitcoin staking yield on Stacks.
 *
 * PoX pays stackers in BTC from what miners commit. The rate is therefore
 *   cycle yield = BTC paid over one cycle x BTC/STX rate / STX locked
 * annualised over the number of reward cycles in a year. Dollar prices cancel,
 * so only the BTC to STX rate is needed, quoted from Bitflow.
 *
 * That cross is averaged over a short window. Staking economics change once a
 * fortnight when a cycle settles; the currency moves every minute. Without the
 * average the published yield wanders on FX between fixings, which would make
 * it describe the wrong thing.
 *
 * This is a staking yield, not a lending rate. It is published beside the
 * lending indices, never blended into them.
 *
 * Run standalone to check the figure:  node scripts/pox.mjs
 */
import { readFileSync } from "node:fs";

const HIRO   = "https://api.hiro.so";
const PRICES  = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,blockstack&vs_currencies=usd";
const BITFLOW = "https://bff.bitflowapis.finance/api/quotes/v1";

/* The dollar prices cancel in the yield calculation, so all that is needed is
   the BTC/STX exchange rate. Bitflow is the deepest venue for that pair on
   Stacks, which keeps the input native to the market being measured. */
async function stxPerBtcFromBitflow(){
  const { tokens = [] } = await getJson(`${BITFLOW}/tokens`);
  const find = sym => tokens.find(t => String(t.symbol).toUpperCase() === sym);
  const sbtc = find("SBTC"), stx = find("STX");
  if (!sbtc || !stx) throw new Error(`pair not listed. symbols seen: ${tokens.map(t=>t.symbol).join(",")}`);

  /* quote a small size so the figure is a spot rate, not an execution price */
  const amountIn = String(Math.round(0.01 * 10 ** sbtc.decimals));
  const r = await fetch(`${BITFLOW}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      input_token: sbtc.contract_address,
      output_token: stx.contract_address,
      amount_in: amountIn,
      amm_strategy: "best"
    })
  });
  if (!r.ok) throw new Error(`quote responded ${r.status}`);
  const q = await r.json();
  if (!q.success) throw new Error(q.error || "quote unsuccessful");

  const outStx = Number(q.amount_out) / 10 ** (q.output_token_decimals ?? stx.decimals);
  const rate = outStx / 0.01;
  log(`bitflow: 0.01 sBTC quotes ${outStx.toFixed(2)} STX, impact ${q.price_impact_bps} bps ` +
      `=> ${rate.toFixed(0)} STX per BTC`);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("implausible rate");
  return { rate, source: "Bitflow", priceImpactBps: q.price_impact_bps };
}

const round = (n,d=2) => Number(Number(n).toFixed(d));

/* Days of BTC/STX quotes to average over. The staking economics change once a
   fortnight when a cycle settles, but the cross moves every minute. Averaging
   the cross stops a rate that is meant to describe staking from wandering on
   currency alone. */
const CROSS_WINDOW_DAYS = 7;

/* If Hiro does not expose the current burn height under a name we know, fall
   back to the start of the next reward phase, which is close enough to date a
   completed cycle. */
const endBurnFallback = pox =>
  pox.next_cycle?.reward_phase_start_block_height ?? pox.first_burnchain_block_height;

/* Prior quotes, newest first, from the published record. */
function priorCrossQuotes(){
  for (const f of ["api/v1/history.json", "api/history.json"]){
    try {
      const h = JSON.parse(readFileSync(f, "utf8"));
      return h
        .map(r => r["SBOR-PoX"] || r["SBOR-POX"])
        .filter(e => e && typeof e.stxPerBtc === "number")
        .slice(-(CROSS_WINDOW_DAYS - 1))
        .map(e => e.stxPerBtc);
    } catch(e){
      if (!/ENOENT/.test(e.message)) log(`  cross history unreadable in ${f}: ${e.message}`);
    }
  }
  log("  no prior cross quotes on record, using the spot quote alone");
  return [];
}
const log = (...a) => console.error(...a);

async function getJson(u){
  const r = await fetch(u, { headers:{ accept:"application/json" } });
  if(!r.ok) throw new Error(`${u} responded ${r.status}`);
  return r.json();
}

export async function poxReference(){
  /* 1. cycle geometry and how much STX is locked */
  const pox = await getJson(`${HIRO}/v2/pox`);
  const curBurn = Number(pox.current_burnchain_block_height
                      ?? pox.current_cycle?.burn_block_height
                      ?? endBurnFallback(pox));
  const cycleLen = pox.reward_cycle_length;                 // burn blocks per cycle
  const cur      = pox.current_cycle;
  const cycleId  = cur.id;
  const stackedUstx = Number(cur.stacked_ustx);
  log(`pox: cycle ${cycleId}, length ${cycleLen} blocks, stacked ${(stackedUstx/1e6).toFixed(0)} STX`);

  /* 2. the last completed cycle, so the figure is not a partial period */
  const target   = cycleId - 1;
  const firstBlk = pox.first_burnchain_block_height + (target - pox.first_burnchain_block_height/cycleLen|0)*0; // placeholder, computed below
  const startBlk = pox.first_burnchain_block_height + (target * cycleLen) - (pox.first_burnchain_block_height % cycleLen);
  const endBlk   = startBlk + cycleLen - 1;
  log(`measuring completed cycle ${target}, burn blocks ${startBlk} to ${endBlk}`);

  /* 3. sum the BTC miners paid out across that window */
  let sats = 0, seen = 0, offset = 0, pages = 0;
  const LIMIT = 250;
  while (pages < 40){
    const page = await getJson(`${HIRO}/extended/v1/burnchain/rewards?limit=${LIMIT}&offset=${offset}`);
    const rows = page.results || [];
    if (!rows.length) break;
    let below = false;
    for (const r of rows){
      const h = Number(r.burn_block_height);
      if (h > endBlk) continue;
      if (h < startBlk){ below = true; continue; }
      sats += Number(r.reward_amount);
      seen++;
    }
    offset += LIMIT; pages++;
    if (below) break;                       // walked past the start of the cycle
  }
  log(`rewards found in window: ${seen} payouts, ${sats} sats (${(sats/1e8).toFixed(4)} BTC), ${pages} pages`);
  if (!seen) throw new Error("No reward payouts found in the cycle window. Check the block range.");

  /* 4. the BTC/STX rate. Dollar prices cancel, so only the ratio is needed. */
  let rate, rateSource, priceImpactBps = null;
  try {
    const bf = await stxPerBtcFromBitflow();
    rate = bf.rate; rateSource = bf.source; priceImpactBps = bf.priceImpactBps;
  } catch(e){
    log(`bitflow rate unavailable, falling back to CoinGecko. ${e.message}`);
    const px = await getJson(PRICES);
    const btcUsd = Number(px.bitcoin?.usd), stxUsd = Number(px.blockstack?.usd);
    if (!btcUsd || !stxUsd) throw new Error("No BTC/STX rate from any source.");
    rate = btcUsd / stxUsd; rateSource = "CoinGecko";
    log(`coingecko: BTC $${btcUsd}, STX $${stxUsd} => ${rate.toFixed(0)} STX per BTC`);
  }

  /* Smooth the cross over a short window. The spot quote is kept and published
     so the smoothing is visible rather than hidden. */
  const priorQuotes = priorCrossQuotes();
  const window = [...priorQuotes, rate];
  const smoothed = window.reduce((a,b) => a + b, 0) / window.length;
  log(`cross: spot ${Math.round(rate)}, ${window.length} day mean ${Math.round(smoothed)} STX per BTC`);

  const btcPaid    = sats/1e8;
  const stxLocked  = stackedUstx/1e6;
  const cycleYield = (btcPaid * smoothed) / stxLocked;
  const cyclesPerYear = 52560 / cycleLen;   // ~52560 bitcoin blocks a year
  const apy = ((1 + cycleYield) ** cyclesPerYear - 1) * 100;

  log(`${btcPaid.toFixed(4)} BTC paid on ${stxLocked.toFixed(0)} STX locked at ` +
      `${smoothed.toFixed(0)} STX/BTC smoothed = ${(cycleYield*100).toFixed(4)}% per cycle, ` +
      `${cyclesPerYear.toFixed(2)} cycles a year`);

  /* Bitcoin block times are roughly ten minutes, so the window can be dated
     well enough to say what a cycle covered. Block heights are exact and
     dates are approximate; both are published. */
  const blockDate = h => new Date(Date.now() - (curBurn - h) * 6e5)
                          .toISOString().slice(0, 10);

  return {
    label: "SBOR-PoX",
    headline: "The native Bitcoin yield paid to STX stakers.",
    kind: "staking yield",
    period: "one reward cycle, about two weeks",
    cyclesPerYear: round(cyclesPerYear, 2),
    annualisation: "Bitcoin paid over one reward cycle divided by STX locked, annualised over the cycles in a year.",
    apy: round(apy),
    cycle: target,
    cycleStartBurnBlock: startBlk,
    cycleEndBurnBlock: endBlk,
    cycleStartApprox: blockDate(startBlk),
    cycleEndApprox: blockDate(endBlk),
    cycleLengthBlocks: cycleLen,
    cycleYieldPct: round(cycleYield*100, 4),
    btcPaid: round(btcPaid, 6),
    stxLocked: Math.round(stxLocked),
    stxPerBtc: round(rate, 2),
    stxPerBtcSmoothed: round(smoothed, 2),
    crossWindowDays: window.length,
    rateSource,
    ...(priceImpactBps != null && { rateQuoteImpactBps: priceImpactBps }),
    note: "Bitcoin paid to stackers over one two week reward cycle, divided by the STX locked, annualised. The payout is in bitcoin against a position held in STX, so the figure depends on the BTC to STX rate. That rate is averaged over a short window rather than taken at the moment of the fixing, so the published yield describes staking economics rather than the currency wandering between fixings. The spot quote is published alongside it. It is a staking yield, not a lending rate, and is never blended into the lending indices."
  };
}

if (import.meta.url === `file://${process.argv[1]}`){
  poxReference()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error("FAILED:", e.message); process.exit(1); });
}
