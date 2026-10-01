#!/usr/bin/env node
/**
 * Bitcoin-collateral USDC on Morpho, read from the contracts on Base, Ethereum
 * and Arc.
 *
 * What it costs to borrow dollars against bitcoin, in the markets where that
 * is exactly what happens. Morpho Blue markets are isolated: each has one
 * collateral and one loan asset, so a cbBTC/USDC market's rate is the cost of
 * a dollar borrowed against bitcoin and nothing else. Aave cannot give that
 * number, because Aave pools all collateral, so its USDC rate is the same
 * whatever the borrower posted. The collateral here is cbBTC, WBTC and cirBTC,
 * bitcoin wrapped by a custodian, which the published note says plainly.
 *
 * For each market it reads, from Morpho itself: the market's parameters (so a
 * wrong market id is refused rather than published), its totals supplied and
 * borrowed, and the borrow rate from the market's own interest rate model.
 *
 * A reference, not an SBOR index. It never enters a Stacks fixing. Each market
 * is always published on its own; the combined reference only when every
 * market was read, so a failed read never silently re-weights it.
 *
 * Run directly, it prints the reading. It writes nothing.
 */
import { call } from "./aave.mjs";

/* Morpho Blue is deployed at the same address on Base and Ethereum. On Arc it
   lives elsewhere: never copy an Ethereum address to Arc, where some canonical
   Ethereum addresses hold different contracts. Arc's address is from Morpho's
   official registry (morpho-org/sdks, packages/morpho-ts/src/addresses.ts). */
export const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const MORPHO_ON = { Base: MORPHO, Ethereum: MORPHO, Arc: "0x34CD04070dD72b14E241112F6d83812Df5Af7fCD" };

const USDC = {
  Base:     "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  Ethereum: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  Arc:      "0x3600000000000000000000000000000000000000"    // the ERC-20 interface on Arc's native USDC, 6 decimals
};
const COLLATERAL = {
  cbBTC: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",   // same address on Base and Ethereum
  WBTC:  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  cirBTC: { Arc: "0x171a4217b86a807a64eb94757db6849fb4bdbaa0", Ethereum: "0x72dfb2e44f59c5ad2bafe84314e5b99a7cd5075e" }   // Circle's wrapped bitcoin
};
const collateralOn = (name, chain) => typeof COLLATERAL[name] === "string" ? COLLATERAL[name] : COLLATERAL[name]?.[chain];

/* The largest bitcoin-collateral USDC markets, each at 86% liquidation LTV.
   The Base market is the one Coinbase's bitcoin-backed loans use; the Arc
   market is the one Circle's Digital Asset-Backed Borrowing uses. A market
   with eligibleFrom enters the reference at zero weight on that date and ramps
   to full weight linearly over 30 days, as SBOR's methodology requires of any
   newly eligible market, so adding it cannot step the rate. */
export const MARKETS = [
  { chain: "Base",     collateral: "cbBTC", id: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836" },
  { chain: "Ethereum", collateral: "cbBTC", id: "0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64" },
  { chain: "Ethereum", collateral: "WBTC",  id: "0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49" },
  { chain: "Arc",      collateral: "cirBTC", id: "0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d", eligibleFrom: "2026-10-02" }
];
const PHASE_IN_DAYS = 30;
export function phaseIn(m, today = new Date().toISOString().slice(0, 10)){
  if (!m.eligibleFrom) return 1;
  const days = (Date.parse(today) - Date.parse(m.eligibleFrom)) / 864e5;
  return Math.max(0, Math.min(1, days / PHASE_IN_DAYS));
}

const SEL = {
  idToMarketParams: "0x2c3c9157",   // idToMarketParams(bytes32)
  market:           "0x5c60e39a",   // market(bytes32)
  borrowRateView:   "0x8c00bf6b"    // borrowRateView((address,address,address,address,uint256),(uint128 x6))
};

const SECONDS_PER_YEAR = 31536000;
const WAD = 1e18;
const log = (...a) => console.error(...a);

const words = hex => (hex.length - 2) / 64;
const word  = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const big   = w => BigInt("0x" + w);
const addr  = w => "0x" + w.slice(24).toLowerCase();
const round = (n, d = 2) => Number(Number(n).toFixed(d));

/* Morpho rates are per second, compounded continuously, which is how Morpho's
   own app turns them into the APY it displays. */
const apy = perSecond => Math.expm1(perSecond * SECONDS_PER_YEAR);

export async function readMorphoMarket(m){
  const id = m.id.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error(`bad market id ${m.id}`);

  const morpho = MORPHO_ON[m.chain];
  if (!morpho) throw new Error(`no Morpho address for ${m.chain}`);
  const p = await call(m.chain, morpho, SEL.idToMarketParams + id);
  if (words(p) < 5) throw new Error(`idToMarketParams returned ${words(p)} words, expected 5`);
  const loan = addr(word(p, 0)), coll = addr(word(p, 1)), irm = addr(word(p, 3));
  const lltv = Number(big(word(p, 4))) / WAD;
  if (loan !== USDC[m.chain]) throw new Error(`${m.chain} market ${m.id.slice(0, 10)} lends ${loan}, not USDC`);
  if (coll !== collateralOn(m.collateral, m.chain)) throw new Error(`${m.chain} market ${m.id.slice(0, 10)} takes ${coll} as collateral, not ${m.collateral}`);

  const k = await call(m.chain, morpho, SEL.market + id);
  if (words(k) < 6) throw new Error(`market returned ${words(k)} words, expected 6`);
  const supplied = big(word(k, 0)), borrowed = big(word(k, 2));
  const fee = Number(big(word(k, 5))) / WAD;
  if (supplied === 0n) throw new Error(`${m.chain} ${m.collateral} market has nothing supplied`);

  /* Both arguments are static tuples, so they are encoded in place: the five
     words of the market parameters, then the six words of the market. */
  const r = await call(m.chain, irm, SEL.borrowRateView + p.slice(2, 2 + 5 * 64) + k.slice(2, 2 + 6 * 64));
  const borrowPerSecond = Number(big(word(r, 0))) / WAD;

  const utilization = Number(borrowed * 1_000_000n / supplied) / 1_000_000;
  const supplyPerSecond = borrowPerSecond * utilization * (1 - fee);

  return {
    chain: m.chain, venue: "Morpho", collateral: m.collateral, loan: "USDC",
    borrow: round(apy(borrowPerSecond) * 100),
    supply: round(apy(supplyPerSecond) * 100),
    nominalBorrow: round(borrowPerSecond * SECONDS_PER_YEAR * 100),
    utilization: round(utilization * 100),
    depthUsd: Math.round(Number(supplied) / 1e6),        // USDC has 6 decimals on every chain read here
    borrowedUsd: Math.round(Number(borrowed) / 1e6),
    lltv: round(lltv * 100, 1),
    fee: round(fee * 100, 2),
    marketId: m.id,
    source: "contract"
  };
}

export async function bitcoinCollateralUsdc(today = new Date().toISOString().slice(0, 10)){
  const markets = [], notRead = [], notReadPhase = [];
  for (const m of MARKETS){
    const ph = phaseIn(m, today);
    try { markets.push({ ...(await readMorphoMarket(m)), phaseIn: round(ph, 4) }); }
    catch (e) {
      notRead.push(`${m.chain} ${m.collateral}: ${e.message}`);
      notReadPhase.push(ph);
      log(`  morpho ${m.chain} ${m.collateral}: not read. ${e.message}`);
    }
  }
  if (!markets.length) throw new Error(`no bitcoin-collateral market could be read. ${notRead.join("; ")}`);

  /* Rates are weighted by the USDC supplied to each market times its phase-in.
     The total supplied counts every market in full, so the markets shown add
     up to the total shown. The reference is published only when every market
     that carries weight was read: a market still at zero weight cannot
     withhold it. */
  const total = markets.reduce((a, m) => a + m.depthUsd, 0);
  const weightBase = markets.reduce((a, m) => a + m.depthUsd * m.phaseIn, 0);
  const complete = notReadPhase.every(ph => ph === 0) && weightBase > 0;
  const reference = complete ? {
    borrow: round(markets.reduce((a, m) => a + m.borrow * m.depthUsd * m.phaseIn / weightBase, 0)),
    supply: round(markets.reduce((a, m) => a + m.supply * m.depthUsd * m.phaseIn / weightBase, 0)),
    utilization: round(markets.reduce((a, m) => a + m.borrowedUsd, 0) / total * 100),
    depthUsd: total
  } : null;

  for (const m of markets)
    log(`  morpho ${m.chain} ${m.collateral}/USDC: borrow ${m.borrow}% supply ${m.supply}% util ${m.utilization}% depth $${(m.depthUsd / 1e6).toFixed(1)}M phase-in ${m.phaseIn}`);
  if (reference) log(`  bitcoin-collateral USDC reference: borrow ${reference.borrow}%, depth $${(total / 1e6).toFixed(1)}M`);

  return {
    label: "Bitcoin-collateral USDC",
    kind: "reference, not an index",
    note: "What it costs to borrow USDC against bitcoin: Morpho Blue markets on Base, Ethereum and Arc whose only collateral is cbBTC, WBTC or cirBTC, bitcoin wrapped by a custodian. Read from the Morpho contracts, rates as effective APY from each market's own interest rate model, with the simple annual rate kept as nominalBorrow. The reference weights each market by the USDC supplied to it; a newly added market enters at zero weight and ramps to full weight over 30 days (phaseIn), so adding it cannot step the rate. depthUsd counts every market in full. Published only when every market carrying weight was read. It is not an SBOR index and never enters a fixing. Recording began on 25 September 2026; Arc's cirBTC market added from 2 October 2026.",
    ...(reference && { borrow: reference.borrow, supply: reference.supply, utilization: reference.utilization, depthUsd: reference.depthUsd }),
    markets: markets.map(m => ({ ...m, ...(complete && { weight: round(m.depthUsd * m.phaseIn / weightBase, 4) }) })),
    ...(notRead.length && { notRead })
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bitcoinCollateralUsdc()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e); process.exit(1); });
}
