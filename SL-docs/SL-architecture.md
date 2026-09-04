# SL Repo architecture

SL Repo separates reasoning from deterministic enforcement.

| Layer | Responsibility |
|---|---|
| Copilot skills | Decide whether a verified experience is worth capturing and how to express it |
| CLI | Install, validate, index, register, quarantine, restore, and delete deterministically |
| Repository files | Preserve evidence and promoted knowledge in Git |
| GitHub Actions | Re-run deterministic checks and scheduled retention |

Per-scope registry shards are the authority for ownership and governed
lifecycle state. The root state catalog contains only scope descriptors and
shard paths.
Immutable per-event files are the authority for retrieval and verified usage.
Registry timestamps and maturity are rebuildable caches; mutable legacy
counters are never incremented. Usage metrics live in separate per-scope
projection shards. The Markdown artifact preserves human-readable evidence.
Each generated scope index contains discovery paths and metadata, not metrics.
See [SL monorepo state layout](SL-state-layout.md).

Hierarchical monorepo scope resolution is a separate deterministic control
plane. A versioned scope catalog maps normalized repository paths to one
primary scope, followed by dependencies and ancestors. Existing installations
without a catalog use a single built-in root scope. See
[SL hierarchical monorepo scopes](SL-scopes.md).

Every operation that changes registry, discovery-index, or managed frontmatter
state uses one repository-scoped mutation lock. Scope-local writes update only
their deterministic shard; the lock carries
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
