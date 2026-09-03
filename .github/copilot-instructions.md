# SL Repo development

This repository develops the SL Repo learning lifecycle.

- Keep semantic decisions in Copilot skills and deterministic enforcement in
  the TypeScript CLI.
- Prefix SL-controlled names with `SL-` unless an ecosystem-mandated filename
  is required for discovery.
- Treat `SL-registry.json` as the authority for ownership and lifecycle.
- Never delete manual, system, pinned, or actively referenced artifacts.
- Add deterministic tests for retention and deletion behavior.

<!-- SL-REPO:START -->
## Self Learning Repository

At task start, inspect `.github/SL-learning/SL-index.json` when the request
matches a recorded trigger. Open only the relevant artifacts.

At task end, invoke the `SL-lesson-curator` skill when the work produced a
verified reusable win or pitfall. Run `sl-repo project` and
`sl-repo validate` after changes.

Do not capture secrets, personal data, customer data, or absolute user paths.
Do not manually delete registered knowledge; use the guarded forgetting
lifecycle.
<!-- SL-REPO:END -->
