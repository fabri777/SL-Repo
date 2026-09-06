# SL naming

SL-owned names use the `SL-` prefix. Ecosystem-mandated names remain standard
so tools can discover them.

| Keep standard | Reason |
|---|---|
| `AGENTS.md` | Provider-neutral repository agent entry point |
| `.github/skills` | Agent Skills discovery |
| `.github/instructions` | Path-specific Copilot instructions |
| `.github/copilot-instructions.md` | GitHub Copilot compatibility discovery |
| `.azure-pipelines` | Azure Pipelines discovery |
| `SKILL.md` | Agent Skills standard |
| `plugin.json` | Copilot plugin manifest |
| `package.json`, `package-lock.json`, `tsconfig.json` | Node.js and TypeScript tooling |
| `.gitignore` | Git behavior |
| `.github/CODEOWNERS`, `.github/dependabot.yml` | GitHub discovery |
| `README.md`, `CONTRIBUTING.md`, `SECURITY.md` | Repository, contribution, and security discovery |

Everything below those fixed roots that SL controls should use an `SL-`
prefix, except Agent Skills directory names and frontmatter names, which use
the lowercase `sl-` prefix required by the ecosystem. Examples include
`.github/skills/sl-lesson-curator` and
`.azure-pipelines/SL-learning/SL-validation.yml`.
