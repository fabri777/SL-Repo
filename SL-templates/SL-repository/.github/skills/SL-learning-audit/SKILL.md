---
name: SL-learning-audit
description: Validate and review stale, contradictory, unsafe, or deletion-eligible SL knowledge.
---

# SL learning audit

Run through PowerShell 7:

```powershell
pwsh -NoProfile -File .github/SL-learning/SL-runtime/SL.ps1 validate .
pwsh -NoProfile -File .github/SL-learning/SL-runtime/SL.ps1 sweep . --dry-run
```

Never bypass ownership, pinning, dependency, or quarantine checks.
