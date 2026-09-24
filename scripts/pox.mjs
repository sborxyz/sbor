/**
 * SBOR-PoX: the native Bitcoin staking yield on Stacks.
 *
 * PoX pays stackers in BTC from what miners commit. The rate is therefore
 *   cycle yield = BTC paid over one cycle x BTC/STX rate / STX locked
 * annualized over the number of reward cycles in a year. Dollar prices cancel,
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

  async function quote(inTok, outTok, amountHuman){
    const amountIn = String(Math.round(amountHuman * 10 ** inTok.decimals));
    const r = await fetch(`${BITFLOW}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        input_token: inTok.contract_address,
        output_token: outTok.contract_address,
        amount_in: amountIn,
        amm_strategy: "best"
      })
    });
    if (!r.ok) throw new Error(`quote responded ${r.status}`);
    const q = await r.json();
    if (!q.success) throw new Error(q.error || "quote unsuccessful");
    const out = Number(q.amount_out) / 10 ** (q.output_token_decimals ?? outTok.decimals);
    return { out, impactBps: q.price_impact_bps ?? null };
  }

  /* Quote both directions and take the midpoint.
     Price impact always costs the taker, so a one sided quote is an execution
     price and is systematically below true mid rather than noisy around it.
     Impact works against you in both directions, so averaging cancels it and
     leaves a reference price, which is what a benchmark should use.
     Small size, so the figure is a spot rate rather than an execution. */
  const SIZE_SBTC = 0.01;
  const sell = await quote(sbtc, stx, SIZE_SBTC);              // sBTC -> STX
  const rateSell = sell.out / SIZE_SBTC;                       // STX per BTC, low side

  const sizeStx = Math.round(rateSell * SIZE_SBTC);            // same notional back
  const buy = await quote(stx, sbtc, sizeStx);                 // STX -> sBTC
  const rateBuy = sizeStx / buy.out;                           // STX per BTC, high side

  if (!Number.isFinite(rateSell) || !Number.isFinite(rateBuy) || rateSell <= 0 || rateBuy <= 0)
    throw new Error(`implausible quotes: sell ${rateSell}, buy ${rateBuy}`);

  const rate = (rateSell + rateBuy) / 2;
  const spreadBps = Math.round((rateBuy - rateSell) / rate * 10000);

  log(`bitflow: sell ${rateSell.toFixed(0)} (impact ${sell.impactBps ?? "n/a"} bps), ` +
      `buy ${rateBuy.toFixed(0)} (impact ${buy.impactBps ?? "n/a"} bps), ` +
      `mid ${rate.toFixed(0)} STX per BTC, spread ${spreadBps} bps`);

  return {
    rate, source: "Bitflow",
    rateSell: Number(rateSell.toFixed(2)),
    rateBuy: Number(rateBuy.toFixed(2)),
    spreadBps,
    priceImpactBps: sell.impactBps,
    priceImpactBpsReverse: buy.impactBps
  };
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

  /* 2. the last completed cycle, so the figure is not a partial period.
     Its boundaries come from the API's own report of where the next cycle's
     reward phase starts, stepped back two cycle lengths, so they follow the
     chain's convention rather than arithmetic of ours. The protocol formula,
     first burn block plus cycle times length, is kept as a cross-check.
     Until 24 September 2026 the window came from a formula that started 350
     blocks early, so one paying block in eight belonged to the previous
     cycle. */
  const target     = cycleId - 1;
  const protoStart = pox.first_burnchain_block_height + target * cycleLen;
  const nextStart  = Number(pox.next_cycle?.reward_phase_start_block_height);
  const startBlk   = Number.isFinite(nextStart) ? nextStart - 2 * cycleLen : protoStart;
  const endBlk     = startBlk + cycleLen - 1;
  if (Math.abs(startBlk - protoStart) > 1)
    log(`  WARNING: the API puts cycle ${target} at ${startBlk}, the protocol formula at ${protoStart}`);
  log(`measuring completed cycle ${target}, burn blocks ${startBlk} to ${endBlk} (protocol formula start ${protoStart})`);

  /* The STX that earned those rewards: the completed cycle's own stacked
     amount, not the current cycle's. Until 24 September 2026 the current
     cycle's was used, dividing one cycle's payout by the next cycle's stake.
     If it cannot be read, the reference is left out rather than estimated. */
  const tc = await getJson(`${HIRO}/extended/v2/pox/cycles/${target}`);
  const targetStackedUstx = Number(tc.total_stacked_amount);
  if (!Number.isFinite(targetStackedUstx) || targetStackedUstx <= 0)
    throw new Error(`No stacked amount for cycle ${target}: ${JSON.stringify(tc).slice(0, 200)}`);
  log(`cycle ${target} stacked ${(targetStackedUstx/1e6).toFixed(0)} STX (current cycle ${cycleId}: ${(stackedUstx/1e6).toFixed(0)})`);

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
  let rate, rateSource, priceImpactBps = null, twoWay = null;
  try {
    const bf = await stxPerBtcFromBitflow();
    rate = bf.rate; rateSource = bf.source; priceImpactBps = bf.priceImpactBps; twoWay = bf;
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
  const stxLocked  = targetStackedUstx/1e6;
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
    /* The key keeps its original spelling: it is a published field, and the API
       promises fields are never renamed. The text itself is US English. */
    annualisation: "Bitcoin paid over one reward cycle divided by STX locked, annualized over the cycles in a year.",
    apy: round(apy),
    cycle: target,
    /* Version of how the cycle is measured. 2 from 24 September 2026: the
       API's exact cycle window and the cycle's own stacked STX. Figures with
       different versions are never compared as if the market had moved. */
    measurement: 2,
    cycleStartBurnBlock: startBlk,
    cycleEndBurnBlock: endBlk,
    cycleStartApprox: blockDate(startBlk),
    cycleEndApprox: blockDate(endBlk),
    cycleLengthBlocks: cycleLen,
    cycleYieldPct: round(cycleYield*100, 4),
    btcPaid: round(btcPaid, 6),
    stxLocked: Math.round(stxLocked),
    stxPerBtc: round(rate, 2),
    ...(twoWay && {
      stxPerBtcSell: twoWay.rateSell,
      stxPerBtcBuy: twoWay.rateBuy,
      crossSpreadBps: twoWay.spreadBps,
      crossNote: "Quoted in both directions and midpointed. Price impact always costs the taker, so a one sided quote would be an execution price and systematically below true mid rather than noisy around it."
    }),
    stxPerBtcSmoothed: round(smoothed, 2),
    crossWindowDays: window.length,
    rateSource,
    ...(priceImpactBps != null && { rateQuoteImpactBps: priceImpactBps }),
    note: "Bitcoin paid to stackers over one two week reward cycle, divided by the STX locked, annualized. The payout is in bitcoin against a position held in STX, so the figure depends on the BTC to STX rate. That rate is averaged over a short window rather than taken at the moment of the fixing, so the published yield describes staking economics rather than the currency wandering between fixings. The spot quote is published alongside it. It is a staking yield, not a lending rate, and is never blended into the lending indices. From 24 September 2026 (measurement 2) the cycle window is the chain's own and the STX locked is that cycle's; before that the window started 350 blocks early and the STX locked was the following cycle's, so earlier figures are close but not exact."
  };
}

if (import.meta.url === `file://${process.argv[1]}`){
  poxReference()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error("FAILED:", e.message); process.exit(1); });
}
