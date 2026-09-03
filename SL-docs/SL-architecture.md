# SL Repo architecture

SL Repo separates reasoning from deterministic enforcement.

| Layer | Responsibility |
|---|---|
| Copilot skills | Decide whether a verified experience is worth capturing and how to express it |
| CLI | Install, validate, index, register, quarantine, restore, and delete deterministically |
| Repository files | Preserve evidence and promoted knowledge in Git |
| GitHub Actions | Re-run deterministic checks and scheduled retention |

The registry is the authority for ownership and governed lifecycle state.
Immutable per-event files are the authority for retrieval and verified usage.
Registry timestamps, maturity, and `usageProjection` fields are rebuildable
caches; mutable legacy counters are never incremented. The Markdown artifact
preserves human-readable evidence. The generated index is a discovery
projection with current-version metrics, paths, and metadata rather than full
content.

Every operation that changes whole-registry, discovery-index, or managed
frontmatter state uses one repository-scoped mutation lock. The lock carries
owner process, host, timestamp, and random-token metadata, refreshes its lease,
waits for a bounded interval, and reclaims only demonstrably abandoned locks
through atomic rename-before-remove.

Generated guidance is moved into `.github/SL-learning/SL-probation/` before it
is registered, so normal Copilot discovery cannot load it. Activation moves a
passing artifact to its ecosystem path only after contract, provenance,
scenario, conflict, executable, approval, and content-version gates pass.
Stale or quarantined promoted guidance returns to that probation area after
fresh verified usage or undo. It is not indexed again until a new evaluation
and activation recheck current evidence and conflicts.

Usage telemetry is receipt-based rather than implicit. A skill can record its
own application, but instruction usage requires an agent or host integration
to call `use start` and `use finish`. SL records association and verification;
it does not claim that the selected artifact caused an observed improvement.

SL Repo defines future `org` and `company` scopes in documentation only. It
does not copy local lessons to a central service.
