---
name: sl-bootstrap
description: Bootstrap, update, diagnose, or install the Self Learning repository layer in a Git repository.
---

# SL bootstrap

1. Confirm the target is a Git repository.
2. Run `sl-repo init <path> --dry-run`.
3. Review changes, especially existing Copilot instruction files.
4. Run `sl-repo init <path>`.
5. Run `sl-repo doctor <path>` and `sl-repo validate <path>`.
6. Never replace content outside the SL managed block.
