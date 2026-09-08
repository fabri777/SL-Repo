# SL validation contracts

Every newly registered probationary instruction or skill references a
versioned JSON contract from
its `validationContract` frontmatter field. Contract files live under
`.github/sl-learning/sl-validation-contracts/` and use the
`SL-*.validation.json` naming convention.

The version 1 schema is `SL-schemas/validation-contract.schema.json`. A
contract binds the promoted artifact ID, type, repository path, and evidence
source IDs. It also declares repository or path scope, deterministic behavioral
scenarios, optional counterexamples, and optional exclusive declarations used
to detect obvious conflicts between active artifacts.

Skills may define executable checks with a supported command, argument array,
repository-relative working directory, timeout, and expected exit code.
Commands are never run by `sl validate` or promotion registration.
Callers must explicitly invoke the core evaluator with
`{ executeCommands: true }`. Commands run without a shell, are restricted to
`node` repository scripts or `npm run` package scripts, and fail closed on
unsafe paths, startup errors, timeouts, or unexpected exit codes. Executable
checks are trusted commands from the reviewed repository and run only after
this explicit opt-in. Process-tree cleanup is defense-in-depth for ordinary
child processes; it is not an adversarial operating-system sandbox and does
not claim containment against deliberate escape.

The `slEvaluate` core operation returns deterministic contract-level static,
scenario, and executable check outcomes. The promotion lifecycle adds
`slEvaluatePromotionReadiness`, which stores auditable aggregate gate results,
artifact version/hash, contract hash, evaluation time, and an opaque
repository-review reference in the registry. It never stores source content,
reviewer identity, command output, or other PII.

`slActivatePromotion` accepts only a probation artifact with a current passing
readiness evaluation. Real activation is serialized by the shared repository
mutation lock, then rechecks artifact and contract hashes and re-evaluates
contract structure, provenance, scenarios, active conflicts, executable
checks, and the version-bound approval before moving the file into its active
`.github/instructions` or `.github/skills` path. Missing approval, skipped or
newly failing executable checks, invalid provenance, conflicts, failed
scenarios, or post-evaluation content changes all fail closed and leave the
artifact in probation.

Dry-run evaluation and activation remain repository-side-effect free. Within
one process, activation reuses the dry-run evaluation in memory and refreshes
all current gates rather than requiring that evaluation to have been written.

Approval is content-version-specific because it is stored inside the
evaluation that hashes both artifact and contract. Editing either file makes
the evaluation and its approval stale. Repository validation reports the stale
evaluation, the active index omits stale active guidance, and activation
requires a new evaluation and approval reference.

The CLI exposes the evaluator by registered artifact ID or path:

```powershell
sl evaluate <artifact-id-or-path> [path] --json
sl evaluate <artifact-id-or-path> [path] --execute-checks --json
sl promotion-evaluate <artifact-id> [path] --approval-ref <ref>
sl promotion-activate <artifact-id> [path]
```

The first form is static. The second is the explicit executable opt-in and
preserves the evaluator's safe-command restrictions, timeout handling, and
fail-closed nonzero exit code. Evaluation and activation support `--dry-run`.
Dry-run evaluation never starts executable checks, and dry-run activation
does not update the registry, index, lifecycle events, or artifact paths.
