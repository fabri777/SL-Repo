# SL usage events

SL records retrieval, application, outcome, and verification as immutable JSON
files under the owning scope and artifact shard:
`.github/SL-learning/SL-scopes/<scope>/SL-usage-events/<artifact>/YYYY-MM/`.
Legacy unscoped files under `.github/SL-learning/SL-usage-events/YYYY-MM/`
remain readable. Each command or branch normally adds a distinct
`SL-usage-*.json` file instead of editing a shared counter or append-only log.

The version 1 schema is published as
`SL-schemas/SL-usage-event.schema.json`. Every event contains:

- an event ID and hashed idempotency key;
- artifact ID, semantic content version, and SHA-256 content hash;
- task/run and application correlation IDs;
- stage: `selected`, `applied`, `outcome`, or `verified`;
- outcome: `success`, `failure`, `partial`, or `unknown`;
- verifier type and canonical UTC timestamp;
- an optional opaque evidence reference that cannot contain source content,
  user paths, email addresses, IP addresses, or secrets.

## Projection

Use `sl-repo use start <artifact-id> [path]` before applying an artifact, then
finish by the returned receipt or application ID:

```powershell
sl-repo use finish <receipt-or-application-id> [path] `
  --outcome success `
  --verified `
  --verifier-type test-suite `
  --evidence-ref ci:run-123
```

Without `--verified`, the result is recorded as an unverified outcome.
`--verified` requires an explicit non-placeholder verifier type. Stable
`--application-id`, `--task-run-id`, and `--idempotency-key` values make
automation retries safe even when the retry receives a fresh timestamp.
Retries compare the canonical operation identity and reject changes to any
other immutable event field.

Add `--dry-run` to `use start` or `use finish` to return the complete planned
event objects plus every registry, index, and frontmatter projection change
without writing event or projection files.

Skills can emit receipts directly. Instructions cannot report their own use,
so the applying agent or host must emit the receipt. Missing receipts therefore
mean usage is unknown, not zero. A verified success/failure is associated with
the application and verifier evidence; it does not prove that the artifact
caused the outcome.

`sl-repo stats [artifact-id] [path]` and the compatibility
`sl-repo usage <artifact-id> [path]` deterministically group events by artifact
content version, scope, and application ID. `--aggregate scope` reports
scope-specific rates. `--aggregate repository` reports counts only and does
not manufacture a global success percentage from unlike service scopes.

- Retrieval counts unique applications with any stage.
- Application counts unique applications that reached `applied`, `outcome`, or
  `verified`.
- Resolved counts applications with a verified success or failure and is the
  success-rate denominator.
- Verified success and failure require a corresponding `verified` event.
- Partial, unknown, unverified, or conflicting verification counts as unknown.
- Verified success rate is `success / (success + failure)`; unknown outcomes
  are excluded from the denominator. It is `null` in JSON and `n/a` in text
  output when no verified success or failure exists.

Event IDs, idempotency keys, stage identities, and application IDs are
deduplicated. Conflicting terminal outcomes or application identity data are
rejected by usage operations and repository validation.

`sl-repo project [path]` rebuilds scope-registry timestamps, evidence maturity,
usage projection shards, and scope discovery indexes. Usage commands do
this automatically under the shared repository-scoped, stale-safe mutation
lock, also used by promotion and forgetting, so cross-operation writes cannot
overwrite a newer projection or lifecycle state. Finish operations reload
terminal history after acquiring that lock, preventing concurrent conflicting
outcomes for one application. The explicit command is useful after Git combines event files from independent
branches. Repository validation reports projection and index drift until the
deterministic rebuild is applied. Derived shard files are independently
rebuildable; after resolving a merge, run `sl-repo project .` followed by
`sl-repo validate .`.

For promoted instructions and skills, a verified success newer than a stale
or quarantine transition records freshness but does not restore discovery.
Projection moves the artifact back to `.github/SL-learning/SL-probation/`,
invalidates its prior evaluation and approval, and requires a new successful
activation. Current source evidence and active-contract conflicts are checked
again by that activation.

Paths in persisted events and projections always use repository-relative `/`
separators. Equivalent Windows-style CLI input is normalized before lookup, so
Windows and POSIX callers produce the same JSON evaluation output.

## Existing counters

On the first post-upgrade usage projection, existing `hits`, `retrievals`, and
`notUsefulVotes` are captured once in an immutable baseline for the artifact's
then-current semantic content version. A later content change starts a new
version with independent metrics and does not copy the baseline forward.
Existing fields remain unchanged for backward compatibility. New outcomes are
projected from event files and never increment mutable counters.
