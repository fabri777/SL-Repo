# SL hierarchical monorepo scopes

SL Repo has one repository control plane and can divide a monorepo into
repository, shared, service, solution, library, and package scopes. The
versioned catalog is `.github/sl-learning/sl-scope-catalog.yml`. Equivalent
`.yaml` and `.json` files are supported, but exactly one catalog file may
exist.

Repositories without a catalog resolve every path to the built-in
`SL-SCOPE-ROOT` repository scope.

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
  - id: SL-SCOPE-ORDERS-SOLUTION
    displayName: Orders solution
    kind: solution
    includePaths: ["services/orders/**"]
    excludePaths: ["services/orders/generated/**"]
    parentScopeId: SL-SCOPE-ROOT
    dependencyScopeIds: ["SL-SCOPE-COMMON-LIBRARY"]
    ownerAliases: ["@example/orders"]
  - id: SL-SCOPE-ORDERS
    displayName: Orders service
    kind: service
    includePaths: ["services/orders/src/**", "services/orders/tests/**"]
    excludePaths: ["services/orders/src/generated/**"]
    parentScopeId: SL-SCOPE-ORDERS-SOLUTION
    dependencyScopeIds: ["SL-SCOPE-COMMON-LIBRARY"]
    ownerAliases: ["@example/orders-api"]
  - id: SL-SCOPE-ORDERS-API
    displayName: Orders API package
    kind: package
    includePaths: ["services/orders/packages/api/**"]
    excludePaths: []
    parentScopeId: SL-SCOPE-ORDERS
    dependencyScopeIds: ["SL-SCOPE-COMMON-LIBRARY"]
    ownerAliases: ["@example/orders-api"]
  - id: SL-SCOPE-SHARED
    displayName: Shared platform
    kind: shared
    includePaths: ["shared/**", "packages/shared/**"]
    excludePaths: ["packages/shared/private/**"]
    parentScopeId: SL-SCOPE-ROOT
    dependencyScopeIds: []
    ownerAliases: ["@example/platform"]
  - id: SL-SCOPE-COMMON-LIBRARY
    displayName: Common library
    kind: library
    includePaths: ["packages/shared/common/**"]
    excludePaths: ["packages/shared/common/generated/**"]
    parentScopeId: SL-SCOPE-SHARED
    dependencyScopeIds: []
    ownerAliases: ["@example/common"]
  - id: SL-SCOPE-BILLING-SOLUTION
    displayName: Billing solution
    kind: solution
    includePaths: ["services/billing/**"]
    excludePaths: ["services/billing/generated/**"]
    parentScopeId: SL-SCOPE-ROOT
    dependencyScopeIds: ["SL-SCOPE-COMMON-LIBRARY"]
    ownerAliases: ["@example/billing"]
  - id: SL-SCOPE-BILLING
    displayName: Billing service
    kind: service
    includePaths: ["services/billing/src/**", "services/billing/tests/**"]
    excludePaths: ["services/billing/src/generated/**"]
    parentScopeId: SL-SCOPE-BILLING-SOLUTION
    dependencyScopeIds: ["SL-SCOPE-COMMON-LIBRARY"]
    ownerAliases: ["@example/billing-api"]
```

Solutions and services may intentionally overlap: the more specific/deeper
service owns normal source files, while its excludes fall back to the solution
or root. Both independently owned services can inherit the common library
without inheriting each other's local guidance.

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
sl scope list C:\repo
sl scope validate C:\repo
sl scope resolve C:\repo --file services\orders\src\handler.ts --json
sl scope resolve C:\repo --changed-path services/orders/a.ts `
  --changed-path libraries/common/b.ts --json
sl retrieve C:\repo --path services/orders/src/handler.ts --json
```

Capture and usage accept explicit `SL-SCOPE-*` IDs or infer from
`--target-path`. Retrieval walks local scope, declared dependencies, ancestors,
and root, reports provenance and precedence, and fails closed for unresolved
same-precedence guidance conflicts.

Within each selected scope, artifacts are ordered by stable ID. Inactive,
missing, system, stale-evaluation, and trigger-mismatched artifacts are
filtered. Local guidance wins by scope precedence, dependencies are inherited
before ancestors, and root is the final fallback. A narrower contradiction is
allowed only when its validation declaration records a reviewed explicit
override; peer conflicts cannot override one another.

For add/remove/rename procedures and orphan handling, see
[SL monorepo operations](SL-monorepo-operations.md).
