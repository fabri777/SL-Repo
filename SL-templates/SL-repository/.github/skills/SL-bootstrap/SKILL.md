---
name: SL-bootstrap
description: Install, update, or diagnose the repository-local Self Learning layer.
---

# SL bootstrap

Use `sl-repo update --dry-run` only for managed runtime updates. After the
runtime is installed, diagnose and validate with:

```powershell
pwsh .github/SL-learning/SL-runtime/SL.ps1 doctor .
pwsh .github/SL-learning/SL-runtime/SL.ps1 validate .
```

Preserve non-SL content.
