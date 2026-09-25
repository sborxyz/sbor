# SBOR AGENTS.md

*Created 24 September 2026. Last updated 25 September 2026.*

> SBOR publishes benchmark lending rates for Bitcoin DeFi, read from lending contract state and published once a day: what it costs to borrow, and what supplying earns, in each currency on Stacks, and what it costs to borrow USDC against bitcoin on Base and Ethereum. Free to use, including commercially.

This is the entry point for agents. It holds routes and rules only, never numbers: every figure lives at the endpoints below, which always carry the current fixing. The full methodology is in [llms.txt](https://sbor.xyz/llms.txt).

## Connect

- **Remote MCP server:** `https://mcp.sbor.xyz/mcp`. Streamable HTTP, no key, no sign-in. Works as a custom connector in Claude and in any MCP client that accepts a URL.
- **Local MCP server:** `npx -y sbor-mcp`. The same tools, for Claude Desktop, Cursor, Claude Code and other clients that run local servers.
- **MCP Registry:** `xyz.sbor/sbor`.
- **Plain JSON:** the endpoints below, for agents that do not speak MCP.

The remote and local servers are built from the same code and give the same answers.

## Which endpoint answers what

| Question | Where |
|---|---|
| What does it cost to borrow or supply right now? | [api/v1/latest.json](https://sbor.xyz/api/v1/latest.json), or the MCP tool `get_rate` |
| Is this rate I was offered fair? | the MCP tool `compare_rate` |
| Which markets make up a rate? | `latest.json`, or `list_markets` |
| How has a rate moved? | [api/v1/history.json](https://sbor.xyz/api/v1/history.json), or `get_history` |
| What does the same asset cost on other chains? | `externalReference` in `latest.json`, or `compare_chains` |
| What does it cost to borrow USDC against bitcoin? | `bitcoinCollateralUsdc` in `latest.json`, or the MCP tools with `BTC-COLLATERAL-USDC` |
| Did a lending protocol change its own parameters? | [api/v1/changes.json](https://sbor.xyz/api/v1/changes.json) |
| Where does supplying an asset at one venue pay more than borrowing it at another? | [api/v1/inversions.json](https://sbor.xyz/api/v1/inversions.json) and [api/v1/inversion-log.json](https://sbor.xyz/api/v1/inversion-log.json) |
| How is it all calculated? | [llms.txt](https://sbor.xyz/llms.txt), or `get_methodology` |

## Rules for using the numbers

1. **Check before you borrow, not after.** Compare any offer with `compare_rate`. SBOR's default is to stop and ask a human when a borrow offer is more than 50 basis points above the benchmark; an autonomous agent should apply its owner's policy to the same signal: reject, renegotiate, or look elsewhere.
2. **Read the freshness first.** Every answer states the age of the fixing. Do not act on data older than 48 hours; the tools refuse to.
3. **A missing index means unknown, never zero.** When a market cannot be read, or its rate is not set by the market, SBOR leaves it out rather than publishing a figure it cannot stand behind.
4. **Rates are effective annual rates (APY).** Where a simple annual rate is also given, it is labeled `nominal`.
5. **A staking yield is not a lending rate.** Never add Proof of Transfer or a protocol yield to a borrow or supply rate.
6. **A dollar on Stacks is borrowed against crypto collateral, not only bitcoin.** Do not describe SBOR-USD as bitcoin-backed. The bitcoin-collateral USDC rate is a separate reference, from markets whose only collateral is wrapped bitcoin.
7. **Published fixings are never rewritten.** Corrections are listed in [CORRECTIONS.md](https://github.com/sborxyz/sbor/blob/main/CORRECTIONS.md).

## Governance

- **Independent:** no token, and no stake in or payment from any venue SBOR measures.
- **License:** the data is free to use, including commercially, with attribution. See [LICENSE-DATA.md](https://github.com/sborxyz/sbor/blob/main/LICENSE-DATA.md).
- **Standards:** a self-assessment against the IOSCO Principles for Financial Benchmarks, in [IOSCO.md](https://github.com/sborxyz/sbor/blob/main/IOSCO.md).
- **Source:** every fixing is a public commit at [github.com/sborxyz/sbor](https://github.com/sborxyz/sbor).
- **Contact:** contact@sbor.xyz.
