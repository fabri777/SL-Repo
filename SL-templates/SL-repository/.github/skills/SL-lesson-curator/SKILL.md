---
name: SL-lesson-curator
description: Capture verified wins and pitfalls, deduplicate lessons, record successful reuse, and promote mature knowledge.
---

# SL lesson curator

Search the SL index before capture. Keep evidence concise and scrubbed. An
agent or host must run
`pwsh .github/SL-learning/SL-runtime/SL.ps1 use start` when it applies guidance
and finish the returned receipt after the outcome is known. Reuse stable task,
application, and idempotency IDs when retrying automation. Three immutable
verified-success events for the current content version mark a promotion
candidate. Promote declarative guidance to an `SL-*.instructions.md` file and
procedures to an `SL-*` skill, then run the local runtime's `project` and
`validate` commands. Outcome association is evidence, not proof that the
guidance caused an improvement.
