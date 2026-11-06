# Build on SBOR

SBOR publishes the market rate for borrowing dollars against bitcoin, every day, read from the lending contracts. This page lists what can be built on it, and the pieces to build with.

## The ground rules

- **The data is free, including for commercial use,** under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with attribution to SBOR and sbor.xyz. No key, no sign-up, no permission needed.
- **SBOR stays neutral.** It never trades on its own rate, never sells early or private signals, and never endorses a product built on it.
- **What you build is yours,** and so is the responsibility for it. SBOR is a published statistic, not advice.

SBOR itself will never build trading or carry strategies, paid private alerts or execution. That field is left open to others.

## The pieces

- **HTTP:** [`/api/v1/latest.json`](https://sbor.xyz/api/v1/latest.json), today's fixing with every market, and [`/api/v1/history.json`](https://sbor.xyz/api/v1/history.json), the rolling daily record. No key, CORS open. Fields are never removed or repurposed.
- **Plain text:** [`/latest.txt`](https://sbor.xyz/latest.txt).
- **MCP, for agents:** `https://mcp.sbor.xyz/mcp` (remote) or `npx -y sbor-mcp` (local). Tools: `get_rate`, `list_markets`, `compare_rate`, `compare_chains`, `get_history`, `get_methodology`.
- **On-chain:** each day's rates are posted on Arc, Base, Hyperliquid, Solana and Stacks, readable by any contract. Addresses in [llms.txt](https://sbor.xyz/llms.txt).
- **Term averages:** compounded 30, 90 and 180 day averages of the headline and each Stacks index, published once each window is full.
- **Method:** the published methodology, with every fixing tagged with the version that produced it. See the [white paper](https://sbor.xyz/paper.html) and [llms.txt](https://sbor.xyz/llms.txt).

## Ideas

Each one: what it is, who it is for, and which pieces it uses.

### 1. Borrowing copilot
Checks a loan offer against the market before the borrower signs: "this offer is 80 basis points above SBOR".
- **For:** people and AI agents that borrow against bitcoin.
- **Uses:** MCP `compare_rate`, `latest.json`.

### 2. Refinancing alerts
Watches an open loan and says when the market has moved far enough below it that moving the loan is worth the cost.
- **For:** borrowers with open positions.
- **Uses:** `latest.json` daily, `history.json` for context.

### 3. Routing for idle stablecoins and treasuries
Shows where idle dollars or bitcoin sit across chains and venues, with utilization beside every rate, so a treasury can see where there is real capacity.
- **For:** DAOs, funds, treasuries.
- **Uses:** `latest.json` (every market, every chain), `compare_chains`.

### 4. Reports for funds and DAOs
Monthly marks and reports: what a position cost against the market each day, from a record anyone can audit.
- **For:** funds, bitcoin treasury companies, DAOs.
- **Uses:** `history.json`, `get_history`.

### 5. A floating-rate loan at SBOR plus a spread
A lender writes "SBOR plus 2%" into the loan, resetting daily or weekly. The borrower can check every reset.
- **For:** lenders, on-chain and off-chain.
- **Uses:** the on-chain fixing on the lender's chain.

### 6. Fixed-rate quotes shown against the market
A fixed-rate lender shows its rate beside SBOR, so a borrower sees how far it sits from the market.
- **For:** fixed-rate lenders.
- **Uses:** `latest.json` or the on-chain fixing.

### 7. Longer agreements on the averages
A loan or agreement that runs for months settles on SBOR's 30, 90 or 180 day average instead of one day's rate, the way dollar loans settle on SOFR's averages.
- **For:** anyone writing agreements longer than a few weeks.
- **Uses:** the term averages in `latest.json`.

### 8. Rate swaps and hedging
One side pays fixed, the other pays SBOR, settled by a contract that reads the rate on-chain. Lets a lender or a vault lock in a rate.
- **For:** lenders, vaults, structured products.
- **Uses:** the on-chain fixing.

## Built something?

Tell us at contact@sbor.xyz. SBOR does not endorse products, but it is glad to know what the rate is used for, and what is wrong with it.

*SBOR is a published statistic, not investment advice.*
