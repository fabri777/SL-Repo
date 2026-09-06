---
name: sl-learning-audit
description: Audit SL artifacts for stale, contradictory, malformed, unsafe, or deletion-eligible knowledge.
---

# SL learning audit

Run validation and a forgetting dry-run through
`.github/SL-learning/SL-runtime/SL.ps1`. A model may identify contradiction
candidates but must not decide which claim is wrong without explicit evidence.
Never bypass ownership, pinning, dependency, or quarantine gates.
