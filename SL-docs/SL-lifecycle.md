# SL lifecycle

```text
raw -> distilled -> promotion-candidate
  \         \               \
   -> stale -> quarantined -> deleted

generated -> probation -> active -> stale -> quarantined -> deleted
                    ^          \---------/
                    | verified reuse or undo requires reactivation
                    \-> superseded
```

Retrieval and successful reuse are separate events. Promotion is always a
reviewed semantic decision. Forgetting is a deterministic retention decision
applied only after ownership and dependency validation.

Usage is projected from immutable per-application events. A `verified` success
implies retrieval and application for counting purposes. Partial, unknown, and
unverified applications count as unknown and are excluded from the verified
success-rate denominator.

Positive reuse votes drive evidence maturity:

- First verified reuse: remain `raw`.
- Second verified reuse: become `distilled`.
- Third verified reuse: become `promotion-candidate`.

Maturity is recomputed from immutable verified-success events for the current
semantic artifact version. Independent branch events combine deterministically;
run `sl-repo project` after a merge when the generated registry projection or
index needs reconciliation. Content changes segment prior results and can
demote the revised lesson until the new version is verified.

Copilot then decides whether the candidate is best expressed as a focused
instruction or a reusable multi-step skill. The authored file is `generated`
until registration. Registration validates its structure and contract, moves
it out of `.github/instructions` or `.github/skills` into the SL probation
area, and records status `probation`. Probation artifacts remain visible in
the registry for audit but are excluded from the active discovery index.

Activation is a separate governed operation. It requires a valid contract,
valid evidence provenance, passing static scenarios, no declared conflicts
with active guidance, passing configured executable checks, and an explicit
opaque repository-review reference. The registry stores the gate results,
semantic artifact SHA-256 version, contract hash, evaluation timestamp, and
approval reference. Activation fails closed. If artifact or contract content
changes after evaluation, the evaluation is invalid and must be repeated.
Immediately before a real activation, SL acquires the shared repository
mutation lock and re-evaluates the current contract, evidence provenance,
scenarios, active-contract conflicts, executable checks, approval binding,
and content/version hashes. Changed inputs leave the artifact in probation. A
dry-run evaluation can feed a same-process dry-run activation entirely in
memory, without persisting evaluation or activation state.

Active guidance can then use the same `use start` / `use finish` lifecycle.
Verified successes update projected retrieval and successful-use timestamps
and act as the current-version freshness signal. If promoted guidance has
already become stale or quarantined, a later verified success moves its file
back to non-discoverable probation instead of restoring active status. The
prior evaluation and approval are discarded, so activation must pass the
current provenance, conflict, executable, approval, and content gates again.
Probationary guidance cannot be selected and remains excluded from normal
discovery.

`forget --undo` follows the same fail-closed rule for promoted instructions
and skills: it restores them to probation, never directly to `active` or the
legacy `promoted` status. Evidence lessons retain their previous safe status
restore behavior. Missing or inactive source evidence and guidance that became
active while the artifact was stale or quarantined are evaluated as current
activation blockers.

Skills can explicitly create their own receipts. Instructions have no
automatic execution hook, so an agent or host must create and finish a receipt
when it actually applies instruction content. The resulting success/failure
association is operational evidence, not causal proof that the guidance
improved or harmed the task.

Repositories created before probation used status `promoted`. That legacy
status remains a compatibility alias for active guidance, so existing
artifacts stay discoverable. Repository validation emits a migration warning
when a legacy promoted artifact has no validation contract. To adopt governed
activation evidence, regenerate or update its contract, register a new
probationary version, evaluate it, and activate it through repository review.
