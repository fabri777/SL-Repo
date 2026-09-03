# Installing SL Repo

## Prerequisites

- Git
- Node.js 20 or newer
- A Git repository to receive the SL layer

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

## Update

```powershell
sl-repo update C:\path\to\target --dry-run
sl-repo update C:\path\to\target
```

Update replaces only registered system templates and the SL-managed
instruction block. Produced lessons, instructions, and skills are retained.

## Uninstall

The first milestone intentionally does not provide destructive uninstall.
Remove system templates only after `sl-repo doctor` identifies them. Produced
knowledge remains ordinary Git content.

## Private GitHub repository installation

Authenticate GitHub as `fabri777`, then run:

```powershell
npm exec --yes --package=github:fabri777/SL-Repo#00610f1e8b9c857be0623cda4a89352240ae12cd -c "sl-repo init C:\path\to\target"
```

The generated workflows do not depend on an unpublished package. They check
out the reviewed source snapshot
`00610f1e8b9c857be0623cda4a89352240ae12cd` into `.SL-tool`, build it, and
invoke the built CLI. The full commit SHA is immutable; the workflows must
never use `main`, another branch, or a moving tag for runtime acquisition.
Because the source repository is private, configure a repository secret named
`SL_REPO_TOKEN` with read-only access to `fabri777/SL-Repo`.

Both the consumer checkout and runtime checkout set
`persist-credentials: false`. Validation runs with `contents: read`.
Forgetting also runs the downloaded runtime in a read-only planning job. On a
manual apply request, that job uploads a Git binary patch. A separate job,
which never downloads or executes SL Repo source, receives narrowly scoped
repository write permission, checks and applies the patch, and opens a pull
request for review. Scheduled forgetting is preview-only, and retention pull
requests are not automatically merged.

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
4. Replace the full SHA in both consumer workflow templates, the source
   installation examples, and the matching workflow-security test
   expectation.
5. Run `npm run ci` again and review the generated workflow diff before
   distributing an update.

Packed artifact contents include `dist/`, `SL-schemas/`, `SL-templates/`,
`SL-plugin/`, `SL-docs/`, `README.md`, and `SECURITY.md`. This keeps the
runtime, validation schemas, secured consumer templates, plugin skills, and
linked documentation together.

After installation or update, run:

```powershell
sl-repo project C:\path\to\target
sl-repo validate C:\path\to\target
```

`project` imports legacy mutable counters once, rebuilds immutable usage
projections, and refreshes the discovery index.
