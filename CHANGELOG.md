# Changelog

## 0.4.0 - 2026-09-06

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

### Changed

- Installed repositories can run the complete SL lifecycle without Node, npm,
  network access, or external PowerShell modules.
- Runtime installation and updates verify a deterministic manifest and every
  LF-normalized payload hash before loading executable PowerShell.
- Runtime and installer mutations are transactional, including rollback of
  partially staged schema, manifest, projection, and update changes.
- Monorepo scope-sharded state and governed cross-scope promotion remain
  supported by the self-contained runtime.

### Fixed

- Preserve valid empty usage and resource projection arrays across
  PowerShell projection and validation.
- Reject malformed resource inputs and locally modified, incomplete, or
  mixed-version runtime payloads without partially updating the repository.
- Reclaim stale mutation locks while preserving live-owner and unknown-owner
  safety checks.
- Install and promote bundled skills with lowercase directory and frontmatter
  names for Agent Skills compatibility.

### Compatibility

- 0.3 monorepo state, installed runtime manifests, and optional automation
  adapters remain supported update inputs.
- The runtime manifest and immutable source examples are pinned to reviewed
  0.4.0 version commit `51ab00795f8109bb3fad7c717bf9f427fec63772`.

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
