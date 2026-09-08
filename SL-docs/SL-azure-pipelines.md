# Optional Azure Pipelines adapter

SL works in Azure Repos without Azure Pipelines. The adapter in this document
adds hosted validation and retention scheduling; it does not enable capture or
retrieval, which already operate through the Node CLI, Git state, and
`AGENTS.md`.

Installation places SL-owned job templates at:

- `.azure-pipelines/sl-learning/SL-validation.yml`
- `.azure-pipelines/sl-learning/SL-retention.yml`

The installer never overwrites or claims a pre-existing unregistered file,
including files elsewhere under `.azure-pipelines/`.

## Runtime repository resource

The consuming pipeline must declare a repository resource named `SLRuntime`
and pin it to this exact commit:

```text
e841414d13bfdcd1c534eb7e101f7f2330dc4709
```

For an Azure Repos mirror in the same organization:

```yaml
resources:
  repositories:
    - repository: SLRuntime
      type: git
      name: <runtime-project>/<runtime-repository>
      ref: e841414d13bfdcd1c534eb7e101f7f2330dc4709
```

Use normal Azure Repos repository permissions. If the mirror is in another
project or organization, configure the appropriate Azure Repos service
connection and add its name as `endpoint`. Do not put a PAT in YAML.

For an authorized GitHub source:

```yaml
resources:
  repositories:
    - repository: SLRuntime
      type: github
      endpoint: <github-service-connection>
      name: <runtime-owner>/<runtime-repository>
      ref: e841414d13bfdcd1c534eb7e101f7f2330dc4709
```

The service connection supplies authentication. The installed templates
verify that the checked-out `HEAD` equals the approved full commit before
installing or executing the runtime.

## PR and branch validation

Create a manually owned root pipeline file, for example
`azure-pipelines.yml`, and reference the installed job template:

```yaml
trigger:
  branches:
    include:
      - main

resources:
  repositories:
    - repository: SLRuntime
      type: git
      name: <runtime-project>/<runtime-repository>
      ref: e841414d13bfdcd1c534eb7e101f7f2330dc4709

jobs:
  - template: /.azure-pipelines/sl-learning/SL-validation.yml
    parameters:
      runtimeRepository: SLRuntime
      consumerInstallCommand: npm ci
      consumerCheckCommand: npm test
```

Replace the consumer commands with repository-appropriate checks, such as a
documented `dotnet test`, `pnpm test`, or another existing validation script.
Empty command parameters skip that phase. The template always:

1. Checks out the consumer and runtime without persisting credentials.
2. Verifies the immutable runtime commit.
3. Installs and builds the runtime.
4. Runs the configured consumer checks.
5. Rebuilds SL projections and fails on repository drift.
6. Runs `sl validate`.

For Azure Repos, configure the resulting pipeline as a build-validation branch
policy on the target branch when PR validation or an automated merge gate is
desired. Azure Repos PR validation is configured through branch policies, not
the YAML `pr` trigger. If the consumer repository itself is hosted on GitHub
or Bitbucket Cloud, its manually owned root pipeline may add the supported
YAML `pr` trigger.

## Scheduled and manual retention

Create a separate manually owned pipeline, for example
`azure-pipelines-retention.yml`:

```yaml
parameters:
  - name: applySweep
    displayName: Create a retention patch artifact
    type: boolean
    default: false

trigger: none
pr: none

schedules:
  - cron: "17 4 * * 1"
    displayName: Weekly SL retention preview
    branches:
      include:
        - main
    always: true

resources:
  repositories:
    - repository: SLRuntime
      type: git
      name: <runtime-project>/<runtime-repository>
      ref: e841414d13bfdcd1c534eb7e101f7f2330dc4709

jobs:
  - template: /.azure-pipelines/sl-learning/SL-retention.yml
    parameters:
      runtimeRepository: SLRuntime
      applySweep: ${{ parameters.applySweep }}
```

Scheduled runs use the default `false` value and only execute
`sweep --dry-run`. A maintainer can queue a manual run with
`applySweep: true`. That run applies the sweep only in the disposable agent
workspace, validates the result, and publishes `SL-retention-patch`.

Download and inspect the patch, apply it on a normal review branch, and submit
it through the repository's standard pull-request and branch-policy process.
The template does not persist checkout credentials, push a branch, create or
merge a pull request, alter policies, or bypass protections.

## Operating without automation

Without an Azure or GitHub adapter, run these commands locally or from the
repository agent:

```powershell
sl project .
sl validate .
sl sweep . --dry-run
```

Knowledge capture and retrieval continue normally. The missing automation is
limited to a hosted merge gate, scheduled projection or retention execution,
and cross-platform release validation.
