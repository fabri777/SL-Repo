# Changelog

## 0.6.0 - 2026-09-08

### Added

- A deterministic compound JSON Schema document that preserves every source
  schema's canonical `$id` and cross-schema references.
- One cross-platform `sl.ps1` that installs itself as the persistent `sl`
  command and implements secure self-update and `initrepo`.
- An integrity-hashed system artifact manifest for the lowercase current
  layout and optional provider-adapter selection.
- `-Automation none|github|azure|all` selection for `sl initrepo`.

### Changed

- Establish a greenfield lowercase public contract with no installed-layout
  migration support.
- Reduce a clean destination installation to exactly 15 files.
- Generate the installed PowerShell implementation as one bundled module with
  embedded conformance vectors, reducing the runtime from 16 files to four.
- Install no GitHub Actions or Azure Pipelines adapters by default; omitted
  refresh selection preserves currently managed adapters.
- Create usage and resource projections only after corresponding immutable
  source records exist.
- Use an implicit root scope until a custom scope catalog is added.
- Publish source, release assets, package metadata, and schema identities from
  `fabri777/SL-Repo` under the `@fabri777/sl` package scope.

### Removed

- The bootstrap skill, eager empty projections, root compatibility
  registry/index files, and default scope catalog.
- Legacy layout readers, aliases, counter baselines, migration fixtures, and
  old installer entry points.

## 0.5.0 - 2026-09-07

### Added

- Portable Windows, Linux, and macOS bootstrap bundles that include the
  compiled initialization CLI, production dependencies, repository assets,
  and a private Node runtime.
- Native PowerShell and POSIX bootstrap scripts with authenticated release
  download, SHA-256 verification, manifest validation, and atomic user-local
  installation.
- A pinned multi-platform release workflow and Node-free initial installation
  integration coverage.
- Corporate source ownership under `ffishkel_microsoft/SL`, including the
  `@ffishkel_microsoft/sl` package identity and updated schema identifiers.

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
