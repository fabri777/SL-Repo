# SL monorepo state layout

SL Repo stores merge-sensitive derived state in deterministic scope shards:

```text
.github/SL-learning/
├── SL-state-catalog.json
├── SL-registry.json                 # legacy, read-only compatibility input
├── SL-index.json                    # legacy, no longer regenerated
├── SL-usage-events/                 # legacy unscoped immutable events
└── SL-scopes/
    └── SL-<safe-scope>-<hash>/
        ├── SL-registry.json
        ├── SL-index.json
        ├── SL-usage-projection.json
        └── SL-usage-events/
            └── SL-<artifact>-<hash>/YYYY-MM/SL-usage-<event>.json
```

`SL-state-catalog.json` contains only normalized scope descriptors and shard
paths. It does not contain artifact lists or usage metrics, so normal changes
inside an existing service do not rewrite the catalog or another service's
state. Scope and artifact shard names use normalized `/` paths, a
filesystem-safe slug, and a SHA-256 suffix. Generation sorts scopes,
artifacts, versions, and events and is independent of directory traversal
order.

The minimal integration descriptor is:

```ts
interface SLScopeDescriptor {
  id: string;
  path: string; // repository-relative, "." for the repository default
}
```

Pass it as `stateScope` to `slCaptureLesson`, or use
`sl-repo capture --state-scope services/orders --state-scope-id orders`.
Usage APIs derive the scope from the registered artifact. Reusable helpers are
exported from `SL-core/SL-state.ts`, `SL-core/SL-registry.ts`,
`SL-index/SL-index.ts`, and `SL-core/SL-usage.ts`.

## Compatibility and regeneration

Existing `.github/SL-learning/SL-registry.json`, legacy mutable counters, and
unscoped usage events remain readable. The first state mutation or
`sl-repo project` writes equivalent scope shards and an immutable legacy
counter baseline without deleting or rewriting the legacy files.

After Git merges independent branches, run:

```powershell
sl-repo project .
sl-repo validate .
```

Projection and index shards are derived and independently rebuildable.
Validation reports duplicate events across shards, scope/artifact mismatches,
unsafe or non-deterministic catalog paths, normalized shard collisions,
duplicate registry ownership, and stale index or usage projections.

Detailed usage metrics remain per artifact version and scope. Scope aggregate
views compute rates from that scope's counts. Repository aggregation returns
counts only and deliberately reports no cross-scope success percentage:

```powershell
sl-repo stats . --aggregate scope --json
sl-repo stats . --aggregate repository --json
```

SL Repo does not resolve hierarchical scope inheritance or promotion
governance in this foundation.
