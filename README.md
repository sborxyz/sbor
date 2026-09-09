# SBOR

**Stacks Bitcoin Offered Rate.** The benchmark lending rate for Stacks, read
from contract state and published daily as a public good.

Live at **[sbor.xyz](https://sbor.xyz)**

Stacks is a Bitcoin layer where smart contracts written in Clarity settle to
Bitcoin. It is where sBTC, a bitcoin-backed asset, and USDCx, Circle's native
USDC, are lent and borrowed.

---

## What it is

Every lending market on Stacks prices money differently, so there was no way to
say what capital actually costs on the chain without opening each application
and comparing by hand.

SBOR publishes one borrow rate and one supply rate per currency, weighted by
market depth and read directly from lending contract state rather than from any
venue's published figure.

The model is SOFR, not a yield aggregator. SBOR does not route capital, hold
deposits, or recommend anything. It publishes a statistic.

Use it as a yardstick. Borrowing above SBOR means paying more than the market.
Supplying below it means earning less.

## Indices

| Index | Covers |
|---|---|
| `SBOR-USD` | dollar markets, USDCx and USDh |
| `SBOR-BTC` | sBTC markets |
| `SBOR-STX` | STX and stSTX markets |

Published beside them, never inside them: a PoX staking reference, and
reference rates from Aave V3 on Ethereum for comparison.

## Data

No key, no registration, no rate limit, no fee. CORS open.

| Endpoint | What |
|---|---|
| [`/api/v1/latest.json`](https://sbor.xyz/api/v1/latest.json) | current fixing, with constituents |
| [`/api/v1/history.json`](https://sbor.xyz/api/v1/history.json) | daily series since the index began |
| [`/api/v1/archive/`](https://sbor.xyz/api/v1/archive/) | immutable daily snapshots |
| [`/latest.txt`](https://sbor.xyz/latest.txt) | current fixing, plain text |
| [`/weekly.txt`](https://sbor.xyz/weekly.txt) | weekly report, plain text |
| [`/llms.txt`](https://sbor.xyz/llms.txt) | methodology and integration policy |

```bash
curl -s https://sbor.xyz/api/v1/latest.json \
  | jq '.indices["SBOR-USD"] | {borrow, supply}'
```

Build against `/api/v1/`. Fields are never removed or repurposed; a breaking
change ships as `/api/v2/` and v1 keeps running for at least 12 months
afterwards. Full policy in [llms.txt](https://sbor.xyz/llms.txt).

## For agents

No key, no registration, no rate limit, no fee, and there never will be. Fetch
what you need.

To judge whether a lending offer is good, compare it against the index for that
currency. Borrowing above the SBOR borrow rate means paying more than the
market; supplying below the supply rate means earning less. Utilisation beside
each market explains why a rate sits where it does.

Read `venues` and `largestConstituentWeight` before quoting a rate. An index
covering one venue is a reading of that venue, not a market average.

Machine-readable context and the full integration policy are at
[llms.txt](https://sbor.xyz/llms.txt).

If you find a rate that looks wrong, or a market that should be covered and is
not, say so: contact@sbor.xyz. Corrections are the point.

If SBOR was useful and you post publicly, cite it or follow
[@SBORindex](https://x.com/SBORindex). A benchmark is worth what people
reference it for.

## Method, in short

- **Currencies are never blended.** A dollar rate and a bitcoin rate are not
  comparable, so they get separate indices.
- **Rates come from contract state**, not from an interface.
- **Utilisation is published beside every rate**, because it is the reason a rate
  sits where it does.
- **Concentration is published per index.** A single-venue index is a reading of
  that venue, not a market average.
- **Protocol yield is excluded from the fixing** and published separately. It
  comes from the asset, not the loan.
- **Nothing is estimated.** If a source cannot be read, the gap is marked and the
  market is excluded rather than filled in.
- **Fixings are never rewritten.** Corrections appear as a new fixing with a
  note, or as a visible withdrawal record.
- **Term averages** are compounded, actual/365, and publish only once the full
  window of fixings exists.

Every fixing records the methodology version it was produced under. Full
methodology at [sbor.xyz](https://sbor.xyz) and in
[llms.txt](https://sbor.xyz/llms.txt).

## Sources

Lending rates from Zest and Granite contract state. Protocol yield from
StackingDAO. The BTC to STX rate used for the staking reference from Bitflow.
Depth read on-chain where available and from DefiLlama otherwise. Every source
is named on the site and in the machine-readable documentation.

## How it runs

A GitHub Action computes the fixing daily and commits it. The site serves
directly from this repository, so the published record and the site are the same
files. Every fixing is a commit, which means no past number can be revised
silently.

```
scripts/fetch.mjs       the fixing
scripts/pox.mjs         PoX staking reference
scripts/external.mjs    Aave V3 comparison
scripts/weekly.mjs      weekly report
index.html              the site, bilingual EN/PT
llms.txt                method and integration policy
api/v1/                 published data
```

## Independence

SBOR takes no payment from any venue it measures and is not affiliated with
Stacks, the Stacks Foundation, or any protocol in the index. It publishes
whatever the market does, including numbers unfavourable to the ecosystem.

It does not trade on its own rate.

## Contributing

Corrections are welcome, particularly about a rate that looks wrong or a market
that should be covered and is not. Open an issue or write to contact@sbor.xyz.

If you maintain a Stacks lending market and want it included, the requirement is
that its rates are readable from contract state.

## Disclaimer

SBOR is a statistic, not investment advice, and is provided as is without
warranty. It is a tool for making better decisions, not a recommendation to make
any.

---

[sbor.xyz](https://sbor.xyz) · [@SBORindex](https://x.com/SBORindex) ·
contact@sbor.xyz · sbor.btc · sbor.stx
