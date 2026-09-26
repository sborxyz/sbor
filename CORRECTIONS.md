# SBOR corrections

*Created 24 September 2026. Last updated 26 September 2026.*

SBOR never rewrites a published fixing. When a published figure turns out to be wrong, the record keeps what was published, and this page says what was wrong, when it was found, and what changed. It lists corrections to published figures only; fixes to the site and documentation are visible in the repository's public history.

Newest first.

---

### 26 September 2026: SBOR-USD published without its largest market, and withdrawn

**What was wrong.** The fixing of 26 September published SBOR-USD at 1.46%, down from 2.65% the day before, with nothing in its notes. Zest's USDCx market, 3.28% and $10.2 million supplied the day before, two thirds of the index's depth, had been left out: DefiLlama, the source of Zest market sizes, returned no size for it, and a market without a size was dropped with only a line in the run log. The index was computed from the two remaining markets. The market itself had not changed.

**What changed.** The figure was withdrawn the same day. The record keeps it, marked `withdrawn: true`, with the reason. Methodology 1.10.0, from the fixing of 27 September: a Zest market size missing from DefiLlama is read from the Zest contract; every market carries the source of its size; a market missing from an index it was in is noted on the fixing; and an index missing a quarter or more of its depth is withheld rather than published short. The morning brief and the post drafter now treat a missing market as a data event, never as a market move.

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
