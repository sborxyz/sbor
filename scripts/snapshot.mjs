#!/usr/bin/env node
/**
 * Writes today's fixing into index.html as plain text.
 *
 * The site draws its rates with JavaScript, and many crawlers, including those
 * that feed AI answers, read a page without running it. So each fixing also
 * writes a short plain-text summary between two markers in index.html:
 *
 *   <!-- snapshot:start --> ... <!-- snapshot:end -->
 *
 * The page hides it once the live table has loaded, so people do not see the
 * numbers twice. It also writes the day's values into the page's other number
 * slots (the headline rates, SOFR, SBOR-PoX, the developer example), which
 * the script fills for people but a crawler would otherwise read as 0.00 or
 * as an old sample. Run by the fixing workflow after scripts/fetch.mjs. It never
 * fails the fixing: on any problem it logs and leaves the page as it was.
 */
import { readFileSync, writeFileSync } from "node:fs";

const log = (...a) => console.error(...a);
const START = "<!-- snapshot:start -->", END = "<!-- snapshot:end -->";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const pct = n => (typeof n === "number" && Number.isFinite(n)) ? n.toFixed(2) + "%" : null;
const usd = n => n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : "$" + (n / 1e6).toFixed(1) + "M";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function snapshotText(d){
  const t = new Date(d.fixing);
  if (isNaN(t)) throw new Error("unreadable fixing time");
  const when = `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${t.toISOString().slice(11, 16)} UTC`;
  const parts = [`SBOR fixing of ${when}.`];
  for (const label of ["SBOR-USD", "SBOR-BTC", "SBOR-STX"]){
    const ix = d.indices?.[label];
    const b = pct(ix?.borrow), s = pct(ix?.supply);
    parts.push(b && s ? `${label}: borrow ${b}, supply ${s}.` : `${label}: not published in this fixing.`);
  }
  const ref = d.bitcoinCollateralUsdc;
  if (ref && pct(ref.borrow)) parts.push(`USDC against bitcoin on Base, Ethereum and Arc, a reference, not an SBOR index: borrow ${pct(ref.borrow)}, across ${usd(ref.depthUsd)}.`);
  parts.push("Effective annual rates, read from lending contract state.");
  return esc(parts.join(" ")) + ' Plain text: <a href="/latest.txt">latest.txt</a>. Data: <a href="/api/v1/latest.json">latest.json</a>.';
}

/* Replace the text inside <span ... id="ID">...</span>, only if that exact
   span exists once. */
function setSpan(html, id, value){
  const re = new RegExp(`(<span[^>]*\\bid="${id}"[^>]*>)([^<]*)(</span>)`);
  const m = html.match(re);
  if (!m) { log(`snapshot: slot ${id} not found, left as it was`); return html; }
  return html.replace(re, `$1${value}$3`);
}

export function withValues(html, d){
  const two = n => (typeof n === "number" && Number.isFinite(n)) ? n.toFixed(2) : "n/a";
  const usd = d.indices?.["SBOR-USD"];
  for (const [id, v] of [
    ["borrowVal", two(usd?.borrow)], ["supplyVal", two(usd?.supply)],
    ["exB", two(usd?.borrow)], ["exS", two(usd?.supply)],
    ["sofrVal", two(d.context?.sofr?.rate)], ["poxVal", two(d.poxReference?.apy)]
  ]) html = setSpan(html, id, v);
  return html;
}

export function withSnapshot(html, text){
  const i = html.indexOf(START), j = html.indexOf(END);
  if (i < 0 || j < 0 || j < i) throw new Error("snapshot markers not found in index.html");
  return html.slice(0, i + START.length) + text + html.slice(j);
}

if (import.meta.url === `file://${process.argv[1]}`){
  try {
    const d = JSON.parse(readFileSync("api/v1/latest.json", "utf8"));
    const html = readFileSync("index.html", "utf8");
    const next = withValues(withSnapshot(html, snapshotText(d)), d);
    if (next !== html){ writeFileSync("index.html", next); log("snapshot: index.html updated"); }
    else log("snapshot: already current");
  } catch (e) {
    log(`snapshot: skipped, the page is unchanged. ${e.message}`);
  }
}
