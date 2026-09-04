# SL hierarchical monorepo scopes

SL Repo has one repository control plane and can divide a monorepo into
repository, shared, service, solution, library, and package scopes. The
versioned catalog is `.github/SL-learning/SL-scope-catalog.yml`. Equivalent
`.yaml` and `.json` files are supported, but exactly one catalog file may
exist.

Repositories without a catalog remain backward compatible. They resolve every
path to the built-in `SL-SCOPE-ROOT` repository scope.

## Catalog contract

Every scope has a stable `SL-SCOPE-*` ID, display name, kind, include and
exclude globs, dependency IDs, and CODEOWNERS-style aliases (`@user` or
`@organization/team`). Every non-root scope names a parent. The one parentless
root must be `repository` or `shared`, include `**`, and have no exclusions.

```yaml
schemaVersion: 1
scopes:
  - id: SL-SCOPE-ROOT
    displayName: Repository
    kind: repository
    includePaths: ["**"]
    excludePaths: []
    dependencyScopeIds: []
    ownerAliases: ["@example/platform"]
  - id: SL-SCOPE-ORDERS
    displayName: Orders service
    kind: service
    includePaths: ["services/orders/**"]
    excludePaths: ["services/orders/generated/**"]
    parentScopeId: SL-SCOPE-ROOT
    dependencyScopeIds: ["SL-SCOPE-SHARED"]
    ownerAliases: ["@example/orders"]
```

Persisted patterns use repository-relative `/` separators. Runtime paths may
use Windows or POSIX separators and may be relative or absolute under the
repository root. Drive-relative paths, `..` escapes, absolute paths outside
the root, negated globs, duplicate IDs, missing relationships, cycles, invalid
owners, and fully excluded scopes are rejected. Matching is case-sensitive on
every operating system so resolution does not change between CI platforms.

## Resolution

For each path, include globs are evaluated and exclude globs remove matches.
The primary scope is selected by:

1. greatest include-pattern specificity;
2. deepest parent hierarchy;
3. explicit integer `priority`, only as a tie-breaker.

If these are still equal, resolution fails with an ambiguity error. It never
guesses. The returned order is the primary scope, its dependency closure, then
ancestors, with the root last. A changed-path set preserves first occurrence
while deduplicating scope IDs.

Typed APIs are exported from `SL-src/SL-core/SL-scope.ts`, including
`slLoadScopeCatalog`, `slValidateScopeCatalog`, `SLScopeResolver`, and
`slResolveRepositoryScopes`. The CLI exposes the same behavior:

```powershell
sl-repo scope C:\repo --file services\orders\src\handler.ts --json
sl-repo scope C:\repo --changed-path services/orders/a.ts `
  --changed-path libraries/common/b.ts --json
```

The scope model intentionally does not shard indexes or usage storage and does
not define promotion policy.
