# Installing SL Repo

## Prerequisites

- Git
- Node.js 20 or newer
- PowerShell 7 or newer for the installed repository-local runtime
- A Git repository to receive the SL layer

No CI provider is required. Node is currently required to build, initialize,
or update SL. After initialization, the complete operational lifecycle runs
through repository-local PowerShell without Node, npm, npx, a global SL CLI,
network access, or external PowerShell modules.

SL Repo 0.4.0 supports both single repositories and hierarchical monorepos.
It installs a complete repository-local PowerShell 7 runtime, including
resource receipt and advisory efficiency operations. Existing 0.2 root state
is migrated additively into deterministic scope shards, and 0.3 runtime
installations can be updated through the guarded manifest transaction.
Bundled and promoted skill directory and frontmatter names are lowercase for
Agent Skills compatibility.

## From a local development clone

```powershell
Set-Location C:\dev\SL-Repo
npm install
npm run build
npm link
sl-repo init C:\path\to\target --dry-run
sl-repo init C:\path\to\target
sl-repo validate C:\path\to\target
```

Initialization installs the runtime at
`.github/SL-learning/SL-runtime/`. Run it directly:

```powershell
pwsh -NoLogo -NoProfile -File `
  C:\path\to\target\.github\SL-learning\SL-runtime\SL.ps1 doctor --json
```

All lifecycle commands use the same entry point:

```powershell
$sl = "C:\path\to\target\.github\SL-learning\SL-runtime\SL.ps1"
pwsh -NoLogo -NoProfile -File $sl capture `
  --title "Verified local lesson" --trigger "local cue" --json
pwsh -NoLogo -NoProfile -File $sl retrieve --path src/example.ts --json
pwsh -NoLogo -NoProfile -File $sl use start SL-LESSON-ID --json
pwsh -NoLogo -NoProfile -File $sl project --json
pwsh -NoLogo -NoProfile -File $sl validate --json
```

From Bash:

```bash
./.github/SL-learning/SL-runtime/SL.sh conformance --json
```

The Bash file is a thin `pwsh` launcher and contains no Node or package-manager
fallback.

## Update

```powershell
sl-repo update C:\path\to\target --dry-run
sl-repo update C:\path\to\target
```

Update replaces only registered system templates and the SL-managed
instruction blocks in `AGENTS.md` and
`.github/copilot-instructions.md`. It also refreshes registered schema copies
under `.github/SL-learning/SL-schemas/`. Produced lessons, instructions,
skills, manual catalogs, unknown files, and unregistered same-path files are
retained.

Runtime updates use a stricter manifest guard. Before changing any runtime
file, update verifies the installed manifest, version, and every declared
SHA-256. Local runtime modifications, missing files, mixed-version files, or
an occupied newly managed path reject the whole update. Obsolete files are
removed only when the previous manifest proves SL ownership. Unrelated files
below `SL-runtime/` are preserved, and `--dry-run` performs no writes.

## Uninstall

The first milestone intentionally does not provide destructive uninstall.
Remove system templates only after `sl-repo doctor` identifies them. Produced
knowledge remains ordinary Git content.

## Install from an immutable Git source

Configure normal Git authentication for the authorized source, then run an
immutable package reference. The current GitHub source example is:

```powershell
npm exec --yes --package=github:fabri777/SL-Repo#3c6bb31d1f717595791e9a575d698b5593cbcf10 -c "sl-repo init C:\path\to\target"
```

An Azure Repos mirror can be cloned and checked out at the same full commit
before `npm ci`, `npm run build`, and `npm link`. A direct npm Git URL can
also be used when the local Git credential configuration already authorizes
it:

```powershell
npm exec --yes --package="git+https://dev.azure.com/<organization>/<project>/_git/<runtime-repository>#3c6bb31d1f717595791e9a575d698b5593cbcf10" -c "sl-repo --help"
```

Do not place credentials in the URL, repository files, or SL state. The Git
host supplies authentication through its normal credential manager, Azure
Repos permissions, or service-connection configuration.

## Local and agent invocation

Local and agent-driven operation is complete without a pipeline:

```powershell
sl-repo retrieve C:\path\to\target --path src/example.ts
sl-repo project C:\path\to\target
sl-repo validate C:\path\to\target
sl-repo sweep C:\path\to\target --dry-run
```

The SL managed block in `AGENTS.md` tells repository agents when to inspect
the index and capture verified lessons. The
`.github/copilot-instructions.md` mirror supports GitHub Copilot discovery but
is not a GitHub hosting dependency.

## Optional automation adapters

Installation includes two adapters:

- GitHub Actions workflows under `.github/workflows/`.
- Azure Pipelines job templates under
  `.azure-pipelines/SL-learning/`.

The adapters acquire reviewed source snapshot
`3c6bb31d1f717595791e9a575d698b5593cbcf10`, build it, and invoke the CLI. The
full commit SHA is immutable; adapters must never use `main`, another branch,
or a moving tag for runtime acquisition.

The GitHub adapter uses a repository secret named `SL_REPO_TOKEN` when the
private GitHub source requires it. The Azure Pipelines adapter embeds no
credential and instead uses a repository resource authorized by normal Azure
Repos permissions or a configured service connection. See
[Optional Azure Pipelines adapter](SL-azure-pipelines.md).

In the GitHub adapter, both the consumer checkout and runtime checkout set
`persist-credentials: false`. Validation runs with `contents: read`.
Forgetting also runs the downloaded runtime in a read-only planning job. On a
manual apply request, that job uploads a Git binary patch. A separate job,
which never downloads or executes SL Repo source, receives narrowly scoped
repository write permission, checks and applies the patch, and opens a pull
request for review. Scheduled forgetting is preview-only, and retention pull
requests are not automatically merged.

The Azure Pipelines retention adapter also leaves checkout credentials
unpersisted. Its scheduled/default mode is preview-only. A manual
`applySweep: true` run mutates only the disposable pipeline workspace and
publishes a binary patch artifact for human review; it never pushes, creates
or merges a pull request, or bypasses branch protections.

Without automation, SL capture and retrieval still work. What is lost is the
automated merge gate, scheduled projection/retention execution, and hosted
cross-platform release validation.

Every external action in the write-scoped job is pinned to a reviewed full
40-character commit SHA. The trailing `owner/action vX.Y.Z` comment records
the upstream release represented by the pin. Pin updates must resolve the
official major-version tag with GitHub or Git metadata, review the resolved
commit, and update the source and consumer workflows together.

To update the runtime pin, maintainers must:

1. Review a specific SL Repo commit and verify its provenance.
2. At that commit, run `npm ci`, `npm run ci`, and `npm run validate:self`.
3. Run `node dist/SL-src/SL-cli/SL-cli.js --help` and verify the `validate`
   and `sweep` commands are present.
4. Replace the full SHA in both GitHub workflow templates, both Azure
   Pipelines templates, the source installation examples, and the matching
   security-test expectations.
5. Run `npm run ci` again and review every adapter diff before
   distributing an update.

Packed artifact contents include `dist/`, `SL-schemas/`, `SL-templates/`,
`SL-plugin/`, `SL-tests/`, `SL-docs/`, `CHANGELOG.md`, `README.md`, and
`SECURITY.md`. This keeps the runtime, validation schemas, reusable
fixtures/tests, secured consumer templates, plugin skills, release history,
and linked documentation together.

`npm run build:runtime` stages the deterministic template manifest. It uses
the source release placeholder `__SL_SOURCE_RELEASE_COMMIT__`, copies the
manifest schema into the template, and records LF-normalized hashes for every
runtime payload. See
[Repository-local PowerShell runtime contract](SL-runtime.md) for the exact
layout, supported YAML/frontmatter/validation/glob subsets, and exit codes.

Version releases use two reviewed commits. The first commit updates versions,
release notes, tests, generated runtime payloads, and the manifest hashes while
leaving `sourceReleaseCommit` as `__SL_SOURCE_RELEASE_COMMIT__` and retaining
the previous reviewed adapter pin. After that commit is reviewed, the
follow-up immutable-pin commit replaces the placeholder and every documented,
template, and test pin with the first commit's full 40-character SHA, rebuilds
the runtime manifest, and reruns the complete release validation.

After installation or update, run:

```powershell
sl-repo project C:\path\to\target
sl-repo validate C:\path\to\target
```

`project` imports legacy mutable counters once, rebuilds immutable usage
projections, and refreshes the discovery index.

For a 0.2 repository, follow
[Migration from 0.2 to 0.3](SL-migration-0.2.md). Update is additive: legacy
registry, index, counter, and unscoped event inputs remain readable and are
not deleted.
