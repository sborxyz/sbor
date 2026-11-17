/**
 * Term averages: compounded averages of the daily fixings over 30, 90 and 180
 * days, actual/365, the same construction SOFR uses.
 *
 * An average is null until its full window of fixings exists. It runs on
 * through a methodology change: each daily fixing stands as published under
 * its own version (fixings are never rewritten), and every average lists the
 * versions its window covers, so a reader can see when it blends two.
 *
 * From methodology 1.14.0 (METHODOLOGY-1.14.0.md, effective with the fixing of
 * 23 November 2026), a day with no published rate (withheld, withdrawn after
 * publication, or no fixing) takes the last published rate, for up to three
 * days in a row, as SOFR's averages carry a rate across days with no
 * publication. Every carried day is listed in the average. A longer gap leaves
 * the average null until a full window exists again. Before 1.14.0 any missing
 * day left it null.
 *
 * Kept in its own module so it can be checked against the published history
 * without running a fixing.
 */

export const TERMS = [30, 90, 180];
export const V114 = "2026-11-23";      // METHODOLOGY-1.14.0.md, announced 18 November 2026
export const MAX_CARRY = 3;            // rule 1.14.0: days in a row a rate is carried

/* rows: history rows, any order. pick(row) returns { borrow, supply } for the
   series, or null when the row has no usable reading that day. */
export function termAverage(rows, pick, side, days, today, carry = false){
  if (carry) return carriedAverage(rows, pick, side, days, today)?.value ?? null;
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

/* 1.14.0: walk the window day by day. A day with a reading uses it; a missing
   day takes the last published rate, for up to MAX_CARRY days in a row,
   counting missing days just before the window too. Null when the series had
   not begun by the window's first day, or a gap is longer than MAX_CARRY.
   Returns { value, carried } with the carried dates. */
export function carriedAverage(rows, pick, side, days, today){
  const val = new Map();
  for (const r of rows){
    const v = pick(r);
    if (v && typeof v[side] === "number" && Number.isFinite(v[side]) && r.date <= today) val.set(r.date, v[side]);
  }
  const dates = [...val.keys()].sort();
  const start = new Date(Date.parse(today) - (days - 1) * 864e5).toISOString().slice(0, 10);
  if (!dates.length || dates[0] > start) return null;          // window not yet complete
  const before = dates.filter(d => d < start).pop();
  let prev = before === undefined ? null : val.get(before);
  let run = before === undefined ? 0 : Math.round((Date.parse(start) - Date.parse(before)) / 864e5) - 1;
  let growth = 1;
  const carried = [];
  for (let t = Date.parse(start); t <= Date.parse(today); t += 864e5){
    const d = new Date(t).toISOString().slice(0, 10);
    if (val.has(d)){ prev = val.get(d); run = 0; }
    else {
      run++;
      if (prev === null || run > MAX_CARRY) return null;
      carried.push(d);
    }
    growth *= 1 + prev / 100 / 365;
  }
  return { value: Number((((growth - 1) * 365 / days) * 100).toFixed(2)), carried };
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
   { borrow, supply, methodologyVersions }, and from 1.14.0 also carried: the
   days that took the last published rate (an empty list when none).
   carry is true from 1.14.0; the caller decides, by the method's date. */
export function termAverages(rows, pick, today, carry = false){
  const out = {};
  for (const d of TERMS){
    if (!carry){
      const b = termAverage(rows, pick, "borrow", d, today);
      const s = termAverage(rows, pick, "supply", d, today);
      out[`d${d}`] = (b === null && s === null) ? null
        : { borrow: b, supply: s, methodologyVersions: versionsIn(rows, pick, d, today) };
      continue;
    }
    const b = carriedAverage(rows, pick, "borrow", d, today);
    const s = carriedAverage(rows, pick, "supply", d, today);
    out[`d${d}`] = (!b && !s) ? null
      : { borrow: b?.value ?? null, supply: s?.value ?? null, methodologyVersions: versionsIn(rows, pick, d, today),
          carried: [...new Set([...(b?.carried ?? []), ...(s?.carried ?? [])])].sort() };
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
