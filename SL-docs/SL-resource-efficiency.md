# SL resource receipts and advisory efficiency

SL records model, tool, elapsed-time, attempt, and optional host-reported cost
data as immutable resource receipts. The receipts are provider-neutral JSON:
the provider and model are opaque segmentation values, and SL does not call a
provider API or apply a provider price table.

Resource telemetry is advisory. It records association with an SL artifact and
verified application outcome; it does not claim that the artifact caused the
outcome or that two unrelated tasks are comparable.

## Commands

After initialization, every command below is also available without Node or a
global CLI through:

```powershell
$sl = ".github/sl-learning/sl-runtime/sl.ps1"
pwsh -NoLogo -NoProfile -File $sl resource stats --json
pwsh -NoLogo -NoProfile -File $sl efficiency --json
```

Import a single input, an array, or a versioned envelope from a JSON file:

```powershell
sl resource import .\SL-resource-input.json . --json
```

Pass `-` as the input path to read at most 1 MiB from stdin. The input contract
is published as `SL-schemas/resource-input.schema.json`. Import rejects
unknown fields at every object level, enforces phase-specific required and
forbidden fields plus exact baseline/treatment roles, and recursively scans
all strings for secrets, PII, and user paths before persistence. Provider
payloads, prompts, responses, invalid role values, and other unreviewed
metadata cannot be silently normalized or stored.

Record generation resources using the current immutable artifact identity:

```powershell
sl resource record SL-EXAMPLE . `
  --phase generation `
  --generation-run-id build-123 `
  --idempotency-key build-123-resource `
  --source ci --quality measured `
  --provider provider-a --model model-a `
  --input-tokens 1200 --output-tokens 300 `
  --wall-clock-ms 8000
```

Record application resources after `use start`. The command derives the task,
artifact version, content hash, and scope from the existing usage lifecycle:

```powershell
sl resource record SL-EXAMPLE . `
  --phase application `
  --application-id apply-123 `
  --idempotency-key apply-123-resource `
  --provider provider-a --model model-a `
  --input-tokens 500 --output-tokens 100 `
  --wall-clock-ms 4000 `
  --comparison-id comparison-123 `
  --scenario-key fix-same-defect
```

Record the paired baseline separately:

```powershell
sl resource baseline . `
  --task-run-id baseline-123 `
  --comparison-id comparison-123 `
  --scenario-key fix-same-defect `
  --idempotency-key baseline-123-resource `
  --quality measured `
  --provider provider-b --model model-b `
  --input-tokens 900 --output-tokens 250 `
  --wall-clock-ms 9000
```

All write commands accept `--dry-run`. Stable idempotency keys make retries
safe. A retry may use a new timestamp, but changing any other immutable field
is a collision. Equivalent receipt IDs or idempotency keys found in more than
one valid month path are counted once; conflicting duplicates fail closed.
Writes use exclusive creation and never overwrite a receipt.

## Efficiency report

```powershell
sl resource stats [artifact-id] . --json
```

Optional filters are `--scope`, `--provider`, `--model`, and `--quality`.
Segments always preserve:

- scope;
- artifact content version;
- provider;
- model;
- measurement quality.

The report includes:

- **generation amortization**: generation totals divided by all verified
  successful applications for the same scope and artifact version;
- **verified-success application average**: average resource use only across
  successful applications that have a matching receipt;
- **coverage**: matching successful application receipts divided by all
  verified successful applications for that scope and artifact version;
- **combined average**: observed successful-application average plus amortized
  generation resources;
- **paired baseline savings**: baseline minus treatment for each compatible
  pair, including negative values when treatment used more resources;
- **median savings** and **break-even applications**: break-even is emitted per
  resource dimension only when generation receipts exist and median savings
  for that dimension is positive;
- **promotion lineage**: direct promoted-artifact resources, direct source
  evidence resources, and their combined totals, each split into generation
  and application phases with the same scope/version/provider/model/quality
  segmentation retained.

## Pairing rules

A treatment is included only when its usage lifecycle has a
`verified`/`success` event. A pair must have exactly one treatment and one
baseline with the same comparison ID, scenario key, scope, and quality.
Missing, duplicate, or incompatible sides are reported rather than guessed.
Provider and model may differ between baseline and treatment because
cross-provider comparisons are valid; the resulting segment is identified by
the treatment provider and model. Baseline scope must already exist in the
generated state catalog; import cannot create an undeclared scope shard.

Reported monetary cost is used only when supplied by the host. SL never
estimates price. Cost savings require the same currency on both sides of a
pair, and cost averages expose their own sample counts so missing cost data is
not treated as zero.

## Source of truth and privacy

Receipts under
`.github/sl-learning/sl-scopes/<scope>/sl-resource-receipts/` are authoritative.
`sl-resource-projection.json` files are deterministic, rebuildable summaries.
Run `sl project .` after merging branches that add receipt shards.

Persist only aggregate counts, durations, opaque IDs, and opaque evidence
references. Do not put prompts, responses, file contents, email addresses,
user paths, IP addresses, secrets, or provider request payloads in a receipt.
