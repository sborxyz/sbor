#!/usr/bin/env node
/**
 * Publishes the day's SBOR rates to the sbor-fixings contract on Stacks.
 *
 * Runs after each fixing, beside the Arc publication. Reads api/v1/latest.json
 * and posts, in one transaction, the borrow and supply rate (basis points) and
 * size of each SBOR index and of the bitcoin-collateral USDC reference, under
 * the fixing's date. Same rows as on Arc.
 *
 * The publisher key is the same one used on Arc (ARC_PUBLISHER_KEY): Stacks
 * and Arc use the same kind of key, and on Stacks it controls an address
 * starting with SP. Its only power on the contract is posting rates.
 *
 *   node scripts/stacks-publish.mjs           publish today's fixing
 *   node scripts/stacks-publish.mjs address   print the publisher's Stacks address
 *
 * Runs in its own workflow, so a failure never touches the fixing; it exits
 * with an error so the workflow can raise an alert.
 */
import { readFileSync } from "node:fs";
import {
  makeContractCall, broadcastTransaction, fetchCallReadOnlyFunction,
  getAddressFromPrivateKey, Cl, cvToJSON, PostConditionMode
} from "@stacks/transactions";

export const CONTRACT = process.env.STACKS_CONTRACT || "SP2SRS600PZ70VHY09CK06FSYKW546NY2ARG6N8CD.sbor-fixings";   // deployed 2 October 2026 by the sbor.btc wallet
const NETWORK = "mainnet";
const FEE = BigInt(process.env.STACKS_FEE || 10000);          // micro-STX, 0.01 STX, a generous ceiling

const log = (...a) => console.log(...a);
const bps = x => Math.round(Number(x) * 100);

/** The Arc key as a Stacks key: drop 0x, mark it compressed, as Stacks wallets do. */
export function stacksKey(pk){
  const hex = String(pk || "").trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("publisher key is not 32 bytes of hex");
  return hex + "01";
}

/** What today's fixing puts on-chain: the same rows as on Arc. */
export function rowsFrom(latest){
  const rows = [];
  for (const label of ["SBOR-USD", "SBOR-BTC", "SBOR-STX"]){
    const ix = latest.indices?.[label];
    if (!ix || typeof ix.borrow !== "number" || typeof ix.supply !== "number") continue;
    const depth = (ix.markets || []).reduce((t, m) => t + (m.depthUsd || 0), 0);
    rows.push({ key: label, borrow: bps(ix.borrow), supply: bps(ix.supply), depth: Math.round(depth) });
  }
  /* From methodology 1.13.0 (14 October 2026), the SBOR headline. The
     rates per stablecoin other than USDC are published in the API. */
  const head = latest.bitcoinCollateralUsd;
  if (head && typeof head.borrow === "number" && typeof head.supply === "number")
    rows.push({ key: "BTC-COLLATERAL-USD", borrow: bps(head.borrow), supply: bps(head.supply), depth: Math.round(head.depthUsd || 0) });
  const ref = latest.bitcoinCollateralUsdc;
  if (ref && typeof ref.borrow === "number" && typeof ref.supply === "number")
    rows.push({ key: "BTC-COLLATERAL-USDC", borrow: bps(ref.borrow), supply: bps(ref.supply), depth: Math.round(ref.depthUsd || 0) });
  return rows;
}
export const dateOf = latest => Number(String(latest.fixing).slice(0, 10).replace(/-/g, ""));
const rowCV = r => Cl.tuple({ key: Cl.stringAscii(r.key), "borrow-bps": Cl.uint(r.borrow), "supply-bps": Cl.uint(r.supply), "depth-usd": Cl.uint(r.depth) });

async function onChain(address, name, key, sender){
  const cv = await fetchCallReadOnlyFunction({ contractAddress: address, contractName: name, functionName: "get-latest",
    functionArgs: [Cl.stringAscii(key)], senderAddress: sender, network: NETWORK });
  const v = cvToJSON(cv)?.value?.value;   // (some (tuple ...))
  return v ? { date: Number(v.date.value), borrow: Number(v["borrow-bps"].value), supply: Number(v["supply-bps"].value), depth: Number(v["depth-usd"].value) } : null;
}

async function main(){
  const key = stacksKey(process.env.ARC_PUBLISHER_KEY);
  const sender = getAddressFromPrivateKey(key, NETWORK);
  if (process.argv[2] === "address"){ log(`stacks: the publisher's address is ${sender}`); return; }
  if (!CONTRACT){ log("stacks: no contract address set, nothing published"); return; }
  const [address, name] = CONTRACT.split(".");

  const latest = JSON.parse(readFileSync("api/v1/latest.json", "utf8"));
  const date = dateOf(latest), rows = rowsFrom(latest);
  if (!rows.length){ log("stacks: nothing to publish"); return; }

  /* Skip only if this fixing is already on Stacks with the same numbers; a
     corrected fixing on the same day is published again. */
  const on = await Promise.all(rows.map(r => onChain(address, name, r.key, sender)));
  if (rows.every((r, i) => on[i] && on[i].date === date && on[i].borrow === r.borrow && on[i].supply === r.supply && on[i].depth === r.depth)){
    log(`stacks: fixing ${date} already on Stacks, nothing to do`); return;
  }

  const tx = await makeContractCall({
    contractAddress: address, contractName: name, functionName: "publish",
    functionArgs: [Cl.uint(date), Cl.list(rows.map(rowCV))],
    senderKey: key, network: NETWORK, fee: FEE,
    postConditionMode: PostConditionMode.Deny   // it moves no tokens; refuse any transfer
  });
  const res = await broadcastTransaction({ transaction: tx, network: NETWORK });
  if (res.error) throw new Error(`${res.error}${res.reason ? `: ${res.reason}` : ""}`);
  log(`stacks: fixing ${date} sent, ${rows.map(r => `${r.key} ${r.borrow}/${r.supply} bps`).join(", ")}`);
  log(`stacks: transaction ${res.txid}, it confirms in the next Stacks blocks`);
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch(e => { console.log(`stacks: not published. ${e.message}`); process.exitCode = 1; });
