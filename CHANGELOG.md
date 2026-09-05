# Changelog

## Unreleased

### Added

- Repository-local PowerShell resource receipt import, recording, baseline,
  projection, validation, and advisory efficiency reporting with promotion
  lineage.

## Unreleased

### Added

- Complete repository-local PowerShell 7 lifecycle runtime for scopes,
  retrieval, capture, immutable usage, projection, promotion, validation,
  forgetting, rollback, deterministic output, and stale-safe mutation locks.
- Shared TypeScript/PowerShell conformance vectors for lifecycle identifiers,
  scope shards, promotion ownership, retention, Unicode slugs, and safe
  evidence references.
- Provider-neutral resource import, artifact resource recording, paired
  baseline commands, segmented advisory efficiency metrics, and promotion
  lineage resource reporting.

## 0.3.0 - 2026-09-04

### Added

- Hierarchical monorepo scope resolution and deterministic per-scope registry,
  index, usage-projection, and immutable usage-event shards.
- Scope-aware promotion governance with target-owner approval, shared-scope
  evidence distribution, and explicit narrower-scope overrides.
- Optional Azure Pipelines validation and retention-patch templates under the
  SL-owned `.azure-pipelines/SL-learning/` folder.

### Changed

- Promotion evaluation and activation now require the persisted artifact scope
  to exactly match the governed target scope.
- Current-version lifecycle freshness uses verified successes from every
  consuming scope while rates remain segmented by scope.
- Persisted ordering and canonical hashes use locale-independent ordinal
  UTF-16 code-unit ordering.
- Restore rollback snapshots every affected shard and the root state catalog
  byte-for-byte, including prior file absence.
- `AGENTS.md` is now maintained as the provider-neutral agent entry point;
  GitHub Actions and Azure Pipelines are documented as optional adapters.

### Fixed

- Reject duplicate artifact IDs within or across registry shards before
  mutation, while retaining identity-equivalent 0.2 legacy overlays.
- Fail retrieval closed when legacy and governed active validation contracts
  contain contradictory overlapping declarations.

### Compatibility

- 0.2 root registry, index, counters, and unscoped events remain read-only
  migration inputs.
- Optional automation adapters acquire runtime commit
  `3c6bb31d1f717595791e9a575d698b5593cbcf10`; floating runtime refs remain
  prohibited.
