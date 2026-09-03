# SL lifecycle

```text
raw -> distilled -> promotion-candidate -> promoted
  \         \               \              \
   -> stale -> quarantined -> deleted       -> superseded
```

Retrieval and successful reuse are separate events. Promotion is always a
reviewed semantic decision. Forgetting is a deterministic retention decision
applied only after ownership and dependency validation.

Positive reuse votes drive evidence maturity:

- First verified reuse: remain `raw`.
- Second verified reuse: become `distilled`.
- Third verified reuse: become `promotion-candidate`.

Copilot then decides whether the candidate is best expressed as a focused
instruction or a reusable multi-step skill.
