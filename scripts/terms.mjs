/**
 * Term averages: compounded averages of the daily fixings over 30, 90 and 180
 * days, actual/365, the same construction SOFR uses.
 *
 * An average is null until its full window of fixings exists. It runs on
 * through a methodology change: each daily fixing stands as published under
 * its own version (fixings are never rewritten), and every average lists the
 * versions its window covers, so a reader can see when it blends two.
 *
 * Kept in its own module so it can be checked against the published history
 * without running a fixing.
 */

export const TERMS = [30, 90, 180];

/* rows: history rows, any order. pick(row) returns { borrow, supply } for the
   series, or null when the row has no usable reading that day. */
export function termAverage(rows, pick, side, days, today){
  const start = new Date(Date.parse(today) - (days - 1) * 864e5)
                  .toISOString().slice(0, 10);
  const inWindow = rows.filter(r => {
    if (r.date < start || r.date > today) return false;
    const v = pick(r);
    return v && typeof v[side] === "number";
  });
  if (inWindow.length < days) return null;      // window not yet complete
  const growth = inWindow.reduce((a, r) => a * (1 + pick(r)[side] / 100 / 365), 1);
  return Number((((growth - 1) * 365 / days) * 100).toFixed(2));
}

/* Every methodology version that produced a fixing inside the window. */
function versionsIn(rows, pick, days, today){
  const start = new Date(Date.parse(today) - (days - 1) * 864e5)
                  .toISOString().slice(0, 10);
  return [...new Set(rows
    .filter(r => r.date >= start && r.date <= today && pick(r))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => r.methodologyVersion ?? "unknown"))];
}

/* The three windows for one series: { d30, d90, d180 }, each null or
   { borrow, supply, methodologyVersions }. */
export function termAverages(rows, pick, today){
  const out = {};
  for (const d of TERMS){
    const b = termAverage(rows, pick, "borrow", d, today);
    const s = termAverage(rows, pick, "supply", d, today);
    out[`d${d}`] = (b === null && s === null) ? null
      : { borrow: b, supply: s, methodologyVersions: versionsIn(rows, pick, d, today) };
  }
  return out;
}

/* How each series is read from a history row. */
export const pickIndex = label => r =>
  r[label] && !r[label].withdrawn ? r[label] : null;
export const pickHeadline = r =>
  r.btcCollateralUsd && typeof r.btcCollateralUsd.b === "number"
    ? { borrow: r.btcCollateralUsd.b, supply: r.btcCollateralUsd.s }
    : null;
