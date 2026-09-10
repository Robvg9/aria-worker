# Failure Prevention Learning Contract v1

A failed episode is not promoted by itself. It may become reusable knowledge only when a separate prevention procedure is supplied and independently verified.

Required fields:
- `episode.learning_mode = "failure_prevention"`
- `episode.result.status = "failed"`
- `episode.prevention_procedure` is a non-empty step list
- verifier `passed = true`
- evidence references >= configured minimum

The resulting lesson category is `failure_prevention`, and its procedure is the prevention procedure rather than the failed procedure. Promotion creates a regression from the prevention procedure.
