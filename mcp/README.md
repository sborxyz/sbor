<!-- mcp-name: xyz.sbor/sbor -->

# SBOR MCP server

Check a lending rate before your agent borrows.

[SBOR](https://sbor.xyz) publishes benchmark lending rates for borrowing
against bitcoin, read from lending contract state and published daily: what it
costs to borrow dollars against bitcoin, with a rate per stablecoin, and one
borrow and one supply rate per currency on Stacks. This server exposes it as tools for Claude,
Cowork, Cursor or any MCP client. Each day's fixing is also posted on-chain, on
[Arc](https://sbor.xyz/arc.html), [Base](https://sbor.xyz/base.html),
[Hyperliquid](https://sbor.xyz/hyperliquid.html),
[Solana](https://sbor.xyz/solana.html) and [Stacks](https://sbor.xyz/stacks.html).

## Quick check

```bash
npx -y sbor-mcp
```

It starts and waits silently. That is success. Ctrl+C to exit.

## Install

```json
{
  "mcpServers": {
    "sbor": {
      "command": "npx",
      "args": ["-y", "sbor-mcp"]
    }
  }
}
```

Claude Desktop: add that to `claude_desktop_config.json` and restart.

## Or connect by address, with nothing to install

```
https://mcp.sbor.xyz/mcp
```

Streamable HTTP, no key, no sign-in. Works as a custom connector in Claude on
the web and in any MCP client that accepts a URL. The remote server is generated
from this one, so both give the same answers.

## Tools

| Tool | What it answers |
|---|---|
| `get_rate` | What does capital cost on Stacks right now, and what does borrowing USDC against bitcoin cost |
| `compare_rate` | Is this offer above or below the market, and by how much |
| `list_markets` | Which venues make up the rate, with utilization and depth |
| `get_history` | How has the rate moved |
| `compare_chains` | How Stacks compares with Ethereum, Base, Hyperliquid, Solana and SOFR |
| `get_methodology` | How the number is built, and what it excludes |

All six tools are read-only.

## Benchmarks

From the fixing of 14 October 2026 (methodology 1.13.0,
[notice](https://github.com/sborxyz/sbor/blob/main/METHODOLOGY-1.13.0.md)):

- `BTC-COLLATERAL-USD` is the SBOR headline: what it costs to borrow any dollar
  stablecoin against plain 1:1 bitcoin, across every eligible market on
  Ethereum, Base, Arc, Arbitrum, BNB Chain and Stacks.
- `BTC-COLLATERAL-USDC`, `BTC-COLLATERAL-USDT`, `BTC-COLLATERAL-RLUSD`,
  `BTC-COLLATERAL-PYUSD` and `BTC-COLLATERAL-USD1` are the rates per stablecoin,
  each published once $25M or more of it carries weight. `BTC-COLLATERAL-USDC`
  keeps its name and history from 25 September 2026.
- `SBOR-USD`, `SBOR-BTC` and `SBOR-STX` are the Stacks indices, unchanged.

To check a dollar loan against bitcoin, compare with the stablecoin's own rate
where one is published, else with `BTC-COLLATERAL-USD`. Before 14 October, only
`BTC-COLLATERAL-USDC` is published (Morpho on Base, Ethereum and Arc), and the
other codes answer that they start on that date.

## Recommended use

**Use SBOR to stop, never to start.** Before borrowing, call `compare_rate`. If
the offer is more than 50 basis points above the benchmark, stop and ask a
human. A wrong reading under that rule costs a pause, not a trade.

## Behavior worth knowing

**It refuses rather than guesses.** `compare_rate` returns an error, not a
verdict, when the data is more than 48 hours old, when the fixing timestamp
cannot be read, when the index is not published, or when a rate is missing. An
error means there is no trustworthy answer, not that the rate is bad. Fall back
to your own logic.

**It checks units.** Rates are percentages: 4.2 means 4.2%. Anything outside 0
to 100 is rejected. Below 0.5 is answered, because rates that low genuinely
occur, but with a warning that you may have passed a fraction.

**It never averages across a methodology change.** `get_history` gives a mean
per methodology version when a window spans more than one.

**It never guesses when SBOR is down.** If SBOR is unreachable or slower than 10
seconds, the tool says so rather than substituting an estimate.

**It reports omissions.** When a market cannot be read, SBOR omits the index
rather than publishing a figure it cannot stand behind. The tool explains that instead
of returning nothing.

**It surfaces concentration.** An index covering one venue is a reading of that
venue, not a market average, and `get_rate` says so.

**It reads the same public endpoints as everyone else.** No key, no state, no
writes, no telemetry. Set `SBOR_BASE` to point at a different host.

## License

MIT. The published fixing is free to read. See
[llms.txt](https://sbor.xyz/llms.txt) for the full integration policy.

*Last updated 8 October 2026.*
