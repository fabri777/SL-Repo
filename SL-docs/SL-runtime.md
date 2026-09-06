# Repository-local PowerShell runtime contract

SL installs a self-contained PowerShell 7 runtime under
`.github/SL-learning/SL-runtime/`. The runtime never invokes Node,
npm, npx, or a globally installed `sl-repo` command. Node remains an
installer/build dependency until a later release provides a non-Node
bootstrap path.

The installed runtime owns the complete post-initialization operational
lifecycle: scope resolution, capture, retrieval, immutable usage, projection,
promotion governance, validation, forgetting, and diagnostics.

## Managed layout

| Path | Contract |
|---|---|
| `SL.ps1` | PowerShell 7 entry point, minimal integrity bootstrap, and version gate |
| `SL.sh` | Thin Bash launcher that only locates `pwsh` and invokes `SL.ps1` |
| `SL.Runtime.psm1` | Root module and structured command dispatcher |
| `SL.Runtime.Core.ps1` | Canonical JSON, SHA-256, path containment, and safe file I/O |
| `SL.Runtime.Syntax.ps1` | YAML/frontmatter parser, typed validator, and glob matcher |
| `SL.Runtime.State.ps1` | Scope resolution, sharded registry/state catalog, immutable lifecycle events, and indexes |
| `SL.Runtime.Artifacts.ps1` | Capture, ownership checks, immutable usage events, votes, receipts, and projections |
| `SL.Runtime.Promotion.ps1` | Validation contracts, probation, evidence/approval gates, conflicts, and activation |
| `SL.Runtime.Resource.ps1` | Immutable resource receipts, deterministic projections, advisory efficiency, baseline pairing, and lineage |
| `SL.Runtime.Lifecycle.ps1` | Retrieval, quarantine, sweep, restore, and rollback |
| `SL.Runtime.Validation.ps1` | Repository validation, projection drift detection, and doctor aggregation |
| `SL.Runtime.Conformance.ps1` | PowerShell golden-vector runner |
| `SL.Runtime.Doctor.ps1` | Manifest, hash, version, and launcher checks |
| `SL-conformance-vectors.json` | Shared TypeScript/PowerShell golden vectors |
| `SL-runtime-manifest.schema.json` | Reviewable manifest JSON Schema |
| `SL-runtime.manifest.json` | Runtime identity and SHA-256 inventory |

Only files listed in `SL-runtime.manifest.json`, plus the manifest itself, are
SL-managed runtime files. Unknown files below `SL-runtime/` are preserved.

## Integrity bootstrap and trust boundary

`SL.ps1` parses the runtime manifest and verifies the LF-normalized SHA-256 of
every declared payload before it imports `SL.Runtime.psm1`. The bootstrap also
requires the complete, ordinally ordered payload inventory, so removing a
module from the manifest cannot make that module execute without verification.
Missing manifests fail with exit `5`; invalid manifests, missing payloads, and
hash drift fail with the documented manifest/integrity/mixed-version codes
before any runtime module is dot-sourced.

The repository commit, workflow definition, `SL.ps1` bootstrap, and
`SL-runtime.manifest.json` are the trust boundary. Payload hashes detect
accidental corruption or an unreviewed payload-only change; they cannot defend
against a malicious change that rewrites both the trusted bootstrap/manifest
and payload in the same commit. Workflows therefore execute only the runtime
from their checked-out, reviewed repository commit and do not download a
runtime or invoke Node. Directly importing `SL.Runtime.psm1` is unsupported
because it bypasses the entry-point bootstrap.

## Command and exit contract

```text
SL.ps1 [--json] [--dry-run] [--repo-root <path>] <command>
```

Implemented commands are:

- `root`, `scope list|resolve|validate`, and `retrieve`;
- `capture`, `vote`, `use start`, `use finish`, `stats`, and `project`;
- `resource import|record|baseline|stats` and the top-level `efficiency` alias;
- `evaluate` and `promotion register|evaluate|approve|activate`;
- `validate`, `doctor`, `forget`, `undo`, and `sweep`;
- `help`, `version`, `validate-runtime`, and `conformance`.

Legacy command spellings `promote`, `promotion-evaluate`,
`promotion-activate`, `usage`, and `index` remain accepted. Options may appear
before or after the command. Commands resolve the repository root by walking
upward for a `.git` file or directory unless `--repo-root` supplies the
starting path.

`--json` emits one canonical JSON value to standard output. Diagnostics go to
standard error. Every mutating command accepts `--dry-run`; dry runs acquire
no lock and write no files. Real mutations use a repository-scoped lease lock
with owner identity, bounded waiting, heartbeat refresh, and conservative
stale-owner recovery. File writes, moves, deletes, and immutable event/receipt
creation are journaled inside that lock. If any step fails, the runtime restores
every touched file byte-for-byte (or restores its prior absence), preventing
partial registry, projection, artifact, or event state.

| Exit | Meaning |
|---:|---|
| `0` | Success |
| `2` | Invalid option, command, or argument |
| `3` | PowerShell missing or older than 7 |
| `4` | Repository root not found |
| `5` | Manifest missing or invalid |
| `6` | Runtime file missing, hash drift, or launcher integrity failure |
| `7` | Mixed runtime versions |
| `8` | Validation or conformance failure |
| `9` | Reserved for contained file I/O failure |
| `10` | Unexpected runtime failure |

## Canonical values and hashes

Canonical JSON uses UTF-8, no insignificant whitespace, ordinal object-key
ordering, JSON string escaping, array order preservation, and only
`null`/boolean/string/safe-integer/array/object values. SHA-256 is lowercase
hex over UTF-8 bytes. Runtime file hashes normalize CRLF and CR to LF first,
so a Git checkout's line-ending policy does not create false drift.

Advisory efficiency reports use a separate deterministic JSON serializer that
accepts finite fractional metrics. Canonical JSON remains integer-only, so
receipt IDs, event IDs, content hashes, and conformance vectors retain the
safe-integer hashing contract.

Repository paths normalize `\` to `/`, collapse separators and `.` segments,
and resolve internal `..` segments. Absolute paths, drive-relative paths,
NUL, and root escape are rejected. File operations resolve the nearest
existing ancestor and fail closed if a symlink or junction leaves the
repository. Writes use a same-directory temporary file followed by an atomic
replace.

## YAML and frontmatter subset

The runtime parser deliberately implements a small SL subset, not general
YAML:

- one document whose root is a mapping;
- two-space indentation with nested mappings and sequences;
- mapping keys matching `[A-Za-z][A-Za-z0-9_-]*`;
- plain, single-quoted, and limited JSON-style double-quoted strings;
- lowercase `true`, `false`, and `null`;
- base-10 safe integers;
- block sequences, inline scalar lists, empty `[]`, and empty `{}`;
- sequence entries that are scalars or mappings;
- blank lines and whole-line `#` comments.

It rejects tabs, duplicate keys, floats, timestamps, implicit
`yes`/`no`/`on`/`off`, inline comments, anchors, aliases, merge keys, tags,
directives, multiple documents, block scalars, flow mappings, and arbitrary
YAML object construction. Markdown frontmatter must start with `---` on the
first line and contain an exact closing `---`; the body is returned with LF
newlines.

## Typed validation subset

The reusable typed-value contract supports:

- `type`: `object`, `array`, `string`, `integer`, `boolean`, or `null`;
- `required`, `properties`, and boolean `additionalProperties`;
- `items` and `minItems`;
- `minLength`, `pattern`, and integer `minimum`;
- `enum` and `const`.

Unknown validation keywords fail closed. Values and contracts are plain
JSON-compatible data; this is not a complete JSON Schema implementation.
`pattern` is limited to the JavaScript/.NET common regular-expression subset:
lookarounds, named groups, inline options, Unicode categories, and
backreferences are rejected.

## Glob subset

Globs are case-sensitive on every platform and match normalized
repository-relative `/` paths. Dot-prefixed names are ordinary characters.

- `*` matches zero or more characters except `/`.
- `?` matches exactly one character except `/`.
- `**/` matches zero or more complete path segments.
- trailing `/**` matches the named directory and every descendant.
- literals and `/` match themselves.

Negation, comments, character classes, brace expansion, extglobs, grouping,
triple-star forms, absolute paths, `.`/`..` segments, and trailing `/` are
rejected.

## Manifest and update rules

The manifest records runtime version, source-release commit, manifest schema
version, SL config contract version, conformance version, minimum PowerShell
version, and the SHA-256 of every payload file. The manifest does not hash
itself.

`npm run build:runtime` deterministically copies the manifest schema into the
runtime template, hashes LF-normalized template bytes, sorts paths ordinally,
and stages the manifest with `SL_RUNTIME_SOURCE_RELEASE_COMMIT`. The version
commit uses `__SL_SOURCE_RELEASE_COMMIT__`; the dedicated immutable-pin commit
replaces it with the reviewed 40-character version commit while recomputing no
payload hashes.

On update, SL first validates every file against the installed manifest. It
rejects missing, modified, invalid, or mixed-version runtime state. Only then
does it replace files declared by the previous manifest, add new managed
paths that are unoccupied, remove obsolete previously managed paths, and
write the new manifest last. Manual or unrelated files are preserved. A
dry-run performs all preflight checks and reports changes without writing.
Runtime manifest builds snapshot the generated schema and manifest and restore
both if staging fails, so a failed package build cannot leave a mixed generated
runtime contract.

## Conformance

The shared vector file covers canonical JSON and hash output, Windows and
POSIX path forms, YAML/frontmatter scalars and lists, typed validation, glob
behavior, Unicode capture slugs, scope shards, usage/lifecycle event IDs,
retention deadlines, promotion owner sets, and opaque evidence references.
TypeScript and PowerShell runners compare exact canonical output and exact
fail-closed error codes.

Validation contracts containing Node/npm executable checks remain
non-executable in the repository-local runtime by design. They fail the
activation gate rather than invoking an unavailable or unreviewed external
runtime. Static scenarios, content hashes, provenance, owner approval,
scope-distributed evidence, and conflict/override rules remain enforced.
