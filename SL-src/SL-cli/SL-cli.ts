#!/usr/bin/env node
import { resolve } from "node:path";
import { Command, Option } from "commander";
import { slCaptureLesson } from "../SL-core/SL-capture.js";
import { slInstall } from "../SL-core/SL-installer.js";
import { slRegisterPromotion } from "../SL-core/SL-promotion.js";
import { slLoadRegistry } from "../SL-core/SL-registry.js";
import type { SLChange } from "../SL-core/SL-types.js";
import { slPrintChanges } from "../SL-core/SL-utils.js";
import { slVoteOnLesson } from "../SL-core/SL-vote.js";
import {
  slForgetArtifact,
  slRestoreArtifact,
  slSweep,
} from "../SL-forgetting/SL-forgetting.js";
import { slWriteIndex } from "../SL-index/SL-index.js";
import { slValidateRepository } from "../SL-validation/SL-validation.js";

interface SLDryRunOptions {
  dryRun?: boolean;
}

function slRoot(pathValue: string): string {
  return resolve(pathValue);
}

function slCollect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function slRun(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const program = new Command()
  .name("sl-repo")
  .description("Repository-local self-learning lifecycle")
  .version("0.1.0");

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
      const registry = await slLoadRegistry(root);
      const changes: SLChange[] = [];
      await slWriteIndex(root, registry, options.dryRun ?? false, changes);
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
  .command("capture [path]")
  .description("Create and register a new verified lesson skeleton")
  .requiredOption("--title <title>", "Lesson title")
  .addOption(
    new Option("--kind <kind>", "Lesson kind")
      .choices(["win", "pitfall", "mixed"])
      .default("win"),
  )
  .requiredOption("--scope <scope>", "Repository-defined scope")
  .option("--trigger <trigger>", "Retrieval trigger", slCollect, [])
  .option("--dry-run", "Show changes without writing")
  .action(
    (
      pathValue = ".",
      options: SLDryRunOptions & {
        title: string;
        kind: "win" | "pitfall" | "mixed";
        scope: string;
        trigger: string[];
      },
    ) =>
      slRun(async () => {
        const result = await slCaptureLesson(slRoot(pathValue), {
          title: options.title,
          kind: options.kind,
          scope: options.scope,
          triggers: options.trigger,
          dryRun: options.dryRun ?? false,
        });
        console.log(`${result.id} -> ${result.path}`);
        slPrintChanges(result.changes);
      }),
  );

program
  .command("vote <id> [path]")
  .description("Record whether a retrieved lesson was useful")
  .addOption(
    new Option("--result <result>", "Reuse outcome")
      .choices(["useful", "not-useful"])
      .default("useful"),
  )
  .option("--useful", "Shortcut for --result useful")
  .option("--not-useful", "Shortcut for --result not-useful")
  .option("--dry-run", "Show changes without writing")
  .action(
    (
      id: string,
      pathValue = ".",
      options: SLDryRunOptions & {
        result: "useful" | "not-useful";
        useful?: boolean;
        notUseful?: boolean;
      },
    ) =>
      slRun(async () => {
        if (options.useful && options.notUseful) {
          throw new Error("Choose either --useful or --not-useful, not both.");
        }
        const result = options.notUseful
          ? "not-useful"
          : options.useful
            ? "useful"
            : options.result;
        const changes = await slVoteOnLesson(
          slRoot(pathValue),
          id,
          result,
          options.dryRun ?? false,
        );
        slPrintChanges(changes);
      }),
  );

program
  .command("promote <id> <artifactPath> [path]")
  .description("Register an agent-authored instruction or skill as a promotion")
  .option("--dry-run", "Show changes without writing")
  .action(
    (id: string, artifactPath: string, pathValue = ".", options: SLDryRunOptions) =>
      slRun(async () => {
        const changes = await slRegisterPromotion(
          slRoot(pathValue),
          id,
          artifactPath,
          options.dryRun ?? false,
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
