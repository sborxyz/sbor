#!/usr/bin/env node
/**
 * Publishes the day's SBOR rates to the SBORFixings contract on Arc.
 *
 * Runs after each fixing. Reads api/v1/latest.json and posts, in one
 * transaction, the borrow and supply rate (basis points) and size of each
 * SBOR index and of the bitcoin-collateral USDC reference, under the fixing's
 * date. An index not published that day is simply not posted, so on-chain it
 * keeps its last date and readers can see it is stale.
 *
 * Needs ARC_PUBLISHER_KEY, the private key of the publisher wallet, whose only
 * power on the contract is posting rates, and ARC_CONTRACT, the contract's
 * address. Without them it does nothing. It runs in its own workflow after the
 * fixing, so a failure here never touches the fixing; it exits with an error
 * so that workflow can raise an alert.
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, fallback, defineChain, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CONTRACT = process.env.ARC_CONTRACT || "0x56B5417de539153994fF6785F8a3b56421C9eb4f";   // SBORFixings on Arc mainnet, deployed 1 October 2026
const RPCS = (process.env.ARC_RPC ? [process.env.ARC_RPC] : [
  "https://rpc.mainnet.arc.io",
  "https://rpc.drpc.mainnet.arc.io",
  "https://rpc.quicknode.mainnet.arc.io",
  "https://rpc.blockdaemon.mainnet.arc.io"
]);
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042);

const arc = defineChain({
  id: CHAIN_ID, name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: RPCS } }
});

const ABI = [
  { type: "function", name: "publish", stateMutability: "nonpayable",
    inputs: [{ name: "date", type: "uint32" }, { name: "keys", type: "bytes32[]" }, { name: "borrowBps", type: "uint16[]" },
             { name: "supplyBps", type: "uint16[]" }, { name: "depthUsd", type: "uint64[]" }], outputs: [] },
  { type: "function", name: "latest", stateMutability: "view", inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "date", type: "uint32" }, { name: "borrowBps", type: "uint16" }, { name: "supplyBps", type: "uint16" },
              { name: "depthUsd", type: "uint64" }, { name: "publishedAt", type: "uint64" }] }
];

const log = (...a) => console.log(...a);
const bps = x => Math.round(Number(x) * 100);
const key = s => stringToHex(s, { size: 32 });

/** What today's fixing puts on-chain. */
export function rowsFrom(latest){
  const rows = [];
  for (const label of ["SBOR-USD", "SBOR-BTC", "SBOR-STX"]){
    const ix = latest.indices?.[label];
    if (!ix || typeof ix.borrow !== "number" || typeof ix.supply !== "number") continue;
    const depth = (ix.markets || []).reduce((t, m) => t + (m.depthUsd || 0), 0);
    rows.push({ label, borrow: bps(ix.borrow), supply: bps(ix.supply), depth: BigInt(Math.round(depth)) });
  }
  const ref = latest.bitcoinCollateralUsdc;
  if (ref && typeof ref.borrow === "number" && typeof ref.supply === "number")
    rows.push({ label: "BTC-COLLATERAL-USDC", borrow: bps(ref.borrow), supply: bps(ref.supply), depth: BigInt(Math.round(ref.depthUsd || 0)) });
  return rows;
}

export const dateOf = latest => Number(String(latest.fixing).slice(0, 10).replace(/-/g, ""));

async function main(){
  const pk = process.env.ARC_PUBLISHER_KEY;
  if (!CONTRACT || !pk){ log("arc: no contract address or publisher key, nothing published"); return; }
  const latest = JSON.parse(readFileSync("api/v1/latest.json", "utf8"));
  const date = dateOf(latest), rows = rowsFrom(latest);
  if (!rows.length){ log("arc: nothing to publish"); return; }

  const transport = fallback(RPCS.map(u => http(u, { timeout: 15000 })));
  const pc = createPublicClient({ chain: arc, transport });
  /* Skip only if this fixing is already on Arc with the same numbers; a
     corrected fixing on the same day is published again. */
  const on = await Promise.all(rows.map(r => pc.readContract({ address: CONTRACT, abi: ABI, functionName: "latest", args: [key(r.label)] })));
  const unchanged = rows.every((r, i) => Number(on[i][0]) === date && Number(on[i][1]) === r.borrow && Number(on[i][2]) === r.supply && on[i][3] === r.depth);
  if (unchanged){ log(`arc: fixing ${date} already on Arc, nothing to do`); return; }

  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
  const wc = createWalletClient({ account, chain: arc, transport });
  const hash = await wc.writeContract({ address: CONTRACT, abi: ABI, functionName: "publish",
    args: [date, rows.map(r => key(r.label)), rows.map(r => r.borrow), rows.map(r => r.supply), rows.map(r => r.depth)] });
  const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 120000 });
  log(`arc: fixing ${date} published, ${rows.map(r => `${r.label} ${r.borrow}/${r.supply} bps`).join(", ")}`);
  log(`arc: transaction ${hash}, status ${receipt.status}, gas ${receipt.gasUsed}`);
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch(e => {
    console.log(`arc: not published. ${e.shortMessage || e.message}`);
    /* Its own workflow, never the fixing's, so it can fail loudly: the
       workflow then sends a Telegram alert. */
    process.exitCode = 1;
  });
