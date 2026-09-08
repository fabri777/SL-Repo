# SL scope-sharded state layout

SL stores merge-sensitive state in deterministic scope shards:

```text
.github/sl-learning/
├── sl-state-catalog.json
└── sl-scopes/
    └── sl-<safe-scope>-<hash>/
        ├── sl-registry.json
        ├── sl-index.json
        ├── sl-usage-projection.json
        ├── sl-resource-projection.json
        ├── sl-usage-events/
        │   └── sl-<artifact>-<hash>/YYYY-MM/sl-usage-<event>.json
        └── sl-resource-receipts/
            └── sl-<artifact>-<hash>/YYYY-MM/sl-resource-<receipt>.json
```

The projection files are lazy. A usage projection is absent until usage events
exist in that scope. A resource projection is absent until resource receipts
exist.

`sl-state-catalog.json` contains normalized scope descriptors and deterministic
shard paths. It does not contain artifact lists or metrics, so changes inside
one service do not rewrite another service's registry or index. Scope and
artifact shard names use normalized `/` paths, a filesystem-safe slug, and a
SHA-256 suffix.

The minimal descriptor is:

```ts
interface SLScopeDescriptor {
  id: string;
  path: string; // repository-relative, "." for the root scope
}
```

A repository without `sl-scope-catalog.yml` uses the implicit
`SL-SCOPE-ROOT` scope. Monorepos can add one catalog and use `sl capture
--scope <id>` or `--target-path` for inference. Usage may record a consuming
scope distinct from the artifact's owning scope, so rates remain partitioned
by application context.

## Regeneration

After Git combines immutable events or receipts from independent branches:

```powershell
sl project .
sl validate .
```

Registry projections, indexes, and usage/resource projection shards are
deterministically rebuildable. Validation reports duplicate identities,
scope mismatches, unsafe catalog paths, shard collisions, ownership conflicts,
and missing or stale required projections.

Detailed rates remain per artifact version and scope. Repository aggregation
returns counts only:

```powershell
sl stats . --aggregate scope --json
sl stats . --aggregate repository --json
```

## Merge workflow

1. Merge branch-added immutable event and receipt shards.
2. Reject duplicate IDs, idempotency keys, or conflicting terminal outcomes.
3. Run `sl project .` against the combined tree.
4. Review generated registry, index, and projection changes.
5. Run `sl validate .` before merge.

Generated projections must be rebuilt from the union of immutable sources;
choosing one side of a projection-file merge is not authoritative.
