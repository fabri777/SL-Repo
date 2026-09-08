# SL Repo development

This repository develops the SL Repo learning lifecycle.

- Keep semantic decisions in Copilot skills and deterministic enforcement in
  the TypeScript CLI.
- Prefix SL-controlled public names with `sl-` unless an ecosystem-mandated filename
  is required for discovery.
- Treat each scope's `sl-registry.json` as the authority for ownership and lifecycle.
- Never delete manual, system, pinned, or actively referenced artifacts.
- Add deterministic tests for retention and deletion behavior.

<!-- sl:start -->
## Self Learning Repository

At task start, inspect `.github/sl-learning/sl-index.json` when the request
matches a recorded trigger. Open only the relevant artifacts.

At task end, invoke the `sl-lesson-curator` skill when the work produced a
verified reusable win or pitfall. Rebuild and validate state through the
committed runtime after changes:

```powershell
pwsh .github/sl-learning/sl-runtime/sl.ps1 project .
pwsh .github/sl-learning/sl-runtime/sl.ps1 validate .
```

Do not capture secrets, personal data, customer data, or absolute user paths.
Do not manually delete registered knowledge; use the guarded forgetting
lifecycle.
<!-- sl:end -->
