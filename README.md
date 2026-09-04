# Self Learning Repository

SL Repo gives a Git repository a reviewable learning lifecycle for GitHub
Copilot agents:

```text
experience -> lesson -> verified reuse -> instruction or skill
                   \-> stale -> quarantine -> deletion
```

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

This repository implements the first project milestone:

- **SL Repo**: repository-local learning, discovery, promotion, validation,
  installation, and forgetting.
- **SL Org**: future reviewed sharing across repositories.
- **SL Company**: future enterprise federation and governance.

## Development

```powershell
gh repo clone fabri777/SL-Repo C:\dev\SL-Repo
Set-Location C:\dev\SL-Repo
npm ci
npm run ci
npm link
sl-repo --help
```

The repository is private. Authenticate Git access as `fabri777` before
cloning or installing it.

```powershell
Set-Location C:\dev\SL-Repo
npm install
npm run ci
npm link
```

An authenticated Git installation can also invoke the package directly:

```powershell
npm exec --yes --package=github:fabri777/SL-Repo#62f5e1db61fa738a68d0e163ad9b676572baab81 -c "sl-repo --help"
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

Installed validation and retention workflows use a reviewed immutable SL Repo
commit. They do not execute mutable `main` under repository write credentials;
see `SL-docs/SL-install.md` for the pin-update procedure and
`SL-docs/SL-security.md` for the credential boundary.

After a lesson is retrieved and applied:

```powershell
sl-repo use start SL-LESSON-ID C:\path\to\repository `
  --task-run-id TASK-123 `
  --application-id APPLY-123
sl-repo use finish APPLY-123 C:\path\to\repository `
  --outcome success `
  --verified `
  --verifier-type test-suite `
  --evidence-ref ci:run-123
sl-repo stats SL-LESSON-ID C:\path\to\repository
sl-repo project C:\path\to\repository
```

`use start` returns an application ID and receipt ID. Generated IDs are safe
for interactive use; automation should supply stable application, task, and
idempotency IDs. `use finish` records an unverified outcome by default.
Verified outcomes require both `--verified` and an explicit trustworthy
`--verifier-type`. Instruction usage is not automatically observable: the
agent or host that applied it must create and finish the receipt. A success
associated with an artifact is evidence of a useful application, not proof
that the artifact causally improved the result.

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

Votes are stored as immutable files under
`.github/SL-learning/SL-usage-events/`. Stable application and idempotency IDs
make command retries safe, while separate files keep concurrent branch changes
merge-friendly. Existing mutable counters are retained and imported once as an
immutable per-version baseline; new votes do not increment those counters.
See [SL usage events](SL-docs/SL-usage-events.md).

Evaluate a promoted artifact statically by ID or registered path:

```powershell
sl-repo evaluate SL-PROMOTED-ID C:\path\to\repository --json
sl-repo promotion-evaluate SL-PROMOTED-ID C:\path\to\repository `
  --approval-ref review:123
sl-repo promotion-activate SL-PROMOTED-ID C:\path\to\repository
```

Executable contract checks remain disabled unless explicitly requested with
`--execute-checks`; they are trusted commands from the reviewed repository,
not untrusted input. Failures and timeouts produce a nonzero exit code.
Process-tree cleanup is defense-in-depth for ordinary child processes, not an
adversarial operating-system sandbox or a containment guarantee against
deliberate escape.

SL only rewrites files it owns. Existing `AGENTS.md` and
`.github/copilot-instructions.md` content is preserved outside an identifiable
managed block.

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
- `SL-docs/SL-roadmap.md`
