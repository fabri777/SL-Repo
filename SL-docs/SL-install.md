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

## Private Microsoft repository installation

The exact `npx` command will be documented after `microsoft/SL-Repo` exists and
has been tested with the `ffishkel_microsoft` account.
