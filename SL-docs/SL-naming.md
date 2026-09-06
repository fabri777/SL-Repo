# SL naming

Immutable SL artifact IDs use the uppercase `SL-` prefix. For promoted skills,
the ecosystem-facing name is a separate identity: the folder under
`.github/skills/` and the `name` field in `SKILL.md` both use the deterministic
lowercase form of the artifact ID. For example, promoted artifact ID
`SL-LESSON-CURATOR` maps to skill name `sl-lesson-curator`.

Skill names must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Uppercase letters,
underscores, whitespace, empty names, leading or trailing hyphens, and repeated
hyphens are invalid. The folder and frontmatter name must agree.

Other SL-owned names use the `SL-` prefix. Ecosystem-mandated names remain
standard so tools can discover them.

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
lowercase kebab-case names required by the ecosystem. For example, promoted
artifact `SL-EXAMPLE-SKILL` targets
`.github/skills/sl-example-skill/SKILL.md`; bundled examples include
`.github/skills/sl-lesson-curator`, while other SL-owned paths include
`.azure-pipelines/SL-learning/SL-validation.yml`.
