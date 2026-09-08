# SL Repo agent instructions

SL Repo is a TypeScript project for repository-local agent learning.

- Prefix SL-controlled files and directories with `SL-`, except bundled skill
  directory names and frontmatter names, which use lowercase `sl-` for Agent
  Skills compatibility.
- Preserve mandatory ecosystem names such as `package.json`, `SKILL.md`,
  `.github/skills`, and `.github/instructions`.
- Keep repository-specific evidence local. Do not introduce SL Org or
  SL Company services in this milestone.
- Never delete a file unless it is registered as SL-managed and passes every
  forgetting gate.
- Use fixed clocks and deterministic identifiers in tests.
- Run `npm run ci` after code changes.

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
