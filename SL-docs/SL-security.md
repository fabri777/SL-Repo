# SL security model

SL data is committed to Git and must be safe for every reader of the
repository.

- Reject common token, password, private-key, and connection-string patterns.
- Reject absolute paths containing user profile names.
- Reject evidence and approval references containing email addresses, IP
  addresses, user paths, shell content, or credential-like material.
- Resolve existing ancestors and reject symlink or junction paths that escape
  the repository before reading, writing, moving, executing, or indexing.
- Run executable contract checks without a shell, allow only repository-local
  JavaScript or declared `npm run` scripts, and enforce bounded timeouts.
  These are trusted repository commands and run only after explicit opt-in.
  Process-tree cleanup is defense-in-depth, not an adversarial operating-system
  sandbox or a guarantee against deliberate escape.
- Never export repository evidence automatically.
- Never classify model confidence as permission to delete.
- Only registry entries marked `managedBy: SL-Repo` are mutable by SL.
- Treat `.github/SL-learning/SL-runtime/SL-runtime.manifest.json` as the
  runtime ownership boundary. Update only files whose current hash matches
  the previous manifest; reject drift, missing files, mixed versions, and
  occupied newly managed paths.
- Preserve unrelated files under `SL-runtime/`; never infer ownership from a
  path prefix or matching content.
- Normalize runtime text to LF before hashing so Git checkout line endings do
  not weaken or spuriously break integrity checks.
- Require PowerShell 7 or newer. The Bash launcher may only locate `pwsh` and
  invoke repository-local `SL.ps1`; it must not fall back to Node, npm, npx,
  curl, downloads, or a global SL executable.
- Parse only the documented fail-closed SL YAML/frontmatter, typed-validation,
  and glob subsets. Unsupported aliases, tags, block scalars, expansion
  syntax, schema keywords, or path escapes are errors rather than best-effort
  interpretations.
- Treat `AGENTS.md` as the provider-neutral agent entry point and preserve all
  content outside the delimited SL block.
- Store opaque receipt and approval references, never reviewer identity,
  command output, or source evidence in telemetry.
- Acquire an optional automation-adapter runtime only from reviewed immutable
  commit `51ab00795f8109bb3fad7c717bf9f427fec63772` until a signed versioned
  package or release is available.
- Set `persist-credentials: false` on consumer and runtime checkouts.
  Authentication comes from normal Git-host repository permissions, secrets,
  or service connections and is never embedded in an SL template.
- Verify the checked-out runtime commit before installing or executing it.
  Reject branches, moving tags, and other floating runtime references.
- Pin every external action in the write-scoped retention job to a reviewed
  full commit SHA and retain an upstream `owner/action vX.Y.Z` comment.
- Treat scheduled retention as preview-only. Manual retention applies a patch
  in a separate write-scoped job and always requires pull-request review.
- The Azure Pipelines retention adapter has no write-scoped job: manual sweep
  runs produce a patch artifact that a maintainer must apply on a review
  branch. The adapter never pushes, opens or merges a pull request, or changes
  branch protection.
- Git branch protections remain authoritative.
