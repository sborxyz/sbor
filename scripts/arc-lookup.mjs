#!/usr/bin/env node
/**
 * One-off lookup for adding Arc to the bitcoin-collateral reference.
 *
 * 1. Asks Morpho's public API for the USDC markets whose collateral is cirBTC,
 *    on Arc (chain 5042) and Ethereum (chain 1), and prints each market's ID,
 *    size, utilization, borrow rate, LLTV, oracle and rate model.
 * 2. Checks that Arc's public endpoints answer read calls, and that Morpho
 *    Blue on Arc returns the same parameters for each Arc market.
 *
 * Read-only. Publishes nothing. Writes its findings to stdout, which the
 * workflow copies onto the run's summary page.
 */
const CIRBTC = {
  1:    "0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E",   // Circle docs
  5042: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0"    // Arc docs
};
const USDC = {
  1:    "0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48",
  5042: "0x3600000000000000000000000000000000000000"
};
const ARC_MORPHO = "0x34CD04070dD72b14E241112F6d83812Df5Af7fCD";   // Morpho SDK registry
const ARC_RPCS = [
  "https://rpc.mainnet.arc.io",
  "https://rpc.drpc.mainnet.arc.io",
  "https://rpc.quicknode.mainnet.arc.io",
  "https://rpc.blockdaemon.mainnet.arc.io"
];
const API = "https://api.morpho.org/graphql";

const out = [];
const say = (...a) => { const l = a.join(" "); out.push(l); console.log(l); };
const lc = s => String(s || "").toLowerCase();

async function morphoMarkets(){
  const query = `query {
    markets(first: 50, where: {
      chainId_in: [1, 5042],
      collateralAssetAddress_in: ["${CIRBTC[1]}", "${CIRBTC[5042]}"]
    }) {
      items {
        uniqueKey lltv oracleAddress irmAddress
        loanAsset { address symbol }
        collateralAsset { address symbol }
        morphoBlue { address chain { id } }
        state { supplyAssetsUsd borrowAssetsUsd utilization borrowApy supplyApy }
      }
    }
  }`;
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 400));
  return j.data?.markets?.items || [];
}

async function rpc(url, method, params){
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j.result;
}

async function main(){
  say("MORPHO MARKETS WITH cirBTC COLLATERAL (api.morpho.org)");
  let markets = [];
  try { markets = await morphoMarkets(); }
  catch(e){ say("  API lookup failed:", e.message); }
  const usdc = markets.filter(m => lc(m.loanAsset?.address) === lc(USDC[m.morphoBlue?.chain?.id]));
  if (!markets.length) say("  none returned");
  for (const m of markets){
    const chain = m.morphoBlue?.chain?.id, s = m.state || {};
    const isUsdc = usdc.includes(m);
    say(`  chain ${chain} | ${m.collateralAsset?.symbol}/${m.loanAsset?.symbol}${isUsdc ? "" : " (not USDC, ignore)"}`);
    say(`    id         ${m.uniqueKey}`);
    say(`    size       supplied $${((s.supplyAssetsUsd||0)/1e6).toFixed(2)}M, borrowed $${((s.borrowAssetsUsd||0)/1e6).toFixed(2)}M, utilization ${((s.utilization||0)*100).toFixed(2)}%`);
    say(`    rates      borrow ${((s.borrowApy||0)*100).toFixed(2)}%, supply ${((s.supplyApy||0)*100).toFixed(2)}% (Morpho's API, for reference only)`);
    say(`    lltv       ${(Number(m.lltv)/1e16).toFixed(1)}% | oracle ${m.oracleAddress} | irm ${m.irmAddress} | morpho ${m.morphoBlue?.address}`);
  }

  say("");
  say("ARC PUBLIC ENDPOINTS");
  const arcIds = usdc.filter(m => m.morphoBlue?.chain?.id === 5042).map(m => m.uniqueKey);
  for (const url of ARC_RPCS){
    try {
      const id = parseInt(await rpc(url, "eth_chainId", []), 16);
      let line = `  ${url} | chain ${id}${id === 5042 ? " ok" : " WRONG CHAIN"}`;
      for (const mid of arcIds){
        /* idToMarketParams(bytes32): returns loan, collateral, oracle, irm, lltv */
        const data = "0x2c3c9157" + mid.slice(2);
        const res = await rpc(url, "eth_call", [{ to: ARC_MORPHO, data }, "latest"]);
        const loan = "0x" + res.slice(26, 66), coll = "0x" + res.slice(90, 130);
        line += ` | market ${mid.slice(0, 10)}: loan ${lc(loan) === lc(USDC[5042]) ? "USDC ok" : loan}, collateral ${lc(coll) === lc(CIRBTC[5042]) ? "cirBTC ok" : coll}`;
      }
      say(line);
    } catch(e){
      say(`  ${url} | not usable: ${e.message.slice(0, 120)}`);
    }
  }
}

main().catch(e => { say("lookup failed:", e.message); process.exitCode = 0; });
