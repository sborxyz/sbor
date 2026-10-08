# SBOR on Solana

*Created 8 October 2026. Last updated 8 October 2026.*

The program that holds SBOR's daily rates on Solana mainnet, as deployed on
7 October 2026 from Solana Playground.

- Program: `85uzArk6VwzWG6mxZC7D2jLEPGhFL2SXzJs7P9zQUSz9`
- Rates account: `85F1segB7Mrsj8ZFsGBGCpNHfuu1qEwLxmQEykphtFtF`, derived from
  the seed `sbor-fixings`
- Publisher: `AY5EE9QiCpxy7DhpyZ81VReoBg94vt7dgaqzbqmwJtD1`, the only key
  allowed to post
- Live page, read from Solana in the browser: https://sbor.xyz/solana.html

Files:

- `lib.rs`: the instructions (initialize, publish, set_publisher, set_owner)
- `state.rs`: the account layout, `SBORFIX1` header then one 56-byte row per
  benchmark: key, date, borrow and supply in basis points, size in dollars,
  posted at
- `setup.ts`: the one-time setup run in Playground after deploying, which
  created the rates account and named the publisher

The daily posting is `scripts/solana-publish.mjs`, which also writes a signed
memo with the same rates. The JSON API remains the authoritative record.
