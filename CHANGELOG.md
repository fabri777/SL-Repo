# Changelog

## 0.3.0 - 2026-09-04

### Added

- Hierarchical monorepo scope resolution and deterministic per-scope registry,
  index, usage-projection, and immutable usage-event shards.
- Scope-aware promotion governance with target-owner approval, shared-scope
  evidence distribution, and explicit narrower-scope overrides.

### Changed

- Promotion evaluation and activation now require the persisted artifact scope
  to exactly match the governed target scope.
- Current-version lifecycle freshness uses verified successes from every
  consuming scope while rates remain segmented by scope.
- Persisted ordering and canonical hashes use locale-independent ordinal
  UTF-16 code-unit ordering.
- Restore rollback snapshots every affected shard and the root state catalog
  byte-for-byte, including prior file absence.

### Fixed

- Reject duplicate artifact IDs within or across registry shards before
  mutation, while retaining identity-equivalent 0.2 legacy overlays.
- Fail retrieval closed when legacy and governed active validation contracts
  contain contradictory overlapping declarations.

### Compatibility

- 0.2 root registry, index, counters, and unscoped events remain read-only
  migration inputs.
- Consumer workflow runtime SHAs remain unchanged for this release commit and
  must be updated only in a later dedicated immutable-pin commit.
