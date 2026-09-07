# Security

Do not place credentials, tokens, customer data, personal information, or
private endpoints in lessons.

The validator rejects common secret patterns and absolute user-profile paths.
This is a safety net, not a substitute for Git-host secret scanning and human
review.

Optional GitHub Actions and Azure Pipelines adapters acquire SL Repo source at
the immutable commit documented in `SL-docs/SL-install.md`; mutable branch
references are prohibited. Authentication is supplied by normal repository
permissions, secrets, or service connections and is never embedded in SL
state or templates. External runtime execution uses non-persisted checkout
credentials.

Portable installers use the caller's authenticated GitHub CLI session and do
not accept tokens or credentials as arguments. They verify archive SHA-256
values before extraction, validate embedded source-commit and platform
metadata against the release manifest, and install atomically under a
user-local directory. A failed portable update does not replace the selected
runtime.

GitHub retention changes cross into a write-scoped job only as a patch
artifact and require pull-request review. Azure Pipelines retention publishes
a patch artifact but never pushes, opens or merges a pull request, or bypasses
repository protections.

Report security concerns through the private `ffishkel_microsoft/SL`
repository.
