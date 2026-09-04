#!/usr/bin/env node
import { resolve } from "node:path";
import { Command, Option } from "commander";
import { slCaptureLesson } from "../SL-core/SL-capture.js";
import { slInstall } from "../SL-core/SL-installer.js";
import { slLoadConfig } from "../SL-core/SL-config.js";
import { slBuildPromotionGovernanceContext } from "../SL-core/SL-promotion-context.js";
import {
  slActivatePromotion,
  slEvaluatePromotionReadiness,
  slRegisterPromotion,
} from "../SL-core/SL-promotion.js";
import { slLoadRegistry } from "../SL-core/SL-registry.js";
import {
  slFindScopeDefinition,
  slLoadScopeCatalog,
  slResolveScopeDescriptor,
  slScopeDescriptor,
  SLScopeResolver,
} from "../SL-core/SL-scope.js";
import { slRetrieveArtifacts } from "../SL-core/SL-retrieval.js";
import type { SLChange } from "../SL-core/SL-types.js";
import {
  slNormalizePath,
  slPrintChanges,
  slSlugify,
} from "../SL-core/SL-utils.js";
import { slVoteOnLesson } from "../SL-core/SL-vote.js";
import {
  slAggregateUsageByScope,
  slAggregateUsageRepository,
  slFinishUsage,
  slProjectUsage,
  slStartUsage,
  slSynchronizeUsageProjection,
} from "../SL-core/SL-usage.js";
import {
  slForgetArtifact,
  slRestoreArtifact,
  slSweep,
} from "../SL-forgetting/SL-forgetting.js";
import { slEvaluate } from "../SL-validation/SL-validation-contract.js";
import { slValidateRepository } from "../SL-validation/SL-validation.js";

interface SLDryRunOptions {
  dryRun?: boolean;
}

interface SLJsonOptions {
  json?: boolean;
}

function slRoot(pathValue: string): string {
  return resolve(pathValue);
}

function slCollect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function slOptionalScope(
  root: string,
  scopeId?: string,
  targetPath?: string,
) {
  if (!scopeId && !targetPath) {
    return undefined;
  }
  return (
    await slResolveScopeDescriptor(root, {
      ...(scopeId ? { scopeId } : {}),
      ...(targetPath ? { targetPath } : {}),
    })
  ).scope;
}

async function slRun(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function slPrintObject(
  value: unknown,
  json: boolean,
  summary: string,
): void {
  console.log(json ? JSON.stringify(value, null, 2) : summary);
}

async function slEvaluationArtifactId(
  root: string,
  artifactIdOrPath: string,
): Promise<string> {
  const registry = await slLoadRegistry(root);
  const normalizedTarget = slNormalizePath(artifactIdOrPath);
  const absoluteTarget = resolve(root, artifactIdOrPath);
  const artifact = registry.artifacts.find(
    (candidate) =>
      candidate.id === artifactIdOrPath ||
      candidate.path === normalizedTarget ||
      candidate.promotionTargetPath === normalizedTarget ||
      (candidate.path !== null &&
        resolve(root, candidate.path) === absoluteTarget) ||
      (candidate.promotionTargetPath !== undefined &&
        resolve(root, candidate.promotionTargetPath) === absoluteTarget),
  );
  if (!artifact) {
    throw new Error(
      `SL artifact not found by ID or path: ${artifactIdOrPath}`,
    );
  }
  return artifact.id;
}

const program = new Command()
  .name("sl-repo")
  .description("Repository-local self-learning lifecycle")
  .version("0.2.0");

for (const mode of ["init", "update"] as const) {
  program
    .command(`${mode} [path]`)
    .description(
      mode === "init"
        ? "Install the SL repository layer"
        : "Update registered SL system templates",
    )
    .option("--dry-run", "Show changes without writing")
    .action((pathValue = ".", options: SLDryRunOptions) =>
      slRun(async () => {
        const changes = await slInstall(
          slRoot(pathValue),
          mode,
          options.dryRun ?? false,
        );
        slPrintChanges(changes);
      }),
    );
}

program
  .command("validate [path]")
  .description("Validate SL schemas, ownership, links, safety, and index state")
  .action((pathValue = ".") =>
    slRun(async () => {
      const issues = await slValidateRepository(slRoot(pathValue));
      for (const issue of issues) {
        console.log(
          `${issue.severity.toUpperCase()} ${issue.code}${issue.path ? ` ${issue.path}` : ""} - ${issue.message}`,
        );
      }
      if (issues.some((issue) => issue.severity === "error")) {
        process.exitCode = 1;
      } else {
        console.log("SL validation passed.");
      }
    }),
  );

program
  .command("index [path]")
  .description("Rebuild the deterministic SL discovery index")
  .option("--dry-run", "Show changes without writing")
  .action((pathValue = ".", options: SLDryRunOptions) =>
    slRun(async () => {
      const root = slRoot(pathValue);
      const changes: SLChange[] = [];
      await slSynchronizeUsageProjection(
        root,
        options.dryRun ?? false,
        changes,
      );
      slPrintChanges(changes);
    }),
  );

program
  .command("doctor [path]")
  .description("Diagnose SL installation and lifecycle health")
  .action((pathValue = ".") =>
    slRun(async () => {
      const root = slRoot(pathValue);
      const registry = await slLoadRegistry(root);
      const issues = await slValidateRepository(root);
      const counts = registry.artifacts.reduce<Record<string, number>>(
        (result, artifact) => {
          result[artifact.status] = (result[artifact.status] ?? 0) + 1;
          return result;
        },
        {},
      );
      console.log(`Artifacts: ${registry.artifacts.length}`);
      for (const [status, count] of Object.entries(counts).sort()) {
        console.log(`  ${status}: ${count}`);
      }
      console.log(`Issues: ${issues.length}`);
      for (const issue of issues) {
        console.log(`  ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
      }
      if (issues.some((issue) => issue.severity === "error")) {
        process.exitCode = 1;
      }
    }),
  );

program
  .command("scope [action-or-path] [path]")
  .description("Resolve hierarchical SL scopes for a file, directory, or changed paths")
  .option("--file <file>", "Resolve one repository file")
  .option("--current-directory <directory>", "Resolve a current directory")
  .option("--changed-path <path>", "Resolve a changed-path set", slCollect, [])
  .option("--json", "Print machine-readable JSON")
  .action(
    (
      actionOrPath = ".",
      pathValue: string | undefined,
      options: SLJsonOptions & {
        file?: string;
        currentDirectory?: string;
        changedPath: string[];
      },
    ) =>
      slRun(async () => {
        const action = ["list", "resolve", "validate"].includes(actionOrPath)
          ? actionOrPath
          : "resolve";
        const root = slRoot(
          action === "resolve" && actionOrPath !== "resolve"
            ? actionOrPath
            : pathValue ?? ".",
        );
        const catalog = await slLoadScopeCatalog(root);
        if (action === "list") {
          const scopes = catalog.scopes.map((scope) => ({
            ...scope,
            state: slScopeDescriptor(scope),
          }));
          slPrintObject(
            scopes,
            options.json ?? false,
            scopes
              .map(
                (scope) =>
                  `${scope.id} ${scope.kind} ${scope.state.path}`,
              )
              .join("\n"),
          );
          return;
        }
        if (action === "validate") {
          console.log(
            options.json
              ? JSON.stringify({ valid: true, scopeCount: catalog.scopes.length })
              : `SL scope catalog valid (${catalog.scopes.length} scopes).`,
          );
          return;
        }
        const selectedModes = [
          options.file !== undefined,
          options.currentDirectory !== undefined,
          options.changedPath.length > 0,
        ].filter(Boolean).length;
        if (selectedModes > 1) {
          throw new Error(
            "Choose exactly one of --file, --current-directory, or --changed-path.",
          );
        }

        const resolver = new SLScopeResolver(catalog);
        const result =
          options.changedPath.length > 0
            ? resolver.resolveChangedPaths(root, options.changedPath)
            : options.file !== undefined
              ? resolver.resolvePath(root, options.file)
              : resolver.resolveCurrentDirectory(
                  root,
                  options.currentDirectory ?? process.cwd(),
                );
        slPrintObject(
          result,
          options.json ?? false,
          "primaryScopeId" in result
            ? `${result.normalizedPath || "."}: ${result.orderedScopeIds.join(" -> ")}`
            : result.paths
                .map(
                  (path) =>
                    `${path.normalizedPath || "."}: ${path.orderedScopeIds.join(" -> ")}`,
                )
                .join("\n"),
        );
      }),
  );

program
  .command("capture [path]")
  .description("Create and register a new verified lesson skeleton")
  .requiredOption("--title <title>", "Lesson title")
  .addOption(
    new Option("--kind <kind>", "Lesson kind")
      .choices(["win", "pitfall", "mixed"])
      .default("win"),
  )
  .option("--state-scope <path>", "Repository-relative monorepo state scope")
  .option("--state-scope-id <id>", "Stable state scope identifier")
  .option(
    "--scope <scope>",
    "SL-SCOPE-* control-plane scope, or legacy lesson scope text",
  )
  .option("--lesson-scope <scope>", "Human-readable lesson scope metadata")
  .option("--target-path <path>", "Infer the control-plane scope from a target path")
  .option("--trigger <trigger>", "Retrieval trigger", slCollect, [])
  .option("--dry-run", "Show changes without writing")
  .action(
    (
      pathValue = ".",
      options: SLDryRunOptions & {
        title: string;
        kind: "win" | "pitfall" | "mixed";
        scope?: string;
        lessonScope?: string;
        targetPath?: string;
        trigger: string[];
        stateScope?: string;
        stateScopeId?: string;
      },
    ) =>
      slRun(async () => {
        const scopeId = options.scope?.startsWith("SL-SCOPE-")
          ? options.scope
          : undefined;
        const lessonScope =
          options.lessonScope ??
          (scopeId ? scopeId : options.scope) ??
          "repository";
        const result = await slCaptureLesson(slRoot(pathValue), {
          title: options.title,
          kind: options.kind,
          scope: lessonScope,
          triggers: options.trigger,
          dryRun: options.dryRun ?? false,
          ...(scopeId ? { scopeId } : {}),
          ...(options.targetPath ? { targetPath: options.targetPath } : {}),
          ...(options.stateScope
            ? {
                stateScope: {
                  id:
                    options.stateScopeId ??
                    (slSlugify(options.stateScope) || "scope"),
                  path: options.stateScope,
                },
              }
            : {}),
        });
        console.log(`${result.id} -> ${result.path}`);
        slPrintChanges(result.changes);
      }),
  );

program
  .command("vote <id> [path]")
  .description("Record an immutable verified lesson usage outcome")
  .addOption(
    new Option("--result <result>", "Reuse outcome")
      .choices(["useful", "not-useful"])
      .default("useful"),
  )
  .option("--useful", "Shortcut for --result useful")
  .option("--not-useful", "Shortcut for --result not-useful")
  .option("--task-run-id <id>", "Task or run correlation ID")
  .option("--application-id <id>", "Stable application ID for retry deduplication")
  .option("--idempotency-key <key>", "Stable command idempotency key")
  .option("--verifier-type <type>", "Verifier type", "lesson-vote")
  .option("--evidence-ref <ref>", "Opaque evidence reference without source content")
  .option("--scope <scope-id>", "Application source scope")
  .option("--target-path <path>", "Infer the application source scope")
  .option("--dry-run", "Show changes without writing")
  .action(
    (
      id: string,
      pathValue = ".",
      options: SLDryRunOptions & {
        result: "useful" | "not-useful";
        useful?: boolean;
        notUseful?: boolean;
        taskRunId?: string;
        applicationId?: string;
        idempotencyKey?: string;
        verifierType: string;
        evidenceRef?: string;
        scope?: string;
        targetPath?: string;
      },
    ) =>
      slRun(async () => {
        const root = slRoot(pathValue);
        if (options.useful && options.notUseful) {
          throw new Error("Choose either --useful or --not-useful, not both.");
        }
        const result = options.notUseful
          ? "not-useful"
          : options.useful
            ? "useful"
            : options.result;
        const applicationScope = await slOptionalScope(
          root,
          options.scope,
          options.targetPath,
        );
        const changes = await slVoteOnLesson(
          root,
          id,
          result,
          options.dryRun ?? false,
          new Date(),
          {
            ...(options.taskRunId ? { taskRunId: options.taskRunId } : {}),
            ...(options.applicationId
              ? { applicationId: options.applicationId }
              : {}),
            ...(options.idempotencyKey
              ? { idempotencyKey: options.idempotencyKey }
              : {}),
            verifierType: options.verifierType,
            ...(options.evidenceRef
              ? { evidenceRef: options.evidenceRef }
              : {}),
            ...(applicationScope ? { scope: applicationScope } : {}),
          },
        );
        slPrintChanges(changes);
      }),
  );

program
  .command("usage <id> [path]")
  .description("Project immutable usage events for an artifact")
  .action((id: string, pathValue = ".") =>
    slRun(async () => {
      const projections = await slProjectUsage(slRoot(pathValue), id);
      console.log(JSON.stringify(projections, null, 2));
    }),
  );

const useCommand = program
  .command("use")
  .description("Record an immutable artifact application lifecycle");

useCommand
  .command("start <artifact-id> [path]")
  .description("Record selection and application, returning a finish receipt")
  .option("--application-id <id>", "Stable application ID for automation")
  .option("--task-run-id <id>", "Stable task or run correlation ID")
  .option("--idempotency-key <key>", "Stable start idempotency key")
  .option("--scope <scope-id>", "Application source scope")
  .option("--target-path <path>", "Infer the application source scope")
  .option("--dry-run", "Show event and projection changes without writing")
  .option("--json", "Print deterministic JSON output")
  .action(
    (
      artifactId: string,
      pathValue = ".",
      options: SLJsonOptions & {
        applicationId?: string;
        taskRunId?: string;
        idempotencyKey?: string;
        scope?: string;
        targetPath?: string;
        dryRun?: boolean;
      },
    ) =>
      slRun(async () => {
        const root = slRoot(pathValue);
        const applicationScope = await slOptionalScope(
          root,
          options.scope,
          options.targetPath,
        );
        const result = await slStartUsage(root, artifactId, {
          ...(options.applicationId
            ? { applicationId: options.applicationId }
            : {}),
          ...(options.taskRunId ? { taskRunId: options.taskRunId } : {}),
          ...(options.idempotencyKey
            ? { idempotencyKey: options.idempotencyKey }
            : {}),
          ...(applicationScope ? { scope: applicationScope } : {}),
          dryRun: options.dryRun ?? false,
        });
        slPrintObject(
          result,
          (options.json ?? false) || (options.dryRun ?? false),
          [
            `artifactId=${result.artifactId}`,
            `applicationId=${result.applicationId}`,
            `taskRunId=${result.taskRunId}`,
            `receiptId=${result.receiptId}`,
            `artifactVersion=${result.artifactVersion}`,
            `selected=${result.changes[0]?.action ?? "unknown"}`,
            `applied=${result.changes[1]?.action ?? "unknown"}`,
          ].join(" "),
        );
      }),
  );

useCommand
  .command("finish <receipt-or-application-id> [path]")
  .description("Record an artifact application outcome and verification state")
  .addOption(
    new Option("--outcome <outcome>", "Application outcome")
      .choices(["success", "failure", "partial", "unknown"])
      .makeOptionMandatory(),
  )
  .option("--verified", "Declare the outcome verified")
  .option(
    "--verifier-type <type>",
    "Verifier type; required with --verified",
  )
  .option("--evidence-ref <ref>", "Opaque evidence reference")
  .option("--idempotency-key <key>", "Stable finish idempotency key")
  .option("--dry-run", "Show event and projection changes without writing")
  .option("--json", "Print deterministic JSON output")
  .action(
    (
      reference: string,
      pathValue = ".",
      options: SLJsonOptions & {
        outcome: "success" | "failure" | "partial" | "unknown";
        verified?: boolean;
        verifierType?: string;
        evidenceRef?: string;
        idempotencyKey?: string;
        dryRun?: boolean;
      },
    ) =>
      slRun(async () => {
        const result = await slFinishUsage(slRoot(pathValue), reference, {
          outcome: options.outcome,
          verified: options.verified ?? false,
          ...(options.verifierType
            ? { verifierType: options.verifierType }
            : {}),
          ...(options.evidenceRef
            ? { evidenceRef: options.evidenceRef }
            : {}),
          ...(options.idempotencyKey
            ? { idempotencyKey: options.idempotencyKey }
            : {}),
          dryRun: options.dryRun ?? false,
        });
        slPrintObject(
          result,
          (options.json ?? false) || (options.dryRun ?? false),
          [
            `artifactId=${result.artifactId}`,
            `applicationId=${result.applicationId}`,
            `receiptId=${result.receiptId}`,
            `outcome=${result.outcome}`,
            `verified=${String(result.verified)}`,
            `verifierType=${result.verifierType}`,
            `action=${result.change.action}`,
          ].join(" "),
        );
      }),
  );

program
  .command("project [path]")
  .description("Rebuild registry usage projections and the discovery index")
  .option("--dry-run", "Show projection changes without writing")
  .action((pathValue = ".", options: SLDryRunOptions) =>
    slRun(async () => {
      const changes: SLChange[] = [];
      await slSynchronizeUsageProjection(
        slRoot(pathValue),
        options.dryRun ?? false,
        changes,
      );
      slPrintChanges(changes);
    }),
  );

program
  .command("stats [artifact-id] [path]")
  .description("Show version-specific immutable usage statistics")
  .option("--json", "Print deterministic JSON output")
  .option("--scope <scope-id>", "Filter statistics to one source scope")
  .addOption(
    new Option("--aggregate <view>", "Aggregation view")
      .choices(["artifact", "scope", "repository"])
      .default("artifact"),
  )
  .action(
    (
      artifactIdValue: string | undefined,
      pathValue: string | undefined,
      options: SLJsonOptions & {
        aggregate: "artifact" | "scope" | "repository";
        scope?: string;
      },
    ) =>
      slRun(async () => {
        const artifactId =
          artifactIdValue?.startsWith("SL-") ? artifactIdValue : undefined;
        const rootPath =
          artifactId === artifactIdValue
            ? pathValue ?? "."
            : artifactIdValue ?? pathValue ?? ".";
        const projections = (
          await slProjectUsage(slRoot(rootPath), artifactId)
        ).filter(
          (projection) =>
            !options.scope || projection.scope.id === options.scope,
        );
        const output =
          options.aggregate === "scope"
            ? slAggregateUsageByScope(projections)
            : options.aggregate === "repository"
              ? slAggregateUsageRepository(projections)
              : projections;
        if (options.json) {
          console.log(JSON.stringify(output, null, 2));
          return;
        }
        if (options.aggregate !== "artifact") {
          console.log(JSON.stringify(output, null, 2));
          return;
        }
        if (projections.length === 0) {
          console.log("No usage events found.");
          return;
        }
        for (const projection of projections) {
          console.log(
            [
              `artifactId=${projection.artifactId}`,
              `scope=${projection.scope.id}:${projection.scope.path}`,
              `artifactVersion=${projection.artifactVersion}`,
              `retrievals=${projection.retrievalCount}`,
              `applications=${projection.applicationCount}`,
              `resolved=${projection.resolvedCount}`,
              `unknown=${projection.unknownCount}`,
              `verifiedSuccess=${projection.verifiedSuccessCount}`,
              `verifiedFailure=${projection.verifiedFailureCount}`,
              `verifiedSuccessRate=${
                projection.verifiedSuccessRate === null
                  ? "n/a"
                  : projection.verifiedSuccessRate.toFixed(6)
              }`,
            ].join(" "),
          );
        }
      }),
  );

program
  .command("retrieve [path]")
  .description("Resolve and retrieve active SL artifacts for a repository path")
  .requiredOption("--path <target-path>", "Repository path needing guidance")
  .option("--trigger <trigger>", "Filter by an exact retrieval trigger")
  .option("--json", "Print deterministic JSON output")
  .action(
    (
      pathValue = ".",
      options: SLJsonOptions & {
        path: string;
        trigger?: string;
      },
    ) =>
      slRun(async () => {
        const result = await slRetrieveArtifacts(
          slRoot(pathValue),
          options.path,
          options.trigger,
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(
          `${result.path || "."}: ${result.orderedScopeIds.join(" -> ")}`,
        );
        for (const artifact of result.artifacts) {
          console.log(
            [
              `artifactId=${artifact.id}`,
              `scope=${artifact.scope.id}`,
              `precedence=${artifact.precedence}`,
              `relation=${artifact.relation}`,
              `path=${artifact.path}`,
              `provenance=${artifact.provenance.join(",") || "none"}`,
            ].join(" "),
          );
        }
      }),
  );

program
  .command("evaluate <artifact-id-or-path> [path]")
  .description("Evaluate a promoted artifact validation contract")
  .option(
    "--execute-checks",
    "Explicitly opt in to contract executable checks",
  )
  .option("--dry-run", "Do not execute configured commands")
  .option("--json", "Print deterministic JSON output")
  .action(
    (
      artifactIdOrPath: string,
      pathValue = ".",
      options: SLJsonOptions & {
        executeChecks?: boolean;
        dryRun?: boolean;
      },
    ) =>
      slRun(async () => {
        const root = slRoot(pathValue);
        const artifactId = await slEvaluationArtifactId(
          root,
          artifactIdOrPath,
        );
        const result = await slEvaluate(root, artifactId, {
          executeCommands: options.executeChecks ?? false,
          dryRun: options.dryRun ?? false,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(
            [
              `artifactId=${result.artifactId}`,
              `status=${result.status}`,
              `executableChecksRequested=${String(
                result.executableChecksRequested,
              )}`,
            ].join(" "),
          );
          for (const check of result.checks) {
            console.log(
              `check=${check.id} kind=${check.kind} status=${check.status} message=${JSON.stringify(check.message)}`,
            );
          }
        }
        if (result.status === "failed") {
          process.exitCode = 1;
        }
      }),
  );

program
  .command("promote <id> <artifactPath> [path]")
  .description("Register an agent-authored instruction or skill as a promotion")
  .option("--target-scope <scope-id>", "Promotion target scope; defaults to source scope")
  .option("--dry-run", "Show changes without writing")
  .action(
    (
      id: string,
      artifactPath: string,
      pathValue = ".",
      options: SLDryRunOptions & { targetScope?: string },
    ) =>
      slRun(async () => {
        const changes = await slRegisterPromotion(
          slRoot(pathValue),
          id,
          artifactPath,
          options.dryRun ?? false,
          new Date(),
          {
            ...(options.targetScope
              ? { targetScopeId: options.targetScope }
              : {}),
          },
        );
        slPrintChanges(changes);
      }),
  );

program
  .command("promotion-evaluate <id> [path]")
  .description("Evaluate governed activation gates for a probation artifact")
  .requiredOption("--approval-ref <ref>", "Opaque repository review reference")
  .option("--target-scope <scope-id>", "Evaluate for this promotion target scope")
  .option("--execute-checks", "Run configured bounded executable checks")
  .option("--dry-run", "Evaluate without persisting results or running commands")
  .option("--json", "Print deterministic JSON output")
  .action(
    (
      id: string,
      pathValue = ".",
      options: SLDryRunOptions &
        SLJsonOptions & {
          approvalRef: string;
          targetScope?: string;
          executeChecks?: boolean;
        },
    ) =>
      slRun(async () => {
        const root = slRoot(pathValue);
        const config = await slLoadConfig(root);
        const governance =
          config.promotion.mode === "monorepo"
            ? await slBuildPromotionGovernanceContext(root, id, {
                ...(options.targetScope
                  ? { targetScopeId: options.targetScope }
                  : {}),
                ownerApprovalRefs: [options.approvalRef],
              })
            : undefined;
        const result = await slEvaluatePromotionReadiness(
          root,
          id,
          {
            ...(governance
              ? { governance }
              : {
                  approval: {
                    kind: "repository-review" as const,
                    evidenceRef: options.approvalRef,
                  },
                }),
            executeCommands: options.executeChecks ?? false,
            dryRun: options.dryRun ?? false,
          },
        );
        slPrintObject(
          result,
          options.json ?? false,
          `artifactId=${id} status=${result.evaluation.status}`,
        );
        if (result.evaluation.status === "failed") {
          process.exitCode = 1;
        }
      }),
  );

program
  .command("promotion-activate <id> [path]")
  .description("Activate a probation artifact with a current passing evaluation")
  .option("--target-scope <scope-id>", "Revalidate this promotion target scope")
  .option("--owner-approval-ref <ref>", "Current target owner approval reference")
  .option("--dry-run", "Show activation changes without writing")
  .action(
    (
      id: string,
      pathValue = ".",
      options: SLDryRunOptions & {
        targetScope?: string;
        ownerApprovalRef?: string;
      },
    ) =>
      slRun(async () => {
        const root = slRoot(pathValue);
        const registry = await slLoadRegistry(root);
        const artifact = registry.artifacts.find(
          (candidate) => candidate.id === id,
        );
        const recordedGovernance =
          artifact?.promotionEvaluation?.governance;
        const governance = recordedGovernance
          ? await slBuildPromotionGovernanceContext(root, id, {
              targetScopeId:
                options.targetScope ?? recordedGovernance.targetScope.id,
              ownerApprovalRefs: options.ownerApprovalRef
                ? [options.ownerApprovalRef]
                : recordedGovernance.ownerApprovals.map(
                    (approval) => approval.evidenceRef,
                  ),
            })
          : undefined;
        const changes = await slActivatePromotion(
          root,
          id,
          options.dryRun ?? false,
          new Date(),
          governance ? { governance } : {},
        );
        slPrintChanges(changes);
      }),
  );

program
  .command("forget <id> [path]")
  .description("Quarantine or restore an SL-managed artifact")
  .addOption(
    new Option("--reason <reason>", "Forgetting reason")
      .choices(["wrong", "irrelevant", "superseded"])
      .default("irrelevant"),
  )
  .option("--undo", "Restore a quarantined artifact")
  .option("--dry-run", "Show changes without writing")
  .action(
    (
      id: string,
      pathValue = ".",
      options: SLDryRunOptions & {
        reason: "wrong" | "irrelevant" | "superseded";
        undo?: boolean;
      },
    ) =>
      slRun(async () => {
        const result = options.undo
          ? await slRestoreArtifact(
              slRoot(pathValue),
              id,
              options.dryRun ?? false,
            )
          : await slForgetArtifact(
              slRoot(pathValue),
              id,
              options.reason,
              options.dryRun ?? false,
            );
        slPrintChanges(result.changes);
      }),
  );

program
  .command("sweep [path]")
  .description("Apply stale, quarantine, and deletion policy")
  .option("--dry-run", "Show changes without writing")
  .option("--now <timestamp>", "Override current time for deterministic diagnostics")
  .action(
    (
      pathValue = ".",
      options: SLDryRunOptions & { now?: string },
    ) =>
      slRun(async () => {
        const now = options.now ? new Date(options.now) : new Date();
        if (Number.isNaN(now.getTime())) {
          throw new Error("--now must be a valid ISO timestamp.");
        }
        const result = await slSweep(
          slRoot(pathValue),
          options.dryRun ?? false,
          now,
        );
        slPrintChanges(result.changes);
      }),
  );

await program.parseAsync();
