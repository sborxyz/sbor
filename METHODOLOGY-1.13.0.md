# SBOR methodology 1.13.0: notice of change

*Announced 9 October 2026. Takes effect with the fixing of Wednesday 14 October 2026, 08:30 UTC.*

## In one paragraph

From 14 October 2026, SBOR's headline is what it costs to borrow **any dollar stablecoin** against **plain bitcoin**, across every eligible market on every chain SBOR reads: code `BTC-COLLATERAL-USD`. Beside it, SBOR publishes a rate for each stablecoin with $25M or more covered. `BTC-COLLATERAL-USDC` continues under the same name and on-chain key, as the USDC rate, so its history is unbroken. The Stacks indices (SBOR-USD, SBOR-BTC, SBOR-STX) do not change.

From the fixing of 10 October, every fixing publishes the new rates as `methodologyPreview` in [latest.json](https://sbor.xyz/api/v1/latest.json), marked "preview, not a fixing", so the change can be read on real contract data before it applies.

## What changes

- **Collateral:** markets whose only collateral is plain 1:1 bitcoin, on Ethereum, Base, Arc, Arbitrum, BNB Chain and Stacks. Yield-bearing, staked or basket bitcoin is excluded.
- **Loan asset:** every dollar stablecoin, not only USDC. On 9 October 2026 that meant USDC, USDT, RLUSD, PYUSD, USD1 and U.
- **Venues:** Morpho, Lista Lending (BNB Chain) and Granite (Stacks).
- **A $1M floor**, read from contract state.
- **A depeg guard** and **a collateral check** at every fixing, below.

## What does not change

- Rates are read from contract state, never from a venue's displayed figure.
- Every market is shown with its rate, size and weight.
- New markets enter at zero weight and reach full weight over 30 days (here from 14 October), so the headline glides rather than steps.
- Published fixings are never rewritten.
- The Stacks indices, their method and their names.

## The rules

**1. Collateral: plain bitcoin only.**
- 1.1 A market is eligible only if every token that can be posted as collateral to borrow its loan asset is an eligible bitcoin token: a 1:1 claim on native bitcoin that does not change in value against bitcoin, is redeemable for native bitcoin by a defined class of holders, and is backed by native bitcoin, not by other tokens.
- 1.2 If the issuer discloses, or its terms permit, that reserve bitcoin is staked, lent, pledged or deployed to earn yield, the token is excluded, even if it trades at par. Staking or vault receipts built on a plain token are separate tokens and are excluded.
- 1.3 A representation on another chain is eligible only if minted by the issuer or through a cross-chain mechanism the issuer designates as canonical.
- 1.4 Principal tokens, yield tokens, basket tokens, fund units and strategy-vault tokens are excluded.
- 1.5 Rewards paid to holders from a separate incentive budget, which do not draw on reserve bitcoin, do not affect eligibility.
- 1.6 Eligible at 1.13.0: WBTC, cbBTC, BTCB, kBTC, cirBTC, tBTC, sBTC. Under review: Lombard BTC.b, UBTC, strkBTC, xBTC, zBTC. Excluded: FBTC, until its custody terms on reserve use are confirmed; vbWBTC, whose reserve is deployed for yield.

**2. Loan asset: every dollar stablecoin.**
- 2.1 A freely transferable token on a public chain, redeemable 1:1 for US dollars or designed to hold one dollar, whose value to the holder does not accrue over time. Any issuer, including banks.
- 2.2 Excluded: yield-bearing tokens; deposit tokens restricted to a bank's clients; tokens pegged to another currency.
- 2.3 Dollars backed by other stablecoins or by positions are eligible and carry the flag `synthetic`.
- 2.4 A CDP's mint rate or stability fee is never a constituent. A CDP-issued dollar counts only as the loan asset of a market supplied by lenders and priced by its own utilization, and not where its issuer supplies more than half of it.

**3. The rate must belong to the market.**
- 3.1 The borrow rate must come from an interest rate model that responds only to that market's own supply and borrowing, readable from contract state.
- 3.2 Excluded: pooled markets, where one rate prices loans against several collateral types, and per-pair vaults that pay a shared liquidity layer's rate.
- 3.3 Rates are read as nominal annual rates (Morpho and Lista: `borrowRateView` per second times 31,536,000; Granite as in 1.12.0) and converted to effective rates as e^r - 1. The nominal rate is published beside each.

**4. A $1M floor.**
- 4.1 A market's size is the loan asset supplied, read from contract state. Displayed totals and liquidity that vaults could move in are never used.
- 4.2 A market counts while its size is $1,000,000 or more. Below it, the market carries zero weight and is listed as context with the reason. After 30 consecutive fixings below, it is removed and re-enters under the 30-day phase-in.
- 4.3 Weight is size times the phase-in factor.

**5. Depeg guard.** A market carries zero weight for the fixing if its stablecoin is priced below $0.98, or its bitcoin token more than 2% below bitcoin. Prices come from DefiLlama's price service. If prices cannot be read, the fixing says the guard was not applied; no market is removed on missing data.

**6. Collateral that governance can change is checked at every fixing.** Where a venue's admitted collateral can be changed after deployment (Granite on Stacks), every fixing reads its collateral settings for each token used in Stacks lending. The market counts only while sBTC is the one collateral admitted. If the settings cannot be read, it carries no weight.

**7. Fixed-term loans are not part of the variable rate.** Markets whose interest rate model returns zero with interest priced elsewhere (Lista's term markets), fixed-rate protocols, CDP loans fixed at opening and peer-to-peer loans are excluded.

**8. Incentives.** Only the contract rate enters a fixing; rewards are never netted into it. A market whose borrowers are paid rewards carries zero weight. A market whose lenders receive rewards is flagged `lenderIncentive` and keeps its weight.

**9. The headline and the rate per stablecoin.**
- 9.1 `BTC-COLLATERAL-USD`, the SBOR headline: the weighted borrow and supply rate across every eligible market.
- 9.2 `BTC-COLLATERAL-<TOKEN>` for each stablecoin with $25M or more of weighted supply. USDT0 counts as USDT, USDCx as USDC.
- 9.3 `BTC-COLLATERAL-USDC` keeps its name and on-chain key, and from 1.13.0 covers every eligible USDC market.
- 9.4 Each rate carries its venue count and its largest constituent's weight.
- 9.5 A rate is withheld when markets that could not be read carried a quarter or more of its weight; otherwise it is published and the omission is noted.

## Questions

contact@sbor.xyz, or an issue at [github.com/sborxyz/sbor](https://github.com/sborxyz/sbor).
