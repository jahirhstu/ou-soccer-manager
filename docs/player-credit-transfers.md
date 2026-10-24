# Player Credit Transfers

Deploy `supabase/migrations/080_player_credit_transfers.sql` through the project's normal migration process before using this feature. It adds a function, not production transfers. No production migration or transfer is run automatically.

## Admin Workflow

1. Open Payments > Transfer player credit, or Record payment > Another player's credit.
2. Choose one season, the recipient, and a different funding player with available credit.
3. Enter the amount and date. Optionally select a session for context and add a note.
4. Review both before/after balances, confirm, and select Transfer credit.

Guests need a player record but no season registration. Inactive players are eligible. Funds cannot come from another season; carry them forward first. A transfer can settle debt, create prepaid credit, or do both. It does not allocate funds exclusively to the optional session.

## Accounting

The function creates equal `credit_transferred_out` and `credit_transferred_in` ledger entries, linked by transfer ID and reciprocal player IDs, plus one audit event. It preserves original receipts, attendance, charges, and statistics. There is no new cash payment, expense, refund, or bank transfer.

Example: A has $40 credit; B owes $13. Transferring $20 leaves A with $20 credit and B with $7 credit. Cash collected is unchanged. Total unused player credit falls from $40 to $27 because $13 settled an existing charge. The dashboard's net available balance rises by the same $13. Transfers between prepaid balances leave total unused credit unchanged.

Payments history and both player pages identify the counterparty. Payment Report/CSV already include credit-in/out totals. Payments also offers a player-transfer CSV with one row per transfer, both player IDs, optional session, amount, and note.

Transfers cannot be edited, deleted, or reversed through this UI. Mistakes require a reviewed, audited correction; do not delete or modify just one side of a pair.

## Validation

Run `scripts/production/verify_player_credit_transfers.sql` for read-only pair, balance, and audit verification. Local SQL tests cover stale credit after refunds/carry-forward, retry protection, isolation, and atomic rollback. PGlite uses one connection, so real multi-connection contention tests must also be run on a disposable PostgreSQL staging database before relying on load/concurrency guarantees. Refunds and carry-forward use the same player-row locks; opposite player transfers lock IDs in deterministic order.
