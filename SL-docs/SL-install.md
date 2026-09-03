# Installing SL Repo

## Prerequisites

- Git
- Node.js 20 or newer
- A Git repository to receive the SL layer

## From a local development clone

```powershell
Set-Location C:\dev\SL-Repo
npm install
npm run build
npm link
sl-repo init C:\path\to\target --dry-run
sl-repo init C:\path\to\target
sl-repo validate C:\path\to\target
```

## Update

```powershell
sl-repo update C:\path\to\target --dry-run
sl-repo update C:\path\to\target
```

Update replaces only registered system templates and the SL-managed
instruction block. Produced lessons, instructions, and skills are retained.

## Uninstall

The first milestone intentionally does not provide destructive uninstall.
Remove system templates only after `sl-repo doctor` identifies them. Produced
knowledge remains ordinary Git content.

## Private GitHub repository installation

Authenticate GitHub as `fabri777`, then run:

```powershell
npm exec --yes --package=github:fabri777/SL-Repo -- sl-repo init C:\path\to\target
```

The generated workflows reference the future
`@fabri777/sl-repo` GitHub Package. Until that package is published, use a
local clone or replace the workflow installation step with an authenticated
checkout of `fabri777/SL-Repo`.
