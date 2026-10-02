;; SBOR fixings on Stacks
;;
;; SBOR's daily benchmark lending rates, published on-chain so any Stacks
;; contract, app or agent can read them. Rates are in basis points (2.69% is
;; 269), each with the date of the fixing it comes from (YYYYMMDD, UTC).
;; Methodology: https://sbor.xyz
;;
;; The owner controls the contract; the publisher can only post rates. The
;; publisher is SBOR's daily automation: if its key is ever exposed, the owner
;; replaces it, and nothing else is at risk. Both checks use contract-caller,
;; so neither role can be exercised through another contract.
;; A day may be republished, as SBOR's corrections policy allows; an older
;; date can never overwrite a newer one. Every publication is printed, so a
;; republished day stays visible in the chain's history.

(define-constant ERR-NOT-OWNER (err u100))
(define-constant ERR-NOT-PUBLISHER (err u101))
(define-constant ERR-OLDER-THAN-LATEST (err u102))
(define-constant ERR-BAD-DATE (err u103))
(define-constant ERR-EMPTY (err u104))

(define-data-var owner principal tx-sender)
(define-data-var publisher principal 'SP3V51CEH9M04JANTNTK3SCQTTAHX3DW9B5S94CC8)

(define-map latest (string-ascii 32)
  { date: uint, borrow-bps: uint, supply-bps: uint, depth-usd: uint, published-at: uint })

(define-map on-date { key: (string-ascii 32), date: uint }
  { borrow-bps: uint, supply-bps: uint, depth-usd: uint, published-at: uint })

(define-read-only (get-owner) (var-get owner))
(define-read-only (get-publisher) (var-get publisher))
(define-read-only (get-latest (key (string-ascii 32))) (map-get? latest key))
(define-read-only (get-on-date (key (string-ascii 32)) (date uint))
  (map-get? on-date { key: key, date: date }))

(define-private (not-older
    (row { key: (string-ascii 32), borrow-bps: uint, supply-bps: uint, depth-usd: uint })
    (acc { date: uint, ok: bool }))
  { date: (get date acc),
    ok: (and (get ok acc)
             (>= (get date acc) (default-to u0 (get date (map-get? latest (get key row)))))) })

(define-private (write-row
    (row { key: (string-ascii 32), borrow-bps: uint, supply-bps: uint, depth-usd: uint })
    (date uint))
  (begin
    (map-set latest (get key row)
      { date: date, borrow-bps: (get borrow-bps row), supply-bps: (get supply-bps row),
        depth-usd: (get depth-usd row), published-at: stacks-block-height })
    (map-set on-date { key: (get key row), date: date }
      { borrow-bps: (get borrow-bps row), supply-bps: (get supply-bps row),
        depth-usd: (get depth-usd row), published-at: stacks-block-height })
    (print { event: "published", key: (get key row), date: date,
             borrow-bps: (get borrow-bps row), supply-bps: (get supply-bps row), depth-usd: (get depth-usd row) })
    date))

;; Post one fixing date's rates for one or more keys, such as "SBOR-USD".
(define-public (publish (date uint)
    (rows (list 8 { key: (string-ascii 32), borrow-bps: uint, supply-bps: uint, depth-usd: uint })))
  (begin
    (asserts! (is-eq contract-caller (var-get publisher)) ERR-NOT-PUBLISHER)
    (asserts! (and (>= date u20260101) (<= date u21001231)) ERR-BAD-DATE)
    (asserts! (> (len rows) u0) ERR-EMPTY)
    (asserts! (get ok (fold not-older rows { date: date, ok: true })) ERR-OLDER-THAN-LATEST)
    (fold write-row rows date)
    (ok true)))

;; Replace the publisher, for example if its key is exposed.
(define-public (set-publisher (next principal))
  (begin
    (asserts! (is-eq contract-caller (var-get owner)) ERR-NOT-OWNER)
    (print { event: "publisher-changed", previous: (var-get publisher), next: next })
    (var-set publisher next)
    (ok true)))

(define-public (transfer-ownership (next principal))
  (begin
    (asserts! (is-eq contract-caller (var-get owner)) ERR-NOT-OWNER)
    (print { event: "ownership-transferred", previous: (var-get owner), next: next })
    (var-set owner next)
    (ok true)))
