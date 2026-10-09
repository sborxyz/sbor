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
 * change to how a number is built before it applies. 1.13.0 was announced
 * on 9 October 2026 and takes effect with the fixing of 14 October 2026.
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

export const EFFECTIVE = "2026-10-14";   // announced 9 Oct 2026 in METHODOLOGY-1.13.0.md
const FLOOR_USD = 1_000_000;             // rule 4.2
const SUBRATE_FLOOR_USD = 25_000_000;    // rule 9.2
const DEPEG_STABLE = 0.98;               // rule 5.1
const DEPEG_BTC = 0.02;                  // rule 5.2, more than 2% below BTC

/* Chains this module reads that aave.mjs does not. */
const EXTRA_RPC = {
  Arbitrum: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc", "https://1rpc.io/arb"],
  "BNB Chain": ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://1rpc.io/bnb"]
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
  Arbitrum: "0x6c247b1f6182318877311737bac0844baa518f5e",
  /* Lista Lending's core contract, Moolah, a fork of Morpho Blue with the
     same market layout and the same adaptive interest rate model (checked on
     9 Oct 2026: rateAtTarget answers). Its fixed-term markets use a model
     that returns zero and are not listed here (rule 7.1). */
  "BNB Chain": "0x8f73b65b4caaf64fba2af91cc5d4a2a1318e5d8c"
};
const VENUE = { "BNB Chain": "Lista" };

/* Eligible plain 1:1 bitcoin (rule 1.8), by chain. */
const BTC = {
  Ethereum: { cbBTC: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", kBTC: "0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98" },
  Base:     { cbBTC: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" },
  Arc:      { cirBTC: "0x171a4217b86a807a64eb94757db6849fb4bdbaa0" },
  Arbitrum: { WBTC: "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f" },
  "BNB Chain": { BTCB: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c" }
};
/* Dollar stablecoins (rule 2), by chain. `group` is the sub-rate a token
   counts toward: USDT0 is Tether's own cross-chain USDT. */
const USD = {
  Ethereum: { USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7", RLUSD: "0x8292bb45bf1ee4d140127049757c2e0ff06317ed", PYUSD: "0x6c3ea9036406852006290770bedfcaba0e23a0e8" },
  Base:     { USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  Arc:      { USDC: "0x3600000000000000000000000000000000000000" },
  Arbitrum: { USDC: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", USDT0: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9" },
  "BNB Chain": { USD1: "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d", U: "0xce24439f2d9c6a2289f741120fe202248b666666", USDT: "0x55d398326f99059ff775485246999027b3197955" }
};
const GROUP = { USDC: "USDC", USDCx: "USDC", USDT: "USDT", USDT0: "USDT", RLUSD: "RLUSD", PYUSD: "PYUSD", USD1: "USD1", U: "U" };
/* Rule 2.3: dollars backed by other stablecoins or by positions carry a flag. */
const FLAGS = { U: ["synthetic"] };

/* Waves 1 and 2 of the 9 October 2026 sweep, the four markets already in
   BTC-COLLATERAL-USDC, and Lista's floating BTCB markets (verified 9 Oct).
   Granite comes from the fixing's own read, below. Still to be verified, and
   not read: Curve LlamaLend, cbBTC/USDS, UBTC/USDT0. */
export const MARKETS = [
  { chain: "Base",     collateral: "cbBTC",  loan: "USDC",  id: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836", live: true },
  { chain: "Ethereum", collateral: "cbBTC",  loan: "USDC",  id: "0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64", live: true },
  { chain: "Ethereum", collateral: "WBTC",   loan: "USDC",  id: "0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49", live: true },
  { chain: "Arc",      collateral: "cirBTC", loan: "USDC",  id: "0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d", live: true, eligibleFrom: "2026-10-02" },
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
  { chain: "Arbitrum", collateral: "WBTC",   loan: "USDT0", id: "0xed06d9e82d7c35ca80d3983194e15462a96202bd875800af18183321f4611868" },
  /* Lista's floating-rate BTCB markets, verified 9 Oct 2026. */
  { chain: "BNB Chain", collateral: "BTCB",  loan: "USD1",  id: "0xd9c00925089bfdfa28fd1e9ee734da1461d0b1b9bed9647f6e7ec5acb9d20fc6", flags: ["lenderIncentive"] },
  { chain: "BNB Chain", collateral: "BTCB",  loan: "U",     id: "0xae82d976f5470fa4fc7c32b4f01069351874516946de7352cb783381a0e94d14" },
  { chain: "BNB Chain", collateral: "BTCB",  loan: "USDT",  id: "0x975f4cf3db16812d995f60e19bec91a96108d47429237acc8d208bc0519c5b19" }
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
  const lltv = Number(big(word(p, 4))) / WAD;
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
    chain: m.chain, venue: VENUE[m.chain] || "Morpho", collateral: m.collateral, loan: m.loan, group: GROUP[m.loan],
    ...((FLAGS[m.loan] || m.flags) && { flags: [...(FLAGS[m.loan] || []), ...(m.flags || [])] }),
    borrow: round(apy(borrowPerSecond) * 100),
    supply: round(apy(supplyPerSecond) * 100),
    nominalBorrow: round(borrowPerSecond * SECONDS_PER_YEAR * 100),
    utilization: round(utilization * 100),
    supplied: Number(supplied) / scale,
    borrowed: Number(borrowed) / scale,
    lltv: round(lltv * 100, 1), fee: round(fee * 100, 2),
    marketId: m.id, loanToken: loan, collateralToken: coll,
    inBtcCollateralUsdcToday: !!m.live,
    eligibleFrom: m.live ? (m.eligibleFrom || null) : EFFECTIVE,
    source: "contract"
  };
}

/* Prices for the depeg guard (rule 5), from DefiLlama's price service. If
   prices cannot be read the guard is reported as not applied; it never
   removes a market on missing data. */
async function prices(markets){
  const keys = new Set(["coingecko:bitcoin"]);
  const slug = { Ethereum: "ethereum", Base: "base", Arbitrum: "arbitrum", "BNB Chain": "bsc", Arc: null, Stacks: null };
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
    markets: ms.length,
    venues: new Set(ms.map(m => m.venue)).size
  };
}

/* Granite's USDCx market on Stacks. Its rate, size and utilization come from
   the fixing's own Granite read (scripts/fetch.mjs), passed in here. Granite's
   admitted collateral is a map governance can change (rule 6), so every
   preview reads that map for each token Granite or Stacks lending uses; the
   market counts only while sBTC is the one entry present. If the map cannot
   be read, the market carries no weight. */
const GRANITE_STATE = "SP3M2BYF7RGF8WKW5FVDNJ6WR8D7AR9BHDXAKPXZE/state-v1";
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const STACKS_TOKENS = [SBTC,
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token", "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token",
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2", "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.wstx",
  "SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1", "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx",
  "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc", "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex",
  "SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-abtc"];
const C32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function clarityContractPrincipal(cp){
  const [a, name] = cp.split(".");
  let n = 0n; for (const ch of a.slice(2)) n = n * 32n + BigInt(C32.indexOf(ch));
  const hash = n.toString(16).padStart(48, "0").slice(0, 40);
  const nameHex = Buffer.from(name, "ascii").toString("hex");
  return "0x06" + C32.indexOf(a[1]).toString(16).padStart(2, "0") + hash + name.length.toString(16).padStart(2, "0") + nameHex;
}
async function graniteCollateralCheck(){
  const present = [];
  for (const t of STACKS_TOKENS){
    const r = await fetch(`https://api.hiro.so/v2/map_entry/${GRANITE_STATE}/collaterals?proof=0`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(clarityContractPrincipal(t)), signal: AbortSignal.timeout(10_000)
    });
    if (!r.ok) throw new Error(`Hiro map_entry responded ${r.status}`);
    const j = await r.json();
    if (typeof j.data !== "string") throw new Error("Hiro map_entry returned no data");
    if (j.data.startsWith("0x0a")) present.push(t);
  }
  return present;
}

async function collect(granite){
  const read = [], notRead = [], notReadIds = [];
  for (const m of MARKETS){
    try { read.push(await readMarket(m)); }
    catch (e) { notReadIds.push(m.id); notRead.push(`${m.chain} ${m.collateral}/${m.loan} ${m.id.slice(0, 10)}: ${e.message}`); log(`  preview ${m.chain} ${m.collateral}/${m.loan}: not read. ${e.message}`); }
  }
  if (granite && typeof granite.borrow === "number" && granite.depthUsd > 0){
    const g = {
      chain: "Stacks", venue: "Granite", collateral: "sBTC", loan: "USDCx", group: "USDC",
      borrow: granite.borrow, supply: granite.supply, nominalBorrow: granite.nominalBorrow ?? granite.borrow,
      utilization: granite.utilization, supplied: granite.depthUsd,
      borrowed: granite.depthUsd * (granite.utilization || 0) / 100,
      marketId: GRANITE_STATE.replace("/", "."), inBtcCollateralUsdcToday: false, eligibleFrom: EFFECTIVE, source: "contract"
    };
    try {
      const present = await graniteCollateralCheck();
      g.collateralCheck = present;
      if (present.length === 1 && present[0] === SBTC) read.push(g);
      else notReadIds.push(g.marketId), notRead.push(`Stacks Granite USDCx: collateral list is ${present.join(", ") || "empty"}, not sBTC alone`);
    } catch (e) { notReadIds.push(g.marketId); notRead.push(`Stacks Granite USDCx: collateral list not readable, no weight. ${e.message}`); }
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
  return { counted, context, notRead, notReadIds, guard };
}

const clean = m => { const { sizeUsd, supplied, borrowed, wsize, ...rest } = m; return { ...rest, depthUsd: Math.round(supplied), borrowedUsd: Math.round(borrowed) }; };

export async function methodologyPreview(granite = null){
  const { counted, context, notRead, guard } = await collect(granite);
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

  return {
    label: "SBOR, methodology 1.13.0 preview",
    status: "preview, not a fixing",
    effectiveFrom: EFFECTIVE,
    notice: "https://github.com/sborxyz/sbor/blob/main/METHODOLOGY-1.13.0.md",
    note: "What it costs to borrow dollars against bitcoin under methodology 1.13.0, which takes effect with the fixing of 14 October 2026: every market lending a dollar stablecoin against plain 1:1 bitcoin, priced by its own interest rate model, read from contract state and weighted by what is supplied. Shown at full weight, as it will stand once every market has phased in. A preview published before the change takes effect: it enters no fixing and changes no published rate. Markets still being verified (Curve LlamaLend, cbBTC/USDS, UBTC/USDT0) are not yet included.",
    code: "BTC-COLLATERAL-USD",
    ...(headline && { headline: { ...headline, largestConstituentWeight: round(largest, 4) } }),
    subRates,
    depegGuard: guard,
    markets: counted.map(clean),
    ...(context.length && { context: context.map(m => ({ ...clean(m), reason: m.reason })) }),
    ...(notRead.length && { notRead })
  };
}

/* ------------------------------------------------------------------------
   From the effective date: the live rates under methodology 1.13.0.

   Returns { usd, usdc }:
   - usd, the SBOR headline BTC-COLLATERAL-USD, with a sub-rate per stablecoin
     once $25M or more of it is weighted in (rule 9.2);
   - usdc, BTC-COLLATERAL-USDC, in the shape it has always had, now over every
     eligible USDC market (rule 9.3), so every reader of it keeps working.

   Weights are size times phase-in. A market added under 1.13.0 enters at zero
   weight on the effective date and reaches full weight 30 days later; the four
   markets already in BTC-COLLATERAL-USDC keep the phase-in they had.

   Continuity (rule 9.5): a rate is withheld when the markets that could not be
   read carried a quarter or more of its weight in the previous fixing.
   ------------------------------------------------------------------------ */
const PHASE_IN_DAYS = 30;
function phaseIn(eligibleFrom, today){
  if (!eligibleFrom) return 1;
  const days = (Date.parse(today) - Date.parse(eligibleFrom)) / 864e5;
  return Math.max(0, Math.min(1, days / PHASE_IN_DAYS));
}
function weighPhased(ms){
  const w = ms.reduce((a, m) => a + m.wsize, 0);
  if (!w) return null;
  return {
    borrow: round(ms.reduce((a, m) => a + m.borrow * m.wsize, 0) / w),
    supply: round(ms.reduce((a, m) => a + m.supply * m.wsize, 0) / w),
    nominalBorrow: round(ms.reduce((a, m) => a + m.nominalBorrow * m.wsize, 0) / w),
    utilization: round(ms.reduce((a, m) => a + m.borrowed, 0) / ms.reduce((a, m) => a + m.supplied, 0) * 100),
    depthUsd: Math.round(ms.reduce((a, m) => a + m.sizeUsd, 0)),
    weightedDepthUsd: Math.round(w),
    markets: ms.filter(m => m.wsize > 0).length,
    venues: new Set(ms.filter(m => m.wsize > 0).map(m => m.venue)).size,
    chains: new Set(ms.filter(m => m.wsize > 0).map(m => m.chain)).size,
    largestConstituentWeight: round(Math.max(...ms.map(m => m.wsize)) / w, 4)
  };
}
/* Continuity (rule 9.5). Each fixing records every market's weight, in
   weighted dollars, from the last fixing in which it was read, so a market that fails two days running
   still counts against the rate. missingShare is the share of that recorded
   weight, within a group or overall, carried by markets not read today. */
function continuityFrom(prev){
  if (prev?.bitcoinCollateralUsd?.continuity) return prev.bitcoinCollateralUsd.continuity;
  /* The first fixing under 1.13.0: yesterday's BTC-COLLATERAL-USDC. */
  return (prev?.bitcoinCollateralUsdc?.markets || []).map(m => ({ id: String(m.marketId || "").toLowerCase(), group: "USDC", weight: m.weight || 0 }));
}
function missingShare(cont, notReadIds, group = null){
  const ids = new Set(notReadIds.map(x => x.toLowerCase()));
  const rows = cont.filter(c => !group || c.group === group);
  const total = rows.reduce((a, c) => a + c.weight, 0);
  if (!total) return 0;
  return rows.reduce((a, c) => a + (ids.has(c.id) ? c.weight : 0), 0) / total;
}
const withheldNote = share => `markets not read today carried ${(share * 100).toFixed(1)}% of the rate's weight when last read`;

export async function bitcoinCollateral(granite = null, prev = null, today = new Date().toISOString().slice(0, 10)){
  const { counted, context, notRead, notReadIds, guard } = await collect(granite);
  for (const m of counted){
    m.phaseIn = round(phaseIn(m.eligibleFrom, today), 4);
    m.wsize = m.sizeUsd * m.phaseIn;
  }
  const head = weighPhased(counted);
  const cont = continuityFrom(prev);
  const headMissing = missingShare(cont, notReadIds);
  const headOk = head && headMissing < 0.25;
  const wsum = counted.reduce((a, m) => a + m.wsize, 0);
  for (const m of counted) m.weight = wsum ? round(m.wsize / wsum, 4) : 0;

  /* Today's weights for every market read, the last recorded weight for every
     market not read. */
  const readIds = new Set(counted.map(m => String(m.marketId).toLowerCase()));
  const continuity = [
    ...counted.map(m => ({ id: String(m.marketId).toLowerCase(), group: m.group, weight: Math.round(m.wsize) })),
    /* Carried for up to 30 fixings, then dropped, as a market below the floor
       is removed after 30 (rule 4.2). */
    ...cont.filter(c => !readIds.has(c.id) && notReadIds.some(x => x.toLowerCase() === c.id) && (c.missed || 0) < 30)
           .map(c => ({ ...c, missed: (c.missed || 0) + 1 }))
  ];

  const subRates = {};
  for (const g of [...new Set(counted.map(m => m.group))]){
    const w = weighPhased(counted.filter(m => m.group === g));
    if (!w || w.weightedDepthUsd < SUBRATE_FLOOR_USD) continue;
    const miss = missingShare(cont, notReadIds, g);
    subRates[`BTC-COLLATERAL-${g}`] = miss < 0.25 ? w : { withheld: withheldNote(miss) };
  }

  /* BTC-COLLATERAL-USDC, as before, now over every eligible USDC market. */
  const usdcMs = counted.filter(m => m.group === "USDC");
  const usdcW = weighPhased(usdcMs);
  const usdcMissing = missingShare(cont, notReadIds, "USDC");
  const usdcOk = usdcW && usdcMissing < 0.25;
  const usdcSum = usdcMs.reduce((a, m) => a + m.wsize, 0);
  const usdc = {
    label: "Bitcoin-collateral USDC",
    kind: "the USDC rate under the SBOR headline (BTC-COLLATERAL-USD), methodology 1.13.0",
    note: "What it costs to borrow USDC against plain bitcoin: every eligible market lending USDC (or USDCx on Stacks) against cbBTC, WBTC, cirBTC or sBTC, priced by its own interest rate model, read from contract state, weighted by what is supplied times its phase-in. Markets added under methodology 1.13.0 entered at zero weight on 14 October 2026 and reach full weight over 30 days. depthUsd counts every market in full. Withheld when markets that could not be read carried a quarter or more of its weight when last read. Recording began on 25 September 2026.",
    ...(usdcOk && { borrow: usdcW.borrow, supply: usdcW.supply, utilization: usdcW.utilization, depthUsd: usdcW.depthUsd }),
    markets: usdcMs.map(m => ({ ...clean(m), weight: usdcSum ? round(m.wsize / usdcSum, 4) : 0 })),
    ...(!usdcOk && usdcW && { withheld: withheldNote(usdcMissing) }),
    ...(notRead.length && { notRead })
  };

  const usd = {
    label: "SBOR",
    code: "BTC-COLLATERAL-USD",
    kind: "the SBOR headline, methodology 1.13.0",
    effectiveFrom: EFFECTIVE,
    notice: "https://github.com/sborxyz/sbor/blob/main/METHODOLOGY-1.13.0.md",
    note: "What it costs to borrow dollars against bitcoin: every eligible market lending a dollar stablecoin against plain 1:1 bitcoin, priced by its own interest rate model, read from contract state, weighted by what is supplied times its phase-in. Markets added under methodology 1.13.0 entered at zero weight on 14 October 2026 and reach full weight over 30 days, so the rate glides rather than steps. depthUsd counts every market in full; weightedDepthUsd is what carries weight today. A rate per stablecoin is published once $25M or more of it is weighted in. Withheld when markets that could not be read carried a quarter or more of its weight when last read. continuity records that weight per market.",
    ...(headOk && { borrow: head.borrow, supply: head.supply, nominalBorrow: head.nominalBorrow, utilization: head.utilization,
      depthUsd: head.depthUsd, weightedDepthUsd: head.weightedDepthUsd, constituents: head.markets, venues: head.venues,
      chains: head.chains, largestConstituentWeight: head.largestConstituentWeight }),
    ...(!headOk && head && { withheld: withheldNote(headMissing) }),
    subRates,
    depegGuard: guard,
    markets: counted.map(clean),
    ...(context.length && { context: context.map(m => ({ ...clean(m), reason: m.reason })) }),
    ...(notRead.length && { notRead }),
    continuity
  };
  log(`  SBOR 1.13.0: ${usd.borrow ?? "withheld"}% borrow across $${(head?.depthUsd / 1e9).toFixed(2)}B (weighted $${(head?.weightedDepthUsd / 1e9).toFixed(2)}B), ${counted.length} markets; USDC ${usdc.borrow ?? "withheld"}%`);
  for (const [k, v] of Object.entries(subRates)) log(`    ${k}: ${v.borrow ?? "withheld"}% weighted $${(v.weightedDepthUsd / 1e6).toFixed(1)}M`);
  return { usd, usdc };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  methodologyPreview()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e); process.exit(1); });
}
