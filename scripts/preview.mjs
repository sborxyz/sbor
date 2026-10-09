#!/usr/bin/env node
/**
 * Methodology 1.13.0, published as a preview beside the live fixing.
 *
 * What it costs to borrow dollars against bitcoin, across every eligible
 * market: any dollar stablecoin, lent against plain 1:1 bitcoin, in a market
 * whose rate is set by that market's own interest rate model. This is the
 * SBOR headline under 1.13.0 (code BTC-COLLATERAL-USD), with a sub-rate for
 * each stablecoin once $25M or more of it is covered.
 *
 * A PREVIEW. Nothing here enters a fixing, changes BTC-COLLATERAL-USDC, an
 * SBOR index or anything posted on-chain. It is published so the change can be
 * read on real contract data before it takes effect, as SBOR announces every
 * change to how a number is built before it applies. EFFECTIVE stays null
 * until the date is announced.
 *
 * Markets are read the same way as scripts/morpho.mjs: the market's own
 * parameters (a wrong id is refused), supplied and borrowed from contract
 * state, the borrow rate from the market's interest rate model. Size is what
 * is supplied, from contract state, never an app's displayed total.
 *
 * Weights here are full weights, as the headline will stand once every market
 * has phased in. At the effective date each new market starts at zero weight
 * and ramps over 30 days, so the live rate glides rather than steps.
 *
 * Run directly, it prints the reading. It writes nothing.
 */
import { call as baseCall } from "./aave.mjs";

export const EFFECTIVE = null;           // set when 1.13.0 is announced, e.g. "2026-10-21"
const FLOOR_USD = 1_000_000;             // rule 4.2
const SUBRATE_FLOOR_USD = 25_000_000;    // rule 9.2
const DEPEG_STABLE = 0.98;               // rule 5.1
const DEPEG_BTC = 0.02;                  // rule 5.2, more than 2% below BTC

/* Chains this module reads that aave.mjs does not. */
const EXTRA_RPC = {
  Arbitrum: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc", "https://1rpc.io/arb"]
};
async function call(chain, to, data){
  if (!EXTRA_RPC[chain]) return baseCall(chain, to, data);
  let last;
  for (const url of EXTRA_RPC[chain]){
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!r.ok) throw new Error(`${url} responded ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(`${url}: ${j.error.message || JSON.stringify(j.error)}`);
      if (typeof j.result !== "string" || j.result === "0x") throw new Error(`${url}: empty result`);
      return j.result;
    } catch (e) { last = e; }
  }
  throw new Error(`every ${chain} endpoint failed, last: ${last?.message}`);
}

/* Morpho Blue core contract per chain. Base and Ethereum share an address;
   Arc and Arbitrum do not. */
const MORPHO_ON = {
  Base:     "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
  Ethereum: "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
  Arc:      "0x34cd04070dd72b14e241112f6d83812df5af7fcd",
  Arbitrum: "0x6c247b1f6182318877311737bac0844baa518f5e"
};

/* Eligible plain 1:1 bitcoin (rule 1.8), by chain. */
const BTC = {
  Ethereum: { cbBTC: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", kBTC: "0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98" },
  Base:     { cbBTC: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" },
  Arc:      { cirBTC: "0x171a4217b86a807a64eb94757db6849fb4bdbaa0" },
  Arbitrum: { WBTC: "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f" }
};
/* Dollar stablecoins (rule 2), by chain. `group` is the sub-rate a token
   counts toward: USDT0 is Tether's own cross-chain USDT. */
const USD = {
  Ethereum: { USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7", RLUSD: "0x8292bb45bf1ee4d140127049757c2e0ff06317ed", PYUSD: "0x6c3ea9036406852006290770bedfcaba0e23a0e8" },
  Base:     { USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  Arc:      { USDC: "0x3600000000000000000000000000000000000000" },
  Arbitrum: { USDC: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", USDT0: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9" }
};
const GROUP = { USDC: "USDC", USDT: "USDT", USDT0: "USDT", RLUSD: "RLUSD", PYUSD: "PYUSD" };

/* Waves 1 and 2 of the 9 October 2026 sweep, plus the four markets already
   in BTC-COLLATERAL-USDC. Markets still to be verified (Lista on BNB Chain,
   Granite, Curve LlamaLend, cbBTC/USDS, UBTC/USDT0) are not read here yet. */
export const MARKETS = [
  { chain: "Base",     collateral: "cbBTC",  loan: "USDC",  id: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836", live: true },
  { chain: "Ethereum", collateral: "cbBTC",  loan: "USDC",  id: "0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64", live: true },
  { chain: "Ethereum", collateral: "WBTC",   loan: "USDC",  id: "0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49", live: true },
  { chain: "Arc",      collateral: "cirBTC", loan: "USDC",  id: "0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d", live: true },
  { chain: "Ethereum", collateral: "kBTC",   loan: "RLUSD", id: "0x15bb2a6af0c909eed19fb1f2ceeead34ecbdcba626de752c6b09389ee14eec32" },
  { chain: "Ethereum", collateral: "kBTC",   loan: "PYUSD", id: "0xe51f9aaad25d0e755429cf77076b3c2d37cb1228ed81f8a5482f2102c220eef5" },
  { chain: "Ethereum", collateral: "WBTC",   loan: "USDT",  id: "0xa921ef34e2fc7a27ccc50ae7e4b154e16c9799d3387076c421423ef52ac4df99" },
  { chain: "Ethereum", collateral: "WBTC",   loan: "RLUSD", id: "0xa128dddc761075df9a9a60689f3a41a989b245aad506352c509c0c3a76a9ec6b" },
  { chain: "Ethereum", collateral: "cbBTC",  loan: "USDT",  id: "0x4fe72543c5c95cd6b5f3cb516cd235ba882e2e705fe3424db6f99dfe5811d0d3" },
  { chain: "Ethereum", collateral: "cbBTC",  loan: "RLUSD", id: "0xffd010618ed3cb39bb2c5de0e3e58d3d2ec9f52187a180f29723c31756a939bc" },
  { chain: "Ethereum", collateral: "WBTC",   loan: "USDT",  id: "0x3c5a244b778095e1e1b2e44b7c2ecc9bf4fda9cd85cc22740e09205a7a4bf510" },
  { chain: "Ethereum", collateral: "cbBTC",  loan: "PYUSD", id: "0xd8a8e6667f58aa9229e8979bd619742b1660ee856c200a93e407dbccb7222323" },
  { chain: "Ethereum", collateral: "WBTC",   loan: "USDC",  id: "0x09dc9e7eb5d8fc54b2bc41d1135fd4e99057a580f680321faeb90c7a21e631c1" },
  { chain: "Ethereum", collateral: "WBTC",   loan: "PYUSD", id: "0xbe50eed784490d6c32f398902b55eb5e1bd5af89e1f554993ad5fea899be090b" },
  { chain: "Arbitrum", collateral: "WBTC",   loan: "USDC",  id: "0xe6392ff19d10454b099d692b58c361ef93e31af34ed1ef78232e07c78fe99169" },
  { chain: "Arbitrum", collateral: "WBTC",   loan: "USDT0", id: "0xed06d9e82d7c35ca80d3983194e15462a96202bd875800af18183321f4611868" }
];

const SEL = {
  idToMarketParams: "0x2c3c9157",
  market:           "0x5c60e39a",
  borrowRateView:   "0x8c00bf6b",
  decimals:         "0x313ce567"
};
const SECONDS_PER_YEAR = 31536000;
const WAD = 1e18;
const log = (...a) => console.error(...a);
const words = hex => (hex.length - 2) / 64;
const word  = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const big   = w => BigInt("0x" + w);
const addr  = w => "0x" + w.slice(24).toLowerCase();
const round = (n, d = 2) => Number(Number(n).toFixed(d));
const apy = perSecond => Math.expm1(perSecond * SECONDS_PER_YEAR);

async function readMarket(m){
  const id = m.id.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error(`bad market id ${m.id}`);
  const morpho = MORPHO_ON[m.chain];
  const p = await call(m.chain, morpho, SEL.idToMarketParams + id);
  if (words(p) < 5) throw new Error(`idToMarketParams returned ${words(p)} words`);
  const loan = addr(word(p, 0)), coll = addr(word(p, 1)), irm = addr(word(p, 3));
  const wantLoan = USD[m.chain]?.[m.loan], wantColl = BTC[m.chain]?.[m.collateral];
  if (!wantLoan || loan !== wantLoan) throw new Error(`lends ${loan}, not ${m.loan}`);
  if (!wantColl || coll !== wantColl) throw new Error(`takes ${coll} as collateral, not ${m.collateral}`);

  const k = await call(m.chain, morpho, SEL.market + id);
  if (words(k) < 6) throw new Error(`market returned ${words(k)} words`);
  const supplied = big(word(k, 0)), borrowed = big(word(k, 2));
  const fee = Number(big(word(k, 5))) / WAD;
  if (supplied === 0n) throw new Error("nothing supplied");

  const r = await call(m.chain, irm, SEL.borrowRateView + p.slice(2, 2 + 5 * 64) + k.slice(2, 2 + 6 * 64));
  const borrowPerSecond = Number(big(word(r, 0))) / WAD;
  const utilization = Number(borrowed * 1_000_000n / supplied) / 1_000_000;
  const supplyPerSecond = borrowPerSecond * utilization * (1 - fee);

  const dec = Number(big(word(await call(m.chain, loan, SEL.decimals), 0)));
  const scale = 10 ** dec;
  return {
    chain: m.chain, venue: "Morpho", collateral: m.collateral, loan: m.loan, group: GROUP[m.loan],
    borrow: round(apy(borrowPerSecond) * 100),
    supply: round(apy(supplyPerSecond) * 100),
    nominalBorrow: round(borrowPerSecond * SECONDS_PER_YEAR * 100),
    utilization: round(utilization * 100),
    supplied: Number(supplied) / scale,
    borrowed: Number(borrowed) / scale,
    marketId: m.id, loanToken: loan, collateralToken: coll,
    inBtcCollateralUsdcToday: !!m.live,
    source: "contract"
  };
}

/* Prices for the depeg guard (rule 5), from DefiLlama's price service. If
   prices cannot be read the guard is reported as not applied; it never
   removes a market on missing data. */
async function prices(markets){
  const keys = new Set(["coingecko:bitcoin"]);
  const slug = { Ethereum: "ethereum", Base: "base", Arbitrum: "arbitrum", Arc: null };
  for (const m of markets){
    if (!slug[m.chain]) continue;
    keys.add(`${slug[m.chain]}:${m.loanToken}`);
    keys.add(`${slug[m.chain]}:${m.collateralToken}`);
  }
  const r = await fetch(`https://coins.llama.fi/prices/current/${[...keys].join(",")}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`coins.llama.fi responded ${r.status}`);
  const j = await r.json();
  const out = {};
  for (const [k, v] of Object.entries(j.coins || {})) out[k.toLowerCase()] = v.price;
  out.btc = out["coingecko:bitcoin"];
  out.key = (chain, token) => slug[chain] ? out[`${slug[chain]}:${token}`.toLowerCase()] : undefined;
  return out;
}

function weigh(ms){
  const tot = ms.reduce((a, m) => a + m.sizeUsd, 0);
  if (!tot) return null;
  return {
    borrow: round(ms.reduce((a, m) => a + m.borrow * m.sizeUsd, 0) / tot),
    supply: round(ms.reduce((a, m) => a + m.supply * m.sizeUsd, 0) / tot),
    nominalBorrow: round(ms.reduce((a, m) => a + m.nominalBorrow * m.sizeUsd, 0) / tot),
    utilization: round(ms.reduce((a, m) => a + m.borrowed, 0) / ms.reduce((a, m) => a + m.supplied, 0) * 100),
    depthUsd: Math.round(tot),
    markets: ms.length
  };
}

export async function methodologyPreview(){
  const read = [], notRead = [];
  for (const m of MARKETS){
    try { read.push(await readMarket(m)); }
    catch (e) { notRead.push(`${m.chain} ${m.collateral}/${m.loan} ${m.id.slice(0, 10)}: ${e.message}`); log(`  preview ${m.chain} ${m.collateral}/${m.loan}: not read. ${e.message}`); }
  }
  if (!read.length) throw new Error(`no market could be read. ${notRead.join("; ")}`);

  let px = null, guard = "applied";
  try { px = await prices(read); } catch (e) { guard = `not applied: ${e.message}`; }

  const counted = [], context = [];
  for (const m of read){
    const loanPx = px?.key(m.chain, m.loanToken), collPx = px?.key(m.chain, m.collateralToken);
    m.sizeUsd = m.supplied;                                         // dollar stablecoins at par for weight
    if (typeof loanPx === "number") m.loanPrice = round(loanPx, 4);
    if (typeof collPx === "number" && px?.btc) m.collateralVsBtc = round(collPx / px.btc, 4);
    if (typeof loanPx === "number" && loanPx < DEPEG_STABLE){ context.push({ ...m, reason: `loan stablecoin at $${loanPx.toFixed(4)}, below $${DEPEG_STABLE}` }); continue; }
    if (typeof m.collateralVsBtc === "number" && m.collateralVsBtc < 1 - DEPEG_BTC){ context.push({ ...m, reason: `collateral at ${(m.collateralVsBtc * 100).toFixed(2)}% of BTC` }); continue; }
    if (m.sizeUsd < FLOOR_USD){ context.push({ ...m, reason: `$${(m.sizeUsd / 1e6).toFixed(2)}M supplied, under the $1M floor` }); continue; }
    counted.push(m);
  }

  const headline = weigh(counted);
  const subRates = {};
  for (const g of [...new Set(counted.map(m => m.group))]){
    const w = weigh(counted.filter(m => m.group === g));
    if (w && w.depthUsd >= SUBRATE_FLOOR_USD) subRates[`BTC-COLLATERAL-${g}`] = w;
  }
  const largest = counted.length ? Math.max(...counted.map(m => m.sizeUsd)) / headline.depthUsd : null;
  for (const m of counted) m.weight = round(m.sizeUsd / headline.depthUsd, 4);

  log(`  preview 1.13.0: ${counted.length} markets, borrow ${headline?.borrow}% supply ${headline?.supply}% across $${(headline?.depthUsd / 1e9).toFixed(2)}B; ${notRead.length} not read`);
  for (const [k, v] of Object.entries(subRates)) log(`    ${k}: borrow ${v.borrow}% across $${(v.depthUsd / 1e6).toFixed(1)}M, ${v.markets} markets`);

  const clean = m => { const { sizeUsd, supplied, borrowed, ...rest } = m; return { ...rest, depthUsd: Math.round(supplied), borrowedUsd: Math.round(borrowed) }; };
  return {
    label: "SBOR, methodology 1.13.0 preview",
    status: "preview, not a fixing",
    effectiveFrom: EFFECTIVE,
    note: "What it costs to borrow dollars against bitcoin under methodology 1.13.0: every market lending a dollar stablecoin against plain 1:1 bitcoin, priced by its own interest rate model, read from contract state and weighted by what is supplied. Shown at full weight, as it will stand once every market has phased in. A preview published before the change takes effect: it enters no fixing and changes no published rate. Markets still being verified are not yet included.",
    code: "BTC-COLLATERAL-USD",
    ...(headline && { headline: { ...headline, largestConstituentWeight: round(largest, 4) } }),
    subRates,
    depegGuard: guard,
    markets: counted.map(clean),
    ...(context.length && { context: context.map(m => ({ ...clean(m), reason: m.reason })) }),
    ...(notRead.length && { notRead })
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  methodologyPreview()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e); process.exit(1); });
}
