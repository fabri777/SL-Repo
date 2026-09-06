---
name: sl-lesson-curator
description: Capture verified wins and pitfalls, deduplicate lessons, record successful reuse, and promote mature knowledge into Copilot instructions or skills.
---

# SL lesson curator

Use at the end of a non-trivial task when a durable, verified lesson was
learned.

1. Search `.github/SL-learning/SL-index.json` for overlapping triggers.
2. If an existing lesson applies, record an agent or host application receipt
   with `sl-repo use start`, then finish it after the outcome is known.
3. Otherwise run `sl-repo capture` and replace the generated placeholders with
   concise evidence.
4. Remove credentials, personal data, customer data, and absolute user paths.
5. Promote declarative guidance to
   `.github/instructions/SL-*.instructions.md`.
6. Promote reusable procedures to `.github/skills/<lowercase-skill-name>/SKILL.md`.
7. Run `sl-repo project` and `sl-repo validate`.

Retrieval is not successful reuse. Three immutable verified-success events for
the current content version mark a lesson as a promotion candidate. Promotion
remains a semantic, reviewable decision. A success associated with guidance is
useful evidence, not proof that the guidance causally improved the outcome.
