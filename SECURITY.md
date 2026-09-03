# Security

Do not place credentials, tokens, customer data, personal information, or
private endpoints in lessons.

The validator rejects common secret patterns and absolute user-profile paths.
This is a safety net, not a substitute for GitHub secret scanning and human
review.

Consumer workflows acquire SL Repo source at the immutable commit documented
in `SL-docs/SL-install.md`; mutable branch references are prohibited. External
runtime execution uses non-persisted read-only checkout credentials. Retention
changes cross into a write-scoped job only as a patch artifact and require
pull-request review.

Report security concerns through the private `fabri777/SL-Repo` repository.
