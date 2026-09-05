# Self Learning Repository

SL Repo gives a Git repository a reviewable learning lifecycle for coding
agents:

```text
experience -> lesson -> verified reuse -> instruction or skill
                   \-> stale -> quarantine -> deletion
```

## Release 0.3.0

Version 0.3.0 adds production monorepo support: hierarchical scope catalogs,
scope-sharded registries/indexes/usage projections, governed scope-aware
promotion, cross-scope usage freshness, deterministic ordinal serialization,
and exact restore rollback across generated state shards. Legacy 0.2 root
state remains a read-only compatibility input.

## Core and optional adapters

SL is Git-host agnostic. Its functional core is the Node CLI, repository-native
state committed to Git, immutable Git distribution of the reviewed runtime,
and the SL managed block in `AGENTS.md`. The installer also maintains the
equivalent `.github/copilot-instructions.md` block for GitHub Copilot
repository discovery.

No CI service is required. Agents and maintainers can invoke `sl-repo`
locally for capture, retrieval, projection, validation, promotion, and guarded
forgetting. GitHub Actions and Azure Pipelines are optional automation
adapters. Without either adapter, knowledge capture and retrieval continue;
the repository gives up an automated merge gate, scheduled projection or
retention runs, and hosted cross-platform validation.

Azure Repos works because SL state is ordinary repository content and every
core operation uses Git paths rather than a hosting-provider API.

## Why Self Learning for Copilot Repositories

Self Learning for Copilot Repositories reduces the time and token cost of
solving the same hard problem twice. When Copilot completes a difficult
task—one that required substantial reasoning, experimentation, or human
guidance—SL captures the verified approach as a repository lesson.

A pull request can therefore include both **WHAT** changed—the code—and
**HOW** the result was achieved—the lesson. In a later task or pull request,
another agent can retrieve that lesson, apply it, and cast a positive reuse
vote when it helps.

Repeatedly useful lessons automatically become promotion candidates. Copilot
can then turn the strongest candidates into focused repository instructions
or reusable skills when appropriate. Registration places generated guidance
in non-active probation. Contract, provenance, scenario, conflict, executable,
and explicit repository-review gates must pass before activation makes it
discoverable. Promotion and forgetting remain governed, reviewable, and
stored in Git.

Raw and distilled lessons are retrievable before promotion. Promotion does not
make knowledge readable for the first time; it increases reliable automatic
delivery by converting proven evidence into an activated instruction or skill.
Vote thresholds create candidates only. Shared or root activation is never
automatic: it requires verified evidence from distinct non-root scopes,
current policy/content hashes, conflict checks, and target-owner approval.

This repository implements the first project milestone:

- **SL Repo**: repository-local learning, discovery, promotion, validation,
  installation, and forgetting.
- **SL Org**: future reviewed sharing across repositories.
- **SL Company**: future enterprise federation and governance.

## Development

```powershell
git clone <authorized-SL-source> C:\dev\SL-Repo
Set-Location C:\dev\SL-Repo
npm ci
npm run ci
npm link
sl-repo --help
```

The source repository is private. Configure normal Git authentication for the
authorized source before cloning or installing it.

This source repository keeps its GitHub-hosted three-platform CI as a
release-quality check. That source-release gate does not make GitHub Actions a
consumer prerequisite.

```powershell
Set-Location C:\dev\SL-Repo
npm install
npm run ci
npm link
```

An authenticated Git installation can also invoke the package directly:

```powershell
npm exec --yes --package=github:fabri777/SL-Repo#3c6bb31d1f717595791e9a575d698b5593cbcf10 -c "sl-repo --help"
```

## Install into a repository

Preview the installation:

```powershell
sl-repo init C:\path\to\repository --dry-run
```

Apply and validate it:

```powershell
sl-repo init C:\path\to\repository
sl-repo doctor C:\path\to\repository
sl-repo validate C:\path\to\repository
```

`init` installs the root scope catalog, configuration, skills, optional
GitHub Actions and Azure Pipelines adapters, and local copies of every SL
scope/state/event schema under `.github/SL-learning/SL-schemas/`. It merges
the SL entry block into `AGENTS.md` and preserves existing content. Runtime
validation still uses the immutable schemas bundled with the reviewed SL
package; installed copies support review, editors, and repository-local
auditing. `update` replaces only files already registered as SL-managed
system artifacts and the delimited agent instruction blocks.

It also installs the self-contained PowerShell 7 runtime under
`.github/SL-learning/SL-runtime/`. After initialization, agents can invoke
scope resolution, capture, retrieval, usage, projection, promotion,
validation, retention, doctor, and conformance commands without
Node/npm/global SL CLI. See [the runtime contract](SL-docs/SL-runtime.md).

```powershell
$sl = ".github/SL-learning/SL-runtime/SL.ps1"
pwsh -NoLogo -NoProfile -File $sl scope resolve --file src/example.ts --json
pwsh -NoLogo -NoProfile -File $sl retrieve --path src/example.ts --json
pwsh -NoLogo -NoProfile -File $sl project --json
pwsh -NoLogo -NoProfile -File $sl validate --json
```

Both optional automation adapters use the reviewed immutable SL Repo commit.
They never intentionally execute mutable `main` as the runtime. See
`SL-docs/SL-install.md` for the pin-update procedure,
`SL-docs/SL-azure-pipelines.md` for Azure Repos and GitHub repository-resource
examples, and `SL-docs/SL-security.md` for credential boundaries.

After a lesson is retrieved and applied:

```powershell
sl-repo scope resolve C:\path\to\repository --file services\orders\src\handler.ts
sl-repo retrieve C:\path\to\repository --path services/orders/src/handler.ts
sl-repo use start SL-LESSON-ID C:\path\to\repository `
  --target-path services/orders/src/handler.ts `
  --task-run-id TASK-123 `
  --application-id APPLY-123
sl-repo use finish APPLY-123 C:\path\to\repository `
  --outcome success `
  --verified `
  --verifier-type test-suite `
  --evidence-ref ci:run-123
sl-repo stats SL-LESSON-ID C:\path\to\repository --scope SL-SCOPE-ORDERS
sl-repo stats C:\path\to\repository --aggregate repository
sl-repo resource import .\SL-resource-input.json C:\path\to\repository
sl-repo resource stats SL-LESSON-ID C:\path\to\repository --json
sl-repo project C:\path\to\repository
```

Capture can be explicit or path-inferred:

```powershell
sl-repo capture C:\path\to\repository --title "Orders retry policy" `
  --scope SL-SCOPE-ORDERS --lesson-scope orders --trigger "retry policy"
sl-repo capture C:\path\to\repository --title "Shared result handling" `
  --target-path packages/shared/common/src/result.ts --trigger "result type"
```

`use start` returns an application ID and receipt ID. Generated IDs are safe
for interactive use; automation should supply stable application, task, and
idempotency IDs. `use finish` records an unverified outcome by default.
Verified outcomes require both `--verified` and an explicit trustworthy
`--verifier-type`. Instruction usage is not automatically observable: the
agent or host that applied it must create and finish the receipt. A success
associated with an artifact is evidence of a useful application, not proof
that the artifact causally improved the result.

Resource receipts are immutable and provider-neutral. They can record
generation or application resources, explicit paired baselines, and optional
host-reported monetary cost. Efficiency reporting is advisory and remains
segmented by scope, artifact version, provider, model, and measurement quality.

`use start --dry-run` and `use finish --dry-run` print complete planned events
and projection file changes as JSON while remaining side-effect free.

The compatibility vote command records a verified lesson outcome directly:

```powershell
sl-repo vote SL-LESSON-ID C:\path\to\repository --useful `
  --task-run-id TASK-123 `
  --application-id APPLY-123 `
  --idempotency-key TASK-123-APPLY-123
sl-repo usage SL-LESSON-ID C:\path\to\repository
```

Positive reuse votes raise a lesson from raw to distilled and then to a
promotion candidate. A vote is evidence for promotion, not permission to
generate broad guidance without reviewing its applicability.

Votes and usage receipts are stored as immutable files in deterministic
scope/artifact shards. Stable application and idempotency IDs make command
retries safe, while separate files keep concurrent branch changes
merge-friendly. Existing unscoped events and mutable counters are retained and
imported without data loss; new votes do not increment those counters.
See [SL usage events](SL-docs/SL-usage-events.md).
For monorepo scope shards and post-merge regeneration, see
[SL monorepo state layout](SL-docs/SL-state-layout.md).

Evaluate a promoted artifact statically by ID or registered path:

```powershell
sl-repo evaluate SL-PROMOTED-ID C:\path\to\repository --json
sl-repo promotion-evaluate SL-PROMOTED-ID C:\path\to\repository `
  --target-scope SL-SCOPE-ROOT `
  --approval-ref review:123
sl-repo promotion-activate SL-PROMOTED-ID C:\path\to\repository
```

In monorepo mode, local promotion defaults to the source scope. Promotion to a
shared/root scope is rebuilt from immutable verified-use evidence and requires
the configured number of distinct non-root scopes plus target-owner approval.
The registered artifact scope is immutable for evaluation and activation:
callers cannot evaluate narrower governance and leave broader persisted
guidance behind.
An explicit narrower-scope override must name the broader artifact, scope, and
declaration key and carry its own review reference. Peer conflicts and
undeclared contradictions fail closed. Retrieval also compares legacy active
contracts with governed active guidance and rejects contradictory overlaps.

Executable contract checks remain disabled unless explicitly requested with
`--execute-checks`; they are trusted commands from the reviewed repository,
not untrusted input. Failures and timeouts produce a nonzero exit code.
Process-tree cleanup is defense-in-depth for ordinary child processes, not an
adversarial operating-system sandbox or a containment guarantee against
deliberate escape.

SL only rewrites files it owns. Existing `AGENTS.md` and
`.github/copilot-instructions.md` content is preserved outside an identifiable
managed block. `AGENTS.md` is the provider-neutral agent entry point; the
Copilot-specific file is a compatibility mirror, not a hosting prerequisite.

## Scope-aware architecture

The hand-authored scope catalog and Markdown knowledge are intent. Immutable
usage/lifecycle events are evidence. Per-scope registries, indexes, state
catalog, and usage projections are deterministic generated state. After
merging branches that add event shards, always run:

```powershell
sl-repo project .
sl-repo validate .
```

Repository aggregation deliberately returns counts without a verified-success
percentage. Compare success rates only within a scope; combining services with
different workloads, verifiers, or sample sizes can produce a deceptive rate.

See the complete operational references:

- [Architecture and source-of-truth boundaries](SL-docs/SL-architecture.md)
- [Optional Azure Pipelines adapter](SL-docs/SL-azure-pipelines.md)
- [Resource receipts and advisory efficiency](SL-docs/SL-resource-efficiency.md)
- [Release history](CHANGELOG.md)
- [Scope catalog and precedence](SL-docs/SL-scopes.md)
- [Sharded state and merge workflow](SL-docs/SL-state-layout.md)
- [Monorepo operations and troubleshooting](SL-docs/SL-monorepo-operations.md)
- [0.2 migration and rollback](SL-docs/SL-migration-0.2.md)

## Automatic forgetting

SL never auto-deletes hand-authored files, system assets, pinned knowledge, or
artifacts with active dependents. Eligible SL-managed knowledge passes through
stale and quarantine states before deletion. Use `sl-repo sweep --dry-run` to
inspect every proposed transition. Fresh verified usage or `forget --undo`
returns stale or quarantined promoted guidance to non-discoverable probation,
not directly to active status; current activation gates and repository approval
must pass again.

See:

- `SL-docs/SL-install.md`
- `SL-docs/SL-architecture.md`
- `SL-docs/SL-lifecycle.md`
- `SL-docs/SL-forgetting.md`
- `SL-docs/SL-security.md`
- `SL-docs/SL-validation-contracts.md`
- `SL-docs/SL-usage-events.md`
- `SL-docs/SL-scopes.md`
- `SL-docs/SL-state-layout.md`
- `SL-docs/SL-monorepo-operations.md`
- `SL-docs/SL-migration-0.2.md`
- `SL-docs/SL-roadmap.md`
