---
name: SL-lesson-curator
description: Capture verified wins and pitfalls, deduplicate lessons, record successful reuse, and promote mature knowledge into Copilot instructions or skills.
---

# SL lesson curator

Use at the end of a non-trivial task when a durable, verified lesson was
learned.

1. Search `.github/SL-learning/SL-index.json` for overlapping triggers.
2. If an existing lesson applies, use it and run
   `sl-repo vote <id> --useful` after the outcome is verified.
3. Otherwise run `sl-repo capture` and replace the generated placeholders with
   concise evidence.
4. Remove credentials, personal data, customer data, and absolute user paths.
5. Promote declarative guidance to
   `.github/instructions/SL-*.instructions.md`.
6. Promote reusable procedures to `.github/skills/SL-*/SKILL.md`.
7. Run `sl-repo index` and `sl-repo validate`.

Retrieval is not successful reuse. Three positive reuse votes mark a lesson as
a promotion candidate. Promotion remains a semantic, reviewable decision.
