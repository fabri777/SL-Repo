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
verification horizon; retrieval alone does not. Before deletion, SL checks
ownership, pinning, active references, source evidence, registry consistency,
and the quarantine grace period.

Instruction telemetry extends retention only when an agent or host emitted a
receipt. Absence of receipts means unknown usage, not proof that the
instruction was unused. Likewise, an associated verified success is a
revalidation signal, not proof of causal improvement.

Lifecycle transitions are written as separate immutable files under
`.github/SL-learning/SL-lifecycle-events/`. Legacy `SL-events.jsonl` files are
validated as read-only compatibility data and are never appended to. Deleted
content remains recoverable from Git history.

The installed retention workflow schedules read-only previews only. A
maintainer can manually request an apply run, but the pinned external runtime
still executes without repository write credentials. It produces a binary
patch artifact that a separate trusted job applies before opening an
unmerged, review-required pull request.
