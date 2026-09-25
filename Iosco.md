# SBOR and the IOSCO Principles for Financial Benchmarks

*A self-assessment. Created 24 September 2026. Last updated 24 September 2026.*

The International Organization of Securities Commissions published its Principles for Financial Benchmarks in July 2013, after the manipulation of major interest rate benchmarks. There are 19 of them, in four groups: governance, the quality of the benchmark, the quality of the methodology, and accountability. They were endorsed by the G20 and are the standard against which benchmark administrators describe themselves.

**This is a self-assessment, not an audit or a certification.** SBOR is not a regulated benchmark administrator, and nobody has verified what follows. IOSCO itself says the Principles should be applied in proportion to the size and risk of each benchmark and its administrator, and that is how this page reads them. Where SBOR does not yet meet a principle, it says so, and says what exists in the meantime.

**Scope.** The three SBOR indices: SBOR-USD, SBOR-BTC and SBOR-STX. SBOR also publishes references that are not indices, such as SBOR-PoX, the bitcoin-collateral USDC rate and the comparison with other chains. The same practices apply to them, but they never enter a fixing.

## Summary

| # | Principle | Status |
|---|---|---|
| | **Governance** | |
| 1 | Overall responsibility of the administrator | Partly met |
| 2 | Oversight of third parties | Partly met |
| 3 | Conflicts of interest | Met |
| 4 | Control framework | Partly met |
| 5 | Internal oversight | Planned |
| | **Quality of the benchmark** | |
| 6 | Benchmark design | Met |
| 7 | Data sufficiency | Partly met |
| 8 | Hierarchy of data inputs | Met |
| 9 | Transparency of determinations | Met |
| 10 | Periodic review | Partly met |
| | **Quality of the methodology** | |
| 11 | Content of the methodology | Met |
| 12 | Changes to the methodology | Partly met |
| 13 | Transition | Partly met |
| 14 | Submitter code of conduct | Not applicable |
| 15 | Internal controls over data collection | Met |
| | **Accountability** | |
| 16 | Complaints procedures | Partly met |
| 17 | Audits | Planned |
| 18 | Audit trail | Met |
| 19 | Cooperation with regulatory authorities | Not applicable |

---

## Governance

### 1. Overall responsibility of the administrator: partly met

SBOR defines its indices, writes and publishes the methodology, computes and publishes the daily fixing, and answers for it at contact@sbor.xyz. The methodology is public in full at [sbor.xyz/llms.txt](https://sbor.xyz/llms.txt) and on the site's Methodology tab.

**Missing:** SBOR is not yet a separate legal entity. Planned: a company to act as the administrator.

### 2. Oversight of third parties: partly met

SBOR reads rates directly from lending contracts and depends on public infrastructure to do so. The sources:

- **Stacks contract state** for Zest and Granite, through the Hiro API.
- **Ethereum and Base contract state** for Aave and Morpho, through public RPC endpoints, three per chain with automatic failover.
- **DefiLlama** for Zest's depth and for comparison venues not read from their contracts. Each comparison market states its source.
- **CoinGecko** for prices, **Bitflow** for the bitcoin to STX rate, the **New York Fed** for SOFR, and **StackingDAO's** published method for the stBTC yield.

Every read is checked, and a source that fails or returns something implausible is left out rather than replaced with an estimate.

**Missing:** there are no written agreements with these providers. They are public services used on their public terms.

### 3. Conflicts of interest: met

SBOR has no token, takes no payment from any venue it measures, holds no stake in one, and does not trade on its own rate. Grant funding, when received, is disclosed. If SBOR ever charges for services, paying will buy delivery or guarantees, never an earlier look at a fixing or a different number.

### 4. Control framework: partly met

The controls are built into the code that produces the fixing:

- A plausibility floor: a funded market reading below 0.05% on both sides is left out, since that is not a rate lenders and borrowers set.
- Staleness limits: the agent tools refuse to give a verdict on data older than 48 hours.
- Changes to the production code are tested against forced failures before release, and a separate workflow runs a complete fixing without publishing it, to prove changes against the live chains.
- Every workflow file is checked with GitHub's own validator before it is committed.
- A failure in the fixing, the morning brief, the post drafter or the change feed sends an alert. A reference that cannot be read, such as SBOR-PoX, is left out of that day's publication and logged.
- A change feed records when a lending protocol changes its own parameters, so a rate move caused by the protocol is never mistaken for a market move.

**Missing:** these controls are documented in the code and in the methodology, not in a separate written control framework.

### 5. Internal oversight: planned

There is no oversight function independent of the people who produce the rate. What exists in its place is transparency: every fixing and every change to the code is a public commit, and the code is open source, so anyone can check both. Planned: an independent reviewer once funding allows.

---

## Quality of the benchmark

### 6. Benchmark design: met

Each index measures the cost of borrowing and the return on supplying one currency on Stacks, weighted by the depth of each lending market, as effective annual rates read from contract state. The design, its rationale and its limits are set out in the methodology.

### 7. Data sufficiency: partly met

The inputs are the rates lending contracts actually charge and pay at the moment of the fixing: live market state, not quotes, estimates or submissions.

**The limit:** some indices rest on few venues. Every fixing publishes the number of venues and the weight of the largest, so a reader can see when an index is effectively a single market. When a market cannot be read, or its rate is set by the protocol rather than by the market, the index is left out: SBOR-BTC was withheld for sixteen days while its only market's rate was held at zero by design.

### 8. Hierarchy of data inputs: met

Contract state comes first. DefiLlama is used only where a figure cannot yet be read from a contract, and is labeled wherever it is used. No expert judgment or submitted rate enters any fixing.

### 9. Transparency of determinations: met

Every fixing publishes each constituent market with its rate, utilization, depth and weight, the methodology version it was produced under, and notes on anything unusual. Current and historical data are open at [sbor.xyz/api/v1/latest.json](https://sbor.xyz/api/v1/latest.json), with the full history and a daily archive alongside.

### 10. Periodic review: partly met

The methodology is revised when the markets change, and every revision is versioned and published.

**Missing:** there is no fixed review schedule. Planned: a published review at least once a year, and whenever a constituent market changes materially.

---

## Quality of the methodology

### 11. Content of the methodology: met

The methodology states what is measured, where each input comes from, how markets are weighted, how rates are annualized, when a market is left out, and how corrections are handled. It is published in full at [sbor.xyz/llms.txt](https://sbor.xyz/llms.txt), written to be read by people and by agents.

### 12. Changes to the methodology: partly met

Every fixing records the methodology version that produced it, and published fixings are never rewritten, so every historical figure can be traced to the method in force at the time. Changes are documented when they are made.

**Missing:** material changes are not yet announced in advance with a period for comment. Planned.

### 13. Transition: partly met

SBOR has handled a live contract migration: when Zest moved to a new data contract, the fixing read the new one and kept the previous one as a fallback. The change feed now detects such migrations the day they happen.

**Missing:** there is no written policy for what happens if an index, or a constituent market, stops being viable. Planned.

### 14. Submitter code of conduct: not applicable

SBOR has no submitters. No one submits a rate; every input is read from public contract state.

### 15. Internal controls over data collection: met

Every read checks that the response is the expected shape, that a market is the one intended (for example, that a Morpho market really lends USDC against the named collateral), and that the value is plausible. A read that fails any check is refused rather than published.

---

## Accountability

### 16. Complaints procedures: partly met

Anyone can raise a concern about a fixing at contact@sbor.xyz or as an issue on the public repository. Corrections to published figures are recorded in [CORRECTIONS.md](CORRECTIONS.md).

**Missing:** a written complaints policy with response times. Planned.

### 17. Audits: planned

SBOR has not been audited by an independent party. In the meantime, the code is open source and the data is openly licensed, so any fixing can be reproduced by anyone from public contract state. Planned: an external review once funding allows.

### 18. Audit trail: met

Every fixing is a public commit in the repository, kept alongside a daily archive of the full published record and a compact history of every fixing. Changes to protocol parameters are recorded in [api/v1/changes.json](https://sbor.xyz/api/v1/changes.json). Nothing published is overwritten.

### 19. Cooperation with regulatory authorities: not applicable

SBOR is not currently supervised by any authority. Every record described above is public, and SBOR would cooperate with any authority that asked.

---

This assessment is reviewed at least once a year, and whenever the methodology changes. Questions or disagreements: contact@sbor.xyz.
