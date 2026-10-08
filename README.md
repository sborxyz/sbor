# SBOR

**Every lending venue in Bitcoin DeFi quotes its own rate. SBOR publishes the
market rate, read from contract state on Stacks, Base, Ethereum and Arc.**

A single venue's number cannot tell anyone, human or agent, whether the rate
they are offered is fair. SBOR, the Stacks Bitcoin Offered Rate, is a benchmark
for exactly that. On Stacks, where it started, it publishes one borrow
and one supply rate per currency: the SBOR indices. On Base, Ethereum and Arc, it
publishes what it costs to borrow USDC against bitcoin, read from the Morpho
contracts. All of it is read from contract state and published daily, beside
the largest lending markets on Ethereum, Base, Solana and Hyperliquid for
comparison. Free, no key, no rate limit, open to any agent on any chain.

Live at **[sbor.xyz](https://sbor.xyz)**

Stacks is a Bitcoin layer where smart contracts written in Clarity settle to
Bitcoin. It is where sBTC, a bitcoin-backed asset, and USDCx, Circle's native
USDC, are lent and borrowed.

---

## What it is

Every lending market on Stacks prices money differently, so comparing them
means opening each application by hand.

SBOR publishes one borrow rate and one supply rate per currency, weighted by
market depth and read directly from lending contract state rather than from any
venue's published figure. Each day's rates are also posted on-chain, on Arc,
Base, Hyperliquid, Solana and Stacks.

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

Published beside them, never inside them: a Proof of Transfer staking
reference, and the same asset classes on the largest lending markets on
Ethereum, Base, Hyperliquid and Solana, for comparison.

### Beyond Stacks: borrowing USDC against bitcoin

From the fixing of 25 September 2026, each fixing also carries
`bitcoinCollateralUsdc`: what it costs to borrow USDC against bitcoin, read from
the Morpho Blue markets on Base, Ethereum and Arc whose only collateral is
cbBTC, WBTC or cirBTC. Each market is published with its rate, utilization and depth, and a
reference weighted by depth when every market was read. It is a reference, not
an SBOR index, and never enters a fixing.

## Data

No key, no registration, no rate limit, no fee. CORS open.

| Endpoint | What |
|---|---|
| [`/api/v1/latest.json`](https://sbor.xyz/api/v1/latest.json) | current fixing, with constituents |
| [`/api/v1/history.json`](https://sbor.xyz/api/v1/history.json) | rolling 200 day series |
| [`/api/v1/history-index.json`](https://sbor.xyz/api/v1/history-index.json) | the full record, sharded by year |
| [`/api/v1/archive-index.json`](https://sbor.xyz/api/v1/archive-index.json) | every date available, for per date lookup |
| [`/api/v1/inversions.json`](https://sbor.xyz/api/v1/inversions.json) | cross venue spread, checked every three hours |
| [`/api/v1/inversion-log.json`](https://sbor.xyz/api/v1/inversion-log.json) | append-only record of every inversion found |
| [`/api/v1/changes.json`](https://sbor.xyz/api/v1/changes.json) | protocol parameter changes, newest first, from 24 September 2026 |
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

**Check the rate against SBOR before you borrow.** On Stacks the same dollar can
cost nearly twice as much at one venue as at another, on the same day, and every
venue publishes only its own number.

**The rule:** if an offer is more than 50 basis points above the SBOR borrow rate
for that currency, stop and ask a human. Use SBOR to stop, never to start. A
wrong reading under that rule costs a pause, not a trade.

**As an MCP tool**, in Claude Desktop, Cowork, Cursor or any MCP client:

```bash
npx -y sbor-mcp
```

**As a remote MCP server**, for Claude on the web, ChatGPT and any client that
connects by address, with nothing to install:

```
https://mcp.sbor.xyz/mcp
```

No key and no sign-in. The remote server is built from the same code as the
local one, so both give the same answers. Then call `compare_rate`. Setup for
each client is in [mcp/](mcp/), and the short version for agents is
[AGENTS.md](AGENTS.md).

**Over plain HTTP**, no key, no registration, no fee, CORS open. Licensed
CC BY 4.0, so you can build on it commercially without asking.

Four things to get right:

- **Read utilization beside every rate.** A cheap rate at low utilization means
  almost nobody is borrowing. Above 90%, the pool is nearly empty and
  withdrawals may be constrained.
- **Never add protocol yield to a lending rate.** It comes from holding the
  asset, not from the loan, and is published separately.
- **Borrowing a yield-bearing token means owing its yield as well as the
  interest.** The true cost of borrowing stSTX is its borrow rate plus the yield
  it accrues. The raw rates can suggest carry that does not exist.
- **Read `venues` before quoting a rate.** An index covering one venue is a
  reading of that venue, not a market average.

Machine-readable context and the full integration policy are at
[llms.txt](https://sbor.xyz/llms.txt).

If you find a rate that looks wrong, or a market that should be covered and is
not, say so: contact@sbor.xyz. Corrections are the point.

If SBOR was useful and you post publicly, cite it or follow
[@SBORindex](https://x.com/SBORindex). A benchmark is worth what people
reference it for.

### On-chain, on five chains

After each fixing, the day's rates are posted on-chain, so contracts and agents
can read them on their own chain:

| Chain | Contract | Since | Live page |
|---|---|---|---|
| Arc (chain 5042) | `0x56B5417de539153994fF6785F8a3b56421C9eb4f` | 1 Oct 2026 | [arc.html](https://sbor.xyz/arc.html) |
| Stacks | `SP2SRS600PZ70VHY09CK06FSYKW546NY2ARG6N8CD.sbor-fixings` | 2 Oct 2026 | [stacks.html](https://sbor.xyz/stacks.html) |
| Base (chain 8453) | `0xfc968C7A39bA80b1F6E3c0c058311EbD5d724323` | 7 Oct 2026 | [base.html](https://sbor.xyz/base.html) |
| Solana | program `85uzArk6VwzWG6mxZC7D2jLEPGhFL2SXzJs7P9zQUSz9`, plus a daily signed memo | 7 Oct 2026 | [solana.html](https://sbor.xyz/solana.html) |
| Hyperliquid, HyperEVM (chain 999) | `0x56B5417de539153994fF6785F8a3b56421C9eb4f` | 8 Oct 2026 | [hyperliquid.html](https://sbor.xyz/hyperliquid.html) |

On the EVM chains (Arc, Base, Hyperliquid), call `latest(bytes32)` with a rate's
name as bytes32 (`SBOR-USD`, `SBOR-BTC`, `SBOR-STX` or `BTC-COLLATERAL-USDC`) for
its borrow and supply rate in basis points, its size and its fixing date;
`onDate(bytes32, uint32)` returns any past day. Source:
[`contracts/SBORFixings.sol`](contracts/SBORFixings.sol). On Stacks, the same
reads are `get-latest` and `get-on-date`, keyed by the rate's name as a string,
in [`contracts/sbor-fixings.clar`](contracts/sbor-fixings.clar). On Solana, the
program keeps the latest rates in one account any program can read,
`85F1segB7Mrsj8ZFsGBGCpNHfuu1qEwLxmQEykphtFtF`; source in
[`contracts/solana/`](contracts/solana/). The JSON API remains the
authoritative record.

## Method, in short

- **Currencies are never blended.** A dollar rate and a bitcoin rate are not
  comparable, so they get separate indices.
- **Rates come from contract state**, not from an interface.
- **Utilization is published beside every rate**, because it is the reason a rate
  sits where it does.
- **Concentration is published per index.** A single-venue index is a reading of
  that venue, not a market average.
- **Protocol yield is excluded from the fixing** and published separately. It
  comes from the asset, not the loan.
- **Nothing is estimated.** If a source cannot be read, the gap is marked and the
  market is excluded rather than filled in.
- **Fixings are never rewritten.** Corrections appear as a new fixing with a
  note, or as a visible withdrawal record.
- **Term averages** over 30, 90 and 180 days are compounded, actual/365, and
  publish only once the full window of fixings exists. They are the same three
  windows the Federal Reserve Bank of New York publishes for SOFR, and the SOFR
  averages are shown beside them.
- **Incentive campaigns are not part of any rate.** Temporary programs that pay
  borrowers or suppliers on top of the contract rate are marketing, not the
  market. SBOR publishes the contract rate.
- **Rate basis is converted, not assumed.** Both venues return nominal annual
  rates from their contracts, confirmed with Zest. Each is converted the same
  way to an effective APY, and every market also carries its nominal figure.
- **Context is recorded, not used.** Each fixing also stores SOFR, spot BTC and
  STX prices, sBTC total supply and the Bitcoin block height. None of it enters
  an index. It is kept so a past fixing can be read in the conditions of its day.

Every fixing records the methodology version it was produced under. Full
methodology at [sbor.xyz](https://sbor.xyz) and in
[llms.txt](https://sbor.xyz/llms.txt).

## Sources

Lending rates from Zest and Granite contract state. Protocol yield and staking
context from StackingDAO. The BTC to STX rate used for the staking reference
from Bitflow, quoted in both directions. Proof of Transfer rewards from Hiro.
Market sizes read from the contracts, with DefiLlama as a cross-check.

In the comparison, rates are read from the venues' own contracts, on the same
basis as SBOR: Aave on Ethereum and Base, HyperLend on Hyperliquid, and Kamino's
reserve accounts on Solana. DefiLlama selects the largest market on each chain,
supplies its size, and stands in for a rate only if a contract read fails; each
market's source field says which. SOFR
and its averages come from the Federal Reserve Bank of New York. Spot prices,
recorded as context only, come from CoinGecko. Every source is named on the site
and in the machine-readable documentation.

## How it runs

A GitHub Action computes the fixing and commits it. It is attempted up to four
times a day, because the scheduler can drop runs, and the first to land is
final: later attempts are backups that run only if the day has no fixing yet. The
site serves directly from this repository, so the published record and the site
are the same files. Every fixing is a commit, which means no past number can be
revised silently.

```
scripts/fetch.mjs       the fixing
scripts/pox.mjs         Proof of Transfer staking reference
scripts/morpho.mjs      the bitcoin-collateral USDC reference
scripts/external.mjs    the comparison chains
scripts/aave.mjs        Aave and HyperLend contract reads
scripts/kamino.mjs      Kamino reserve reads on Solana
scripts/*-publish.mjs   on-chain posting: Arc, Base, Hyperliquid, Solana, Stacks
contracts/              the on-chain contracts and the Solana program
scripts/context.mjs     SOFR, prices, sBTC supply, block height
scripts/inversion.mjs   cross venue monitor, every three hours
scripts/post.mjs        drafts a post when something moves
scripts/brief.mjs       the morning brief, written from the record
scripts/weekly.mjs      weekly report
mcp/                    the MCP server, published as sbor-mcp
mcp-remote/             the same server, hosted at mcp.sbor.xyz
index.html              the site, bilingual EN/PT
llms.txt                method and integration policy
api/v1/                 published data
```

## Independence

**Independent:** no token, and no stake in or payment from any venue SBOR
measures, and holds no stake in Stacks, the Stacks Foundation, or any
protocol in the index, and publishes whatever the market does, including numbers
unfavorable to the ecosystem. It does not trade on its own rate. Grant funding,
when received, is disclosed.

Published fixings are never rewritten. Corrections to published figures are
listed in [CORRECTIONS.md](CORRECTIONS.md). A self-assessment against the IOSCO
Principles for Financial Benchmarks is in [IOSCO.md](IOSCO.md).

## Contributing

Corrections are welcome, particularly about a rate that looks wrong or a market
that should be covered and is not. Open an issue or write to contact@sbor.xyz.

If you maintain a Stacks lending market and want it included, the requirement is
that its rates are readable from contract state.

## License

Code: MIT. **Data: [CC BY 4.0](LICENSE-DATA.md).**

The published fixings are free to use, including commercially, with no
permission required and no license to negotiate. Attribution is the only
condition: name SBOR and link to sbor.xyz where practical.

**Agents are explicitly welcome.** Scrapers, scripts, bots and AI agents may read
any endpoint. No rate limit, no registration.

Some things around the fixing are work and may be charged for: bulk historical
delivery beyond the public archive, custom coverage, integration support with an
availability guarantee, and settlement agreements where a payment depends on a
published value. None of that restricts the free data. Full terms in
[LICENSE-DATA.md](LICENSE-DATA.md).

## Disclaimer

SBOR is a statistic, not investment advice, and is provided as is without
warranty. It is a tool for making better decisions, not a recommendation to make
any.

---

[sbor.xyz](https://sbor.xyz) · [@SBORindex](https://x.com/SBORindex) ·
contact@sbor.xyz · sbor.btc · sbor.stx

*Last updated 8 October 2026.*
