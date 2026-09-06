---
name: sl-learning-audit
description: Audit Self Learning artifacts for invalid metadata, stale knowledge, contradictions, broken links, unsafe content, and forgetting eligibility.
---

# SL learning audit

1. Run `sl-repo validate`.
2. Run `sl-repo sweep --dry-run`.
3. Review contradictions semantically; tools may detect candidates but cannot
   decide which claim is correct.
4. Mark explicitly wrong knowledge with
   `sl-repo forget <id> --reason wrong`.
5. Pin artifacts that must not age out.
6. Never bypass ownership, dependency, or quarantine gates.
