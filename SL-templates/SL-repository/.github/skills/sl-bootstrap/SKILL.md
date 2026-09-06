---
name: sl-bootstrap
description: Install, update, or diagnose the repository-local Self Learning layer.
---

# SL bootstrap

Use `sl-repo init --dry-run` for first installation and `sl-repo update
--dry-run` for managed runtime updates. After installation, diagnose and
validate through the committed PowerShell 7 runtime:

```powershell
pwsh -NoProfile -File .github/SL-learning/SL-runtime/SL.ps1 doctor .
pwsh -NoProfile -File .github/SL-learning/SL-runtime/SL.ps1 validate .
```

Preserve non-SL content.
