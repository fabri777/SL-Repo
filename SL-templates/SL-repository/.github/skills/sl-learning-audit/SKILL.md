---
name: sl-learning-audit
description: Validate and review stale, contradictory, unsafe, or deletion-eligible SL knowledge.
---

# SL learning audit

Run through PowerShell 7:

```powershell
pwsh -NoProfile -File .github/sl-learning/sl-runtime/sl.ps1 validate .
pwsh -NoProfile -File .github/sl-learning/sl-runtime/sl.ps1 sweep . --dry-run
```

Never bypass ownership, pinning, dependency, or quarantine checks.
