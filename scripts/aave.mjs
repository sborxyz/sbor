#!/usr/bin/env node
/**
 * Aave V3, read from the contracts on Ethereum and Base.
 *
 * The comparison chains came from DefiLlama until September 2026, which is why
 * they carried a "small differences expected" caveat and were not on the same
 * basis as the SBOR indices. This reads Aave the way SBOR reads Zest and
 * Granite: straight from contract state.
 *
 * For each reserve it asks the Pool for the current rates, then asks the two
 * tokens Aave uses to track the reserve how much exists: the aToken is what
 * has been supplied, the variable debt token is what has been borrowed.
 * Utilization is borrowed over supplied, the same definition SBOR uses on
 * Stacks.
 *
 * Plain JSON-RPC over fetch, no library, so it adds nothing to the dependency
 * tree of a benchmark. Three public endpoints per chain are tried in turn, so
 * one being down does not fail the read.
 *
 * Run directly, it reads the four Aave markets SBOR publishes and prints them
 * beside the DefiLlama figures SBOR currently uses. It writes nothing.
 */

const RPC = {
  Ethereum: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://1rpc.io/eth"],
  Base:     ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://1rpc.io/base"]
};

/* The Aave V3 Pool on each chain. Everything else is discovered from it. */
const POOL = {
  Ethereum: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  Base:     "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"
};

/* Four-byte function selectors. */
const SEL = {
  getReserveData: "0x35ea6a75",   // getReserveData(address)
  totalSupply:    "0x18160ddd",   // totalSupply()
  decimals:       "0x313ce567"    // decimals()
};

const SECONDS_PER_YEAR = 31536000;
const RAY = 1e27;
const TIMEOUT = 10_000;

async function call(chain, to, data){
  const urls = RPC[chain];
  if (!urls) throw new Error(`no RPC configured for ${chain}`);
  let last;
  for (const url of urls){
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
        signal: AbortSignal.timeout(TIMEOUT)
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

const words = hex => (hex.length - 2) / 64;
const word  = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const big   = w => BigInt("0x" + w);
const addr  = w => "0x" + w.slice(24);
const pad   = a => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/* Aave publishes annual rates in ray, a simple rate compounded every second.
   SBOR publishes effective APY, so the conversion matches how the Aave app
   itself turns its rate into the APY it displays. */
export const aprToApy = apr => Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;
const round = (n, d = 2) => Number(n.toFixed(d));

/**
 * One Aave V3 reserve. Returns rates as percentages, both the simple annual
 * rate Aave stores and the effective APY SBOR publishes, plus utilization and
 * the amount supplied in whole tokens.
 */
export async function readAaveReserve(chain, token){
  const pool = POOL[chain];
  if (!pool) throw new Error(`no Aave pool configured for ${chain}`);

  const r = await call(chain, pool, SEL.getReserveData + pad(token));
  /* ReserveDataLegacy is fifteen words. Fewer means the call hit something
     other than an Aave V3 pool, or the token is not listed there. */
  if (words(r) < 15) throw new Error(`getReserveData on ${chain} returned ${words(r)} words, expected 15`);

  const supplyApr = Number(big(word(r, 2))) / RAY;   // currentLiquidityRate
  const borrowApr = Number(big(word(r, 4))) / RAY;   // currentVariableBorrowRate
  const aToken = addr(word(r, 8));                   // aTokenAddress
  const debtToken = addr(word(r, 10));               // variableDebtTokenAddress
  if (/^0x0{40}$/.test(aToken)) throw new Error(`${token} is not listed on Aave ${chain}`);

  const [aSup, dSup, dec] = await Promise.all([
    call(chain, aToken, SEL.totalSupply),
    call(chain, debtToken, SEL.totalSupply),
    call(chain, aToken, SEL.decimals)
  ]);
  const supplied = big(word(aSup, 0));
  const borrowed = big(word(dSup, 0));
  const decimals = Number(big(word(dec, 0)));

  /* Four decimal places of precision from integer maths, then rounded. */
  const utilization = supplied > 0n ? round(Number(borrowed * 1_000_000n / supplied) / 10_000) : null;

  return {
    chain, token,
    supplyApr: round(supplyApr * 100, 4), borrowApr: round(borrowApr * 100, 4),
    supply: round(aprToApy(supplyApr) * 100), borrow: round(aprToApy(borrowApr) * 100),
    utilization,
    suppliedTokens: Number(supplied) / 10 ** decimals,
    decimals, aToken, debtToken
  };
}

/* ------------------------------------------------------------------------ */
/* Run directly: compare against what SBOR publishes today from DefiLlama.  */
/* ------------------------------------------------------------------------ */
const MARKETS = [
  { chain: "Ethereum", asset: "USDC",  token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { chain: "Ethereum", asset: "WBTC",  token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
  { chain: "Ethereum", asset: "cbBTC", token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" },
  { chain: "Base",     asset: "USDC",  token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }
];

async function compare(){
  const { externalReference } = await import("./external.mjs");
  const ext = await externalReference({ contracts: false });   // DefiLlama alone, to compare against
  const published = m => ext.markets.find(x => x.venue === `Aave V3, ${m.chain}` && x.asset === m.asset);

  const fmt = n => (n == null ? "n/a" : Number(n).toFixed(2).padStart(6));
  let agree = 0, checked = 0;
  console.log("\nAave V3 read from contracts, beside the DefiLlama figures SBOR publishes today.\n");
  for (const m of MARKETS){
    let c;
    try { c = await readAaveReserve(m.chain, m.token); }
    catch (e) { console.log(`${m.chain} ${m.asset}: READ FAILED, ${e.message}\n`); continue; }
    const d = published(m);
    console.log(`${m.chain} ${m.asset}   supplied ${Math.round(c.suppliedTokens).toLocaleString("en-US")} ${m.asset}`);
    console.log(`  borrow   contract APY ${fmt(c.borrow)}  APR ${fmt(c.borrowApr)}   DefiLlama ${fmt(d?.borrow)}`);
    console.log(`  supply   contract APY ${fmt(c.supply)}  APR ${fmt(c.supplyApr)}   DefiLlama ${fmt(d?.supply)}`);
    console.log(`  util     contract     ${fmt(c.utilization)}              DefiLlama ${fmt(d?.utilization)}`);
    if (d){
      checked++;
      const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;
      const rateOk = (near(c.borrow, d.borrow, 0.15) || near(c.borrowApr, d.borrow, 0.15))
                  && (near(c.supply, d.supply, 0.15) || near(c.supplyApr, d.supply, 0.15));
      const utilOk = d.utilization == null || near(c.utilization, d.utilization, 1.0);
      const basis = near(c.borrow, d.borrow, 0.02) ? "DefiLlama matches APY"
                  : near(c.borrowApr, d.borrow, 0.02) ? "DefiLlama matches APR"
                  : "basis unclear";
      console.log(`  ${rateOk && utilOk ? "AGREE" : "DISAGREE"}   ${basis}\n`);
      if (rateOk && utilOk) agree++;
    } else {
      console.log(`  (not in SBOR's published comparison, no DefiLlama figure to check)\n`);
    }
  }
  console.log(`${agree} of ${checked} markets agree with DefiLlama within tolerance.`);
  if (checked === 0 || agree < checked) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  compare().catch(e => { console.error(e); process.exit(1); });
}
