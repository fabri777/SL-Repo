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
or reusable skills when appropriate, making proven knowledge easier for
future agents to discover and follow. Promotion and forgetting remain
governed, reviewable, and stored in Git.

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
npm exec --yes --package=github:fabri777/SL-Repo -- sl-repo --help
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

After a lesson is retrieved and applied:

```powershell
sl-repo vote SL-LESSON-ID C:\path\to\repository --useful
```

Positive reuse votes raise a lesson from raw to distilled and then to a
promotion candidate. A vote is evidence for promotion, not permission to
generate broad guidance without reviewing its applicability.

SL only rewrites files it owns. Existing `AGENTS.md` and
`.github/copilot-instructions.md` content is preserved outside an identifiable
managed block.

## Automatic forgetting

SL never auto-deletes hand-authored files, system assets, pinned knowledge, or
artifacts with active dependents. Eligible SL-managed knowledge passes through
stale and quarantine states before deletion. Use `sl-repo sweep --dry-run` to
inspect every proposed transition.

See:

- `SL-docs/SL-install.md`
- `SL-docs/SL-architecture.md`
- `SL-docs/SL-forgetting.md`
- `SL-docs/SL-roadmap.md`
