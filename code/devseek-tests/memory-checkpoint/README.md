# Memory And Checkpoint

This local directory preserves I10 replay inputs and raw evidence for canonical
memory authority and interruption recovery. The versioned scenario source is
`scripts/test/fixtures/user-simulations/i10-memory-checkpoint.json`; local
`scenario.json` and `runs/` content remain untracked. Linked automated tests execute
the product boundaries, while `runs/` contains their unedited TAP output and summary
receipts.

The five permanent coding fixtures are intentionally absent. They run separately as
the regression baseline and cannot count as I10 evidence.
