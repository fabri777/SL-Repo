# SL forgetting

Default evidence retention:

- Mark unused raw or distilled evidence stale after 90 days.
- Quarantine it after 180 days without successful reuse.
- Delete it after 30 days in quarantine.
- Explicitly wrong knowledge is deactivated and quarantined immediately, then
  becomes eligible for deletion after 7 days.

Probationary and active promoted instructions and skills use a 365-day
verification horizon because automatic instruction usage is not reliably
observable. They still move through stale and quarantine before deletion;
probation is never a shortcut to deletion. A probationary dependency also
protects its source evidence from automatic or explicit forgetting.

Fresh verified usage after a promoted artifact becomes stale or quarantined
can reset its retention clock, but cannot reactivate it. SL moves the artifact
to the probation area, removes the prior passing evaluation and approval, and
keeps it out of the discovery index until a new evaluation and activation
succeed. Undo behaves the same way for promoted guidance. Evidence lessons
continue to restore their prior safe lifecycle status.

Before retention decisions, SL rebuilds current-version usage projections from
immutable events. Only verified success extends `lastSuccessfulUseAt` and the
verification horizon; retrieval alone does not. The freshness timestamp is the
maximum current-version verified success across all consuming scopes, while
success rates remain scope-local. Before deletion, SL checks ownership,
pinning, active references, source evidence, registry consistency, and the
quarantine grace period.

Forget, restore, sweep, and promotion transitions are transactional across
artifact files, scope registry shards, scope index/projection shards, the root
state catalog, and immutable lifecycle event append. A failed mutation
reinstates each prior file byte-for-byte or restores its prior absence.

These checks are repository-wide, not shard-local. A lesson in a library scope
cannot be forgotten while an active or probationary service/root artifact
depends on it. Removing or renaming a scope does not authorize deletion:
orphaned shards and artifact/event scope references are diagnostics that must
be migrated explicitly.

Instruction telemetry extends retention only when an agent or host emitted a
receipt. Absence of receipts means unknown usage, not proof that the
instruction was unused. Likewise, an associated verified success is a
revalidation signal, not proof of causal improvement.

Lifecycle transitions are written as separate immutable files under
`.github/sl-learning/sl-lifecycle-events/`. Deleted content remains
recoverable from Git history.

The optional GitHub retention workflow schedules read-only previews only. A
maintainer can manually request an apply run, but the checked-out,
manifest-verified repository runtime still executes without repository write
credentials. Every PowerShell invocation is checked immediately so a later
command cannot mask a failure. It produces a binary patch artifact that a
separate trusted job applies before opening an unmerged, review-required pull
request. This repository's own workflow uses the bundled template runtime with
an explicit repository root; installed consumer workflows use their committed
runtime at `.github/sl-learning/sl-runtime/sl.ps1`.

The optional Azure Pipelines adapter also defaults scheduled runs to preview.
A manual sweep mutates only the disposable pipeline workspace and publishes a
binary patch artifact. It does not push, open or merge a pull request, or
bypass branch protections. Without either adapter, maintainers can run
`sl sweep . --dry-run` locally; the retention policy and safety gates are
unchanged.
