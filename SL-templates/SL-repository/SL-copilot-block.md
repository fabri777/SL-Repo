<!-- SL-REPO:START -->
## Self Learning Repository

At task start, inspect `.github/SL-learning/SL-index.json` when the request
matches a recorded trigger. Open only the relevant artifacts.

At task end, invoke the `sl-lesson-curator` skill when the work produced a
verified reusable win or pitfall. Rebuild and validate state through the
committed runtime after changes:

```powershell
pwsh .github/SL-learning/SL-runtime/SL.ps1 project .
pwsh .github/SL-learning/SL-runtime/SL.ps1 validate .
```

Do not capture secrets, personal data, customer data, or absolute user paths.
Do not manually delete registered knowledge; use the guarded forgetting
lifecycle.
<!-- SL-REPO:END -->
