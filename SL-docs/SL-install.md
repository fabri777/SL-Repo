# Installing SL

SL is distributed as one PowerShell file, `sl.ps1`. The same file installs the
persistent `sl` command and implements release acquisition, repository
initialization, refresh, diagnostics, projection, and validation.

## Prerequisites

- Git
- PowerShell 7 or newer
- A Git repository to initialize
- GitHub CLI authentication for online acquisition

Node.js is not required on consumer machines. Portable archives temporarily
carry the compiled implementation and a private Node runtime; `initrepo`
deletes the extracted package in `finally`.

## Install

Download `sl.ps1` from an exact reviewed release, inspect it, then run:

```powershell
pwsh .\sl.ps1 install
```

The command rejects symbolic links and reparse points, copies through a
temporary file, atomically replaces the installed command, and confirms the
user-local bin directory on `PATH`.

Installed location:

| Platform | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\sl\bin\sl.ps1` |
| Linux/macOS | `~/.local/bin/sl` |

The machine retains exactly one SL command file. No wrapper, private Node
runtime, daemon, or service remains installed.

## Initialize or refresh

Use the current directory:

```powershell
sl initrepo
```

Or provide a repository:

```powershell
sl initrepo C:\path\to\repository
```

The operation:

1. Resolves the repository and requires `.git`.
2. Rejects uppercase, unsupported, or ambiguous partial layouts.
3. Resolves an exact release and matching platform archive.
4. Verifies repository identity, release, commit, platform, architecture,
   filename, byte size, and SHA-256.
5. Extracts only safe contained archive paths into a unique temporary folder.
6. Runs the internal init or current-layout refresh as a dry run.
7. Displays the complete plan and requires `y` or `yes`.
8. Applies the operation and runs `doctor`, `project`, and `validate`.
9. Deletes the temporary package.

Non-interactive execution must include `-Yes`:

```powershell
sl initrepo . -Yes
```

## Offline assets

Supply a directory containing:

- `sl-release-manifest.json`
- `sl-checksums.txt`
- `sl-<version>-<platform>-<architecture>.tar.gz`

```powershell
sl initrepo . -AssetDirectory C:\reviewed\sl-assets
```

The same manifest, metadata, size, platform, architecture, commit, and checksum
verification applies offline.

## Automation selection

Fresh repositories default to no hosted automation:

```powershell
sl initrepo . -Automation none
sl initrepo . -Automation github
sl initrepo . -Automation azure
sl initrepo . -Automation all
```

On refresh, an omitted selection preserves the current managed adapters.
Explicit changes remove only unchanged SL-managed adapter files. Modified,
unregistered, linked, or ambiguously owned files block mutation.

GitHub Actions templates are installed under `.github/workflows/`. Azure
Pipelines templates are installed under `.azure-pipelines/sl-learning/`.
Neither provider is required for local operation.

## Fresh repository inventory

The inactive baseline is exactly 15 files:

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

The root scope is implicit. Usage and resource projections are created lazily
only when the corresponding immutable source records exist.

## Repository-local operation

The machine command delegates repository operations to:

```text
.github/sl-learning/sl-runtime/sl.ps1
```

Direct invocation is also supported:

```powershell
$sl = ".github/sl-learning/sl-runtime/sl.ps1"
pwsh -NoLogo -NoProfile -File $sl doctor --json
pwsh -NoLogo -NoProfile -File $sl project --json
pwsh -NoLogo -NoProfile -File $sl validate --json
```

The Bash launcher is a thin PowerShell entry point:

```bash
./.github/sl-learning/sl-runtime/sl.sh validate --json
```

## Self-update

```powershell
sl self-update
sl self-update -Release v0.6.0
```

Self-update verifies the replacement `sl.ps1` before atomically replacing the
installed command. Failed acquisition or verification leaves the current
command intact.

## Release assets

Each release publishes:

- `sl.ps1`
- `sl-release-manifest.json`
- `sl-checksums.txt`
- one `sl-<version>-<platform>-<architecture>.tar.gz` per supported platform

Portable archives contain internal launchers and `sl-release.json`; those are
temporary implementation details, not additional installed commands.

## Development source

Building this repository requires Node.js 20 or newer:

```powershell
npm ci
npm run build
npm run ci
npm run runtime:conformance
```

Consumer initialization does not require a system Node installation.
