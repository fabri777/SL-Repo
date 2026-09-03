# SL naming

SL-owned names use the `SL-` prefix. Ecosystem-mandated names remain standard
so tools can discover them.

| Keep standard | Reason |
|---|---|
| `.github/skills` | Agent Skills discovery |
| `.github/instructions` | Path-specific Copilot instructions |
| `.github/copilot-instructions.md` | Repository-wide Copilot instructions |
| `SKILL.md` | Agent Skills standard |
| `plugin.json` | Copilot plugin manifest |
| `package.json`, `package-lock.json`, `tsconfig.json` | Node.js and TypeScript tooling |
| `.gitignore` | Git behavior |
| `.github/CODEOWNERS`, `.github/dependabot.yml` | GitHub discovery |
| `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md` | Repository, agent, contribution, and security discovery |

Everything below those fixed roots that SL controls should use an `SL-`
prefix, such as `.github/skills/SL-lesson-curator`.
