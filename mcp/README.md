# SBOR MCP server

Call [SBOR](https://sbor.xyz), the benchmark lending rate for Stacks, as a tool
from Claude or any MCP client.

## Install

```json
{
  "mcpServers": {
    "sbor": {
      "command": "npx",
      "args": ["-y", "@sbor/mcp"]
    }
  }
}
```

Claude Desktop: add that to `claude_desktop_config.json` and restart.

## Tools

| Tool | What it answers |
|---|---|
| `get_rate` | What does capital cost on Stacks right now |
| `compare_rate` | Is this offer above or below the market, and by how much |
| `list_markets` | Which venues make up the rate, with utilisation and depth |
| `get_history` | How has the rate moved |
| `compare_chains` | How does Stacks compare with Aave on Ethereum |
| `get_methodology` | How the number is built, and what it excludes |

## Behaviour worth knowing

**It never guesses.** If SBOR is unreachable the tool says so and tells you to
fall back to your own logic rather than substituting an estimate.

**It reports omissions.** When a market cannot be read, SBOR omits the index
rather than publishing a figure that is not real. The tool explains that instead
of returning nothing.

**It surfaces concentration.** An index covering one venue is a reading of that
venue, not a market average, and `get_rate` says so.

**It reads the same public endpoints as everyone else.** No key, no state, no
writes, no telemetry. Set `SBOR_BASE` to point at a different host.

## Licence

MIT. The published fixing is free to read. See
[llms.txt](https://sbor.xyz/llms.txt) for the full integration policy.
