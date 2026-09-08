# Self Learning Repository

SL adds a reviewable, repository-local learning lifecycle for coding agents:

```text
experience -> lesson -> verified reuse -> instruction or skill
                   \-> stale -> quarantine -> guarded deletion
```

The current release is greenfield: it supports only the lowercase SL layout
described below. It does not migrate older or partial layouts.

## Install the `sl` command

Requirements:

- Git
- PowerShell 7 or newer
- GitHub CLI authentication for online release acquisition

Download the reviewed `sl.ps1` release asset, inspect it, and install it:

```powershell
Get-Content .\sl.ps1
pwsh .\sl.ps1 install
```

The installer persists one command file:

- Windows: `%LOCALAPPDATA%\sl\bin\sl.ps1`
- Linux and macOS: `~/.local/bin/sl`

It adds or confirms that directory on the user `PATH`. It installs no private
Node.js runtime, wrapper, daemon, or service.

## Initialize a repository

From the target repository:

```powershell
sl initrepo
```

Or provide a path:

```powershell
sl initrepo C:\path\to\repository
```

`initrepo` requires a Git repository, downloads and verifies the matching
portable implementation package, previews the complete operation, asks for
confirmation, initializes or refreshes the repository, runs `doctor`,
`project`, and `validate`, and removes the temporary package. Use `-Yes` for
non-interactive execution.

For offline initialization, place the reviewed release manifest, checksums,
and platform archive in one directory:

```powershell
sl initrepo C:\path\to\repository -AssetDirectory C:\reviewed\sl-assets
```

No hosted automation is installed by default. Opt in explicitly:

```powershell
sl initrepo . -Automation github
sl initrepo . -Automation azure
sl initrepo . -Automation all
```

On refresh, omitting `-Automation` preserves the current managed selection.

## Exact fresh layout

A new repository contains exactly these 15 SL files before lessons, events,
receipts, or projections exist:

```text
AGENTS.md
.github/copilot-instructions.md
.github/skills/sl-learning-audit/SKILL.md
.github/skills/sl-lesson-curator/SKILL.md
.github/sl-learning/.gitattributes
.github/sl-learning/sl-config.yml
.github/sl-learning/sl-schema-bundle.schema.json
.github/sl-learning/sl-state-catalog.json
.github/sl-learning/sl-system.manifest.json
.github/sl-learning/sl-runtime/sl-runtime.manifest.json
.github/sl-learning/sl-runtime/sl.ps1
.github/sl-learning/sl-runtime/sl.runtime.psm1
.github/sl-learning/sl-runtime/sl.sh
.github/sl-learning/sl-scopes/sl-sl-scope-root-47ab59b49ac7/sl-index.json
.github/sl-learning/sl-scopes/sl-sl-scope-root-47ab59b49ac7/sl-registry.json
```

The root scope is implicit, so no scope catalog is created initially.
`sl-usage-projection.json` appears only after usage events exist in that scope.
`sl-resource-projection.json` appears only after resource receipts exist.
Custom monorepo scopes can add `sl-scope-catalog.yml`.

An uppercase or ambiguous partial SL layout is rejected without mutation.

## Command surface

Machine command:

```text
sl install
sl self-update [-Release <tag>]
sl initrepo [repo-path] [-Automation none|github|azure|all] [-Yes]
sl doctor [repo-path]
sl project [repo-path]
sl validate [repo-path]
sl help
sl version
```

After initialization, `doctor`, `project`, and `validate` invoke the committed
repository-local runtime directly. The complete lifecycle is also available
through that runtime:

```powershell
$sl = ".github/sl-learning/sl-runtime/sl.ps1"

pwsh -NoLogo -NoProfile -File $sl retrieve --path src/example.ts --json
pwsh -NoLogo -NoProfile -File $sl capture `
  --title "Verified retry policy" `
  --trigger "retry policy" `
  --json
pwsh -NoLogo -NoProfile -File $sl use start SL-LESSON-ID --json
pwsh -NoLogo -NoProfile -File $sl project --json
pwsh -NoLogo -NoProfile -File $sl validate --json
pwsh -NoLogo -NoProfile -File $sl sweep --dry-run --json
```

The repository-local lifecycle requires PowerShell 7, but not Node.js, npm,
network access, or external PowerShell modules.

## How learning is shared

Lessons, immutable usage events, projections, promotion state, and managed
guidance are ordinary Git files. Work created on another machine or branch is
shared only after it is committed and merged through the repository's normal
review process.

Agents inspect the scope index, capture only verified reusable evidence, and
record usage receipts when they apply guidance. Repeated verified success can
make a lesson a promotion candidate. Activation and forgetting remain
governed; SL never deletes manual, system, pinned, or actively referenced
artifacts.

After merging branches that add immutable events or receipts, run:

```powershell
sl project .
sl validate .
```

## Optional automation

GitHub Actions and Azure Pipelines are optional adapters. They can provide
merge validation, scheduled projection checks, retention previews, and hosted
cross-platform release validation. Local capture, retrieval, projection,
validation, promotion, and guarded forgetting do not require either provider.

See:

- [Installation and release verification](SL-docs/SL-install.md)
- [Architecture and source-of-truth boundaries](SL-docs/SL-architecture.md)
- [Repository-local PowerShell runtime](SL-docs/SL-runtime.md)
- [Usage events and projections](SL-docs/SL-usage-events.md)
- [Scope-aware state](SL-docs/SL-state-layout.md)
- [Optional Azure Pipelines adapter](SL-docs/SL-azure-pipelines.md)
- [Security model](SL-docs/SL-security.md)
- [Forgetting lifecycle](SL-docs/SL-forgetting.md)

## Development

Node.js 20 or newer is required to build and test this source repository:

```powershell
git clone <authorized-SL-source> C:\dev\SL-Repo
Set-Location C:\dev\SL-Repo
npm ci
npm run ci
npm run runtime:conformance
```

Build generation keeps semantic decisions in skills and deterministic
enforcement in the TypeScript CLI. `npm run build:runtime` regenerates the
bundled PowerShell runtime, compound schema, system manifest, and runtime
manifest.
