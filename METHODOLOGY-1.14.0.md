# SBOR methodology 1.14.0: notice of change

*Announced November 18, 2026. Takes effect with the fixing of Monday, November 23, 2026, 08:30 UTC.*

## In one paragraph

From November 23, 2026, a term average no longer breaks when one day's rate is missing. If a rate is not published for a day (withheld, withdrawn after publication, or no fixing at all), its 30, 90 and 180 day averages carry the last published rate into that day, for up to three days in a row, as SOFR's averages carry a rate across days with no publication. Every carried day is listed in the average. A gap longer than three days still leaves the average empty until a full window exists again. The daily fixings and the rates themselves do not change.

## What changes

- **Carry, up to three days:** a day with no published rate takes the last published rate, compounded like any other day.
- **Disclosure:** each average lists the days it carried, in `carried`. An empty list means none.
- **Longer gaps:** four or more missing days in a row leave the average empty, as before.

## What does not change

- The daily fixings, how they are read and how they are weighted.
- No published fixing or average is rewritten. Backtested on every fixing since September 1, 2026: no published average would have been different.
- Averages are compounded, actual/365, and published only once their full window exists.
- The series covered: each Stacks index and the headline, `BTC-COLLATERAL-USD`.

## Why

A term average is what a contract settles against. Before 1.14.0, one withheld or withdrawn day emptied every average containing it, for up to 180 days. That is a single point of failure in the number most likely to be written into a contract.

## The rules

- 14.1 A day in an average's window with no published rate for that series takes the last published rate before it. This covers a rate withheld in the fixing, a fixing withdrawn after publication, and a day with no fixing.
- 14.2 A rate is carried for at most three days in a row. Missing days just before the window count toward the three.
- 14.3 With a gap of four or more days in a row inside the window, or a series that began after the window's first day, the average is null.
- 14.4 Each average lists every carried day in `carried`, in date order.
- 14.5 A carried day is compounded exactly as a published day, at 1/365 of the carried rate.

## Questions

contact@sbor.xyz, or an issue at [github.com/sborxyz/sbor](https://github.com/sborxyz/sbor).
