# Migration from SL Repo 0.2 to 0.3

## Before updating

1. Commit or stash the repository and create a rollback branch or tag.
2. Preserve `.github/SL-learning/SL-registry.json`, `SL-index.json`,
   `SL-events.jsonl`, and `SL-usage-events/`.
3. Preview with `sl-repo update . --dry-run`.
4. If adopting monorepo scopes, author one catalog and validate it before
   assigning existing artifacts away from the root.

## Migration

```powershell
sl-repo update .
sl-repo project .
sl-repo validate .
sl-repo stats . --aggregate scope --json
```

`update` installs missing managed templates and schema copies. `project`
creates deterministic root-scope shards, imports legacy mutable counters once
as an immutable baseline, reads legacy unscoped events, and leaves legacy files
unchanged. Existing artifacts default to `SL-SCOPE-ROOT` until deliberately
moved to a declared scope.

During compatibility reads, a legacy record may overlay its shard successor
only when immutable artifact identity is equivalent. Duplicate IDs inside a
shard, across shards, or in conflicting legacy/shard records fail before any
state mutation.

## Compatibility and rollback

- 0.2 registry, index, and event inputs remain readable and are never appended
  to or deleted by migration.
- New commands write scope shards. Older 0.2 runtimes do not understand that
  generated state, so rollback means restoring the pre-update Git tree and
  runtime, not mixing writers.
- A failed dry run writes nothing. A failed real migration can be rolled back
  with Git because knowledge and events are repository files.
- Do not delete legacy inputs in this release. A later reviewed migration may
  retire them after compatibility is intentionally removed.

## Validation failures

- `scope-state-orphan`: restore the missing catalog entry or migrate its
  artifact and event shards before removal.
- `usage-event-duplicate-*`: preserve one immutable identity and investigate
  the conflicting branch; do not blend outcomes.
- `usage-projection-drift` or `index-drift`: run `sl-repo project .` after all
  branch shards are present.
- Stale promotion policy or content hashes: re-run promotion evaluation and
  owner approval; never edit stored hashes.
