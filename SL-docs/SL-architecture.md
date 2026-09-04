# SL Repo architecture

SL Repo separates reasoning from deterministic enforcement.

| Layer | Responsibility |
|---|---|
| Copilot skills | Decide whether a verified experience is worth capturing and how to express it |
| CLI | Install, validate, index, register, quarantine, restore, and delete deterministically |
| Repository files | Preserve evidence and promoted knowledge in Git |
| GitHub Actions | Re-run deterministic checks and scheduled retention |

## Source-of-truth boundaries

| Data | Authority | Derived or compatibility behavior |
|---|---|---|
| Scope ownership and relationships | Hand-authored `SL-scope-catalog.yml`, `.yaml`, or `.json` | Exactly one catalog; no catalog means the compatibility root scope |
| Lesson/guidance content | SL-managed Markdown plus validation contracts | Registry metadata cannot replace or silently rewrite content |
| Usage and lifecycle evidence | Immutable event shards | Mutable counters and legacy JSONL are read-only migration inputs |
| Lifecycle ownership | Per-scope registry shards | Root `SL-registry.json` is retained as 0.2 compatibility input |
| Retrieval discovery | Per-scope indexes | Rebuilt from active registry state; never a metrics authority |
| Usage metrics | Per-scope projections rebuilt from events | Repository aggregation exposes counts only, not a blended success rate |
| Shard routing | Generated `SL-state-catalog.json` | Contains descriptors and deterministic paths, not artifacts or metrics |
| Enforcement schemas | Schemas bundled with the reviewed runtime | Installed schema copies are review/editor aids and SL-managed templates |

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

Raw lessons remain eligible for explicit retrieval while active. Promotion
increases reliable automatic delivery through normal instruction/skill
discovery; it is not required to read or apply a lesson. Candidate thresholds
never bypass governance, especially for root/shared guidance.

Usage telemetry is receipt-based rather than implicit. A skill can record its
own application, but instruction usage requires an agent or host integration
to call `use start` and `use finish`. SL records association and verification;
it does not claim that the selected artifact caused an observed improvement.

SL Repo defines future `org` and `company` scopes in documentation only. It
does not copy local lessons to a central service.
