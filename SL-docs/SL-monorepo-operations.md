# SL monorepo operations

## Daily flow

```powershell
sl-repo scope resolve . --current-directory $PWD --json
sl-repo capture . --title "Observed behavior" --target-path services/orders/src/order.ts
sl-repo retrieve . --path services/orders/src/order.ts --json
sl-repo use start SL-LESSON-ID . --target-path services/orders/src/order.ts `
  --application-id task-123-apply-1 --task-run-id task-123
sl-repo use finish task-123-apply-1 . --outcome success --verified `
  --verifier-type test-suite --evidence-ref ci:run-123
sl-repo stats SL-LESSON-ID . --scope SL-SCOPE-ORDERS --json
sl-repo project .
sl-repo validate .
```

These commands are the primary operating mode and work in any Git repository,
including Azure Repos. A pipeline is optional. The `AGENTS.md` managed block
is the agent entry point; state, evidence, and discovery indexes remain
repository-native.

Raw lessons can be retrieved and applied immediately while active. Promotion
is for reliable automatic delivery through instructions and skills. Local
promotion defaults to the source scope and requires local verified evidence.
Shared or root promotion additionally requires configured diversity across
distinct non-root application scopes and current target-owner approval. Vote
thresholds alone never activate shared guidance.

## Promotion and forgetting

```powershell
sl-repo promote SL-LESSON-ID .github/instructions/SL-RULE.instructions.md . `
  --target-scope SL-SCOPE-ORDERS
sl-repo promotion-evaluate SL-RULE . --target-scope SL-SCOPE-ORDERS `
  --approval-ref review:orders-owners --json
sl-repo promotion-activate SL-RULE .
sl-repo forget SL-RULE . --reason superseded --dry-run
sl-repo forget SL-RULE . --reason superseded
sl-repo forget SL-RULE . --undo
```

Undo or fresh verified use of stale or quarantined promoted guidance returns
it to probation, not active discovery. Re-evaluation and current owner
approval are required.

## Adding a scope

1. Choose a permanent `SL-SCOPE-*` ID and kind.
2. Add canonical `/` include and exclude patterns, one parent, dependencies,
   and CODEOWNERS-style aliases.
3. Test representative owned, excluded, root, Windows, and POSIX paths.
4. Run `scope validate`, `project`, and `validate`.

## Removing or renaming a scope

Scope IDs are persisted ownership identities. A rename is a migration:

1. Add the replacement scope without creating ambiguous overlap.
2. Move or recapture owned artifacts and emit future usage in the new scope.
3. Migrate immutable shard references in a reviewed compatibility change.
4. Rebuild and validate.
5. Remove the old catalog entry only after no registry, event, projection, or
   dependent references remain.

Never delete an orphaned shard merely because its catalog entry disappeared.

## Troubleshooting

| Symptom | Safe response |
|---|---|
| Ambiguous scope | Make one include more specific, add an exclusion, or use reviewed priority; do not guess |
| Dependency or parent cycle | Break the relationship; resolution and validation fail closed |
| Orphaned scope shard | Restore the catalog entry or migrate every artifact and event reference |
| Stale policy or content hash | Re-evaluate current policy and content and obtain fresh approval |
| Post-merge projection drift | Preserve all event shards, run `project`, then `validate` |
| Peer guidance conflict | Remove one declaration or redesign applicability; peers cannot override |
| Narrower conflict | Add complete audited override metadata and owner review |
| Missing usage | Treat as unknown; instructions need host or agent receipts |

## Security and retention

All knowledge, event metadata, approvals, and projections are committed to Git.
Use opaque non-PII references, keep branch protection authoritative, and
review retention pull requests. Mutation locking serializes local writers but
does not replace Git merge review. Path containment rejects repository escapes
and existing symlink or junction traversal. Executable checks remain explicit,
bounded, reviewed repository commands rather than a sandbox.

## Optional automation

Use the GitHub Actions adapter when the consumer is hosted on GitHub. Use the
Azure Pipelines templates in `.azure-pipelines/SL-learning/` when the
consumer uses Azure Repos or already standardizes on Azure Pipelines. Both
adapters execute the same CLI and immutable runtime.

Without automation, run `project` and `validate` before merge and schedule
retention reviews through normal team operations. Knowledge capture and
retrieval continue; only the automated merge gate, scheduled
projection/retention run, and hosted cross-platform validation are absent.
