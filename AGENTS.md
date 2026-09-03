# SL Repo agent instructions

SL Repo is a TypeScript project for repository-local agent learning.

- Prefix SL-controlled files and directories with `SL-`.
- Preserve mandatory ecosystem names such as `package.json`, `SKILL.md`,
  `.github/skills`, and `.github/instructions`.
- Keep repository-specific evidence local. Do not introduce SL Org or
  SL Company services in this milestone.
- Never delete a file unless it is registered as SL-managed and passes every
  forgetting gate.
- Use fixed clocks and deterministic identifiers in tests.
- Run `npm run ci` after code changes.
