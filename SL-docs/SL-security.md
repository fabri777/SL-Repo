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
- Store opaque receipt and approval references, never reviewer identity,
  command output, or source evidence in telemetry.
- Acquire the private consumer-workflow runtime only from a reviewed immutable
  commit SHA until a signed versioned package or release is available.
- Set `persist-credentials: false` on consumer and runtime checkouts. External
  runtime code runs only with read permissions and never receives repository
  write credentials.
- Pin every external action in the write-scoped retention job to a reviewed
  full commit SHA and retain an upstream `owner/action vX.Y.Z` comment.
- Treat scheduled retention as preview-only. Manual retention applies a patch
  in a separate write-scoped job and always requires pull-request review.
- Git branch protections remain authoritative.
