---
name: sl-learning-audit
description: Audit Self Learning artifacts for invalid metadata, stale knowledge, contradictions, broken links, unsafe content, and forgetting eligibility.
---

# SL learning audit

1. Run `sl validate`.
2. Run the repository-local runtime's `sweep --dry-run` command.
3. Review contradictions semantically; tools may detect candidates but cannot
   decide which claim is correct.
4. Mark explicitly wrong knowledge with
   repository-local runtime's `forget <id> --reason wrong` command.
5. Pin artifacts that must not age out.
6. Never bypass ownership, dependency, or quarantine gates.
