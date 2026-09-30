# SBOR corrections

*Created 24 September 2026. Last updated 30 September 2026.*

SBOR never rewrites a published fixing. When a published figure turns out to be wrong, the record keeps what was published, and this page says what was wrong, when it was found, and what changed. It lists corrections to published figures only; fixes to the site and documentation are visible in the repository's public history.

Newest first.

---

### 30 September 2026: Zest market sizes on a different basis from 26 September

**What was wrong.** From the fixing of 26 September, DefiLlama began reporting Zest's markets as the amount still available to lend rather than the amount supplied. SBOR took most Zest market sizes from DefiLlama, so from that day those markets were weighted by what was left to lend: a market with high utilization counted for less than its real size. Found on 30 September, when a test compared each Zest contract's total with DefiLlama's figure and every gap matched that market's utilization; Zest STX, 40% lent, showed $1.43 million against $2.37 million supplied.

**The effect, 26 to 30 September.** SBOR-STX was published 3 to 5 basis points too low to borrow and 4 to 7 basis points too low to supply. SBOR-USD was about 1 basis point too high. SBOR-BTC's rate was unaffected, since it has one market, but its published size was about 11% too low. The same change is why the brief of 26 September reported falls in depth that were not moves in the market. Published fixings are not rewritten.

**What changed.** Methodology 1.11.0, from the fixing of 1 October: Zest market sizes are read from the Zest vault contracts, valued exactly (dollar stablecoins at par, sBTC at the bitcoin price, STX at the STX price, stSTX at the STX price times StackingDAO's own stSTX rate), with DefiLlama as the fallback and as a published cross-check on each market. Depth and weights step up on 1 October as a result; the brief treats a methodology change as a data event, not a market move.

---

### 28 September 2026: a dollar rate shown as a bitcoin rate, and depth on a different basis, in the comparison

**What was wrong.** The comparison of bitcoin borrowing across chains, published beside SBOR-BTC, showed Morpho on Base at 4.90% for cbBTC. That row came from DefiLlama's listing of cbBTC as collateral on Morpho, not as an asset being lent: its "borrow rate" was the rate for borrowing USDC against cbBTC. The signs were in the row itself: 0.00% to suppliers at 46.53% utilization, which no lending market pays. The same comparison also showed each other chain's depth as what remained available to borrow, as the source reports it for a lending pool, rather than what was supplied: Aave's USDC market on Ethereum appeared as $189 million. The comparison is context and never entered an SBOR index.

**What changed.** From the fixing of 29 September, Morpho listings are excluded from the bitcoin comparison, and any listing whose lenders earn nothing at meaningful utilization is refused, since it is not the asset being lent. The cost of borrowing USDC against bitcoin is published separately, read from the Morpho contracts, as the bitcoin-collateral USDC reference. Depth in the comparison is now total supplied, as it is for every SBOR market.

---

### 26 September 2026: SBOR-USD published without its largest market, withdrawn and republished

**What was wrong.** The fixing of 26 September published SBOR-USD at 1.46%, down from 2.65% the day before, with nothing in its notes. Zest's USDCx market, 3.28% and $10.2 million supplied the day before, two thirds of the index's depth, had been left out: DefiLlama, the source of Zest market sizes, returned no size for it, and a market without a size was dropped with only a line in the run log. The index was computed from the two remaining markets. The market itself had not changed.

**What changed.** The figure was withdrawn at 13:44 UTC, and a corrected fixing was published at 14:22 UTC under methodology 1.10.0: SBOR-USD at 2.68%, with all three markets, Zest's USDCx sized from its own contract. The corrected rates were read at 14:22 UTC, not at 08:30. The fixing of 08:30, with 1.46%, remains in the repository's public history.

Methodology 1.10.0 reads a Zest market's size from the Zest contract when DefiLlama returns none; every market carries the source of its size; a market missing from an index it was in is noted on the fixing; and an index missing a quarter or more of its depth, if even the contract cannot be read, is withheld rather than published short. The morning brief and the post drafter treat a missing market as a data event, never as a market move.

---

### 24 September 2026: SBOR-PoX measured over a misaligned window and the wrong cycle's stake

**What was wrong.** From its first publication, SBOR-PoX measured each completed Proof of Transfer cycle over a window that started 350 bitcoin blocks early, so about one paying block in eight belonged to the previous cycle. It also divided the bitcoin paid by the STX locked in the following cycle, rather than in the cycle measured. The figures were close but not exact. Because the STX locked grew between cycles, the second error understated the yield by roughly five percent of its value.

**What changed.** From the fixing of 25 September, each cycle is measured over the chain's own cycle boundaries, and against that cycle's own STX locked. Every SBOR-PoX figure now carries a measurement version; the corrected method is version 2. Earlier fixings are not rewritten, and the first corrected cycle is not compared with earlier ones as if the yield had moved.

---

### 8 September 2026: the reason given for withdrawing SBOR-BTC was wrong

**What was wrong.** The withdrawal of 5 September, below, said the 0.01% reading meant Zest's contract was not reporting a real rate. Zest explained that the contract was reporting correctly: the sBTC rate curve had been set to zero by design, until the first bitcoin bond reward.

**What changed.** The rate was real, but set by the protocol rather than by lenders and borrowers, so it still does not belong in a benchmark of market rates, and SBOR-BTC stayed out until the market set a rate. It has been published since 17 September. The original reason remains in the record, corrected by this entry.

---

### 5 September 2026: SBOR-BTC published at 0.01%

**What was wrong.** The fixing published SBOR-BTC, from Zest's sBTC market, at 0.01% to borrow and to supply, on a market holding about $53 million. That is not a rate a lending market sets.

**What changed.** The figure was withdrawn. The record keeps it, marked `withdrawn: true`, with the figure originally published. Methodology 1.1.0 added a plausibility floor: a funded market reading below 0.05% on both sides is left out of the index rather than published.

---

To report a figure that looks wrong: contact@sbor.xyz.
