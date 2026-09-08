# Contributing

1. Create a focused branch.
2. Add or update tests with behavior changes.
3. Run `npm run ci`.
4. Update schemas and fixtures together.
5. Keep generated and hand-authored content clearly separated.

Changes to retention or deletion gates require tests proving that manual,
pinned, system, and referenced artifacts remain protected.

Scope changes require:

1. Update exactly one hand-authored scope catalog.
2. Resolve representative Windows and POSIX paths before moving content.
3. Migrate artifact/event ownership before removing or renaming a scope ID.
4. Run `sl project .` and `sl validate .`.
5. Review orphan, ambiguity, dependency-cycle, and projection-drift findings.

Do not hand-edit generated state to repair a merge. Preserve immutable shards,
then regenerate projections and indexes from their union.
