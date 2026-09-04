import { execFileSync, spawnSync } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slRegisterPromotion } from "../../SL-src/SL-core/SL-promotion.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";
import {
  slCreateTestContract,
  slTestContractPath,
  slWriteTestJson,
  slWriteTestPromotedArtifact,
} from "../SL-fixtures/SL-validation-contract.js";

const repositories: string[] = [];
const cliPath = resolve("dist/SL-src/SL-cli/SL-cli.js");
const FIXED_NOW = new Date("2026-09-03T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

function runCli(argumentsList: string[]): string {
  return execFileSync(process.execPath, [cliPath, ...argumentsList], {
    encoding: "utf8",
    timeout: 30_000,
  });
}

function runCliResult(argumentsList: string[], timeout = 20_000) {
  return spawnSync(process.execPath, [cliPath, ...argumentsList], {
    encoding: "utf8",
    timeout,
  });
}

async function prepareLesson(root: string, title: string): Promise<string> {
  await slInstall(root, "init", false);
  return (
    await slCaptureLesson(root, {
      title,
      kind: "win",
      scope: "tests",
      triggers: [title.toLowerCase()],
      dryRun: false,
      now: FIXED_NOW,
    })
  ).id;
}

async function preparePromotedArtifact(
  root: string,
  artifactId: string,
  executableChecks: ReturnType<typeof slCreateTestContract>["executableChecks"],
): Promise<string> {
  await slInstall(root, "init", false);
  const source = await slCaptureLesson(root, {
    title: `${artifactId} source`,
    kind: "win",
    scope: "cli-evaluation",
    triggers: [artifactId.toLowerCase()],
    dryRun: false,
    now: FIXED_NOW,
  });
  const artifactPath = `.github/skills/${artifactId}/SKILL.md`;
  const contractPath = slTestContractPath(artifactId);
  await slWriteTestPromotedArtifact({
    root,
    artifactId,
    artifactType: "skill",
    artifactPath,
    contractPath,
  });
  await slWriteTestJson(
    root,
    contractPath,
    slCreateTestContract({
      artifactId,
      artifactType: "skill",
      artifactPath,
      sourceIds: [source.id],
      ...(executableChecks ? { executableChecks } : {}),
    }),
  );
  await slRegisterPromotion(
    root,
    source.id,
    artifactPath,
    false,
    FIXED_NOW,
  );
  return artifactPath;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("sl-repo CLI", () => {
  test("exposes commands required by consumer workflows", () => {
    const help = runCli(["--help"]);

    expect(help).toContain("validate");
    expect(help).toContain("scope");
    expect(help).toContain("sweep");
    expect(runCli(["validate", "--help"])).toContain(
      "Validate SL schemas, ownership, links, safety, and index state",
    );
    expect(runCli(["sweep", "--help"])).toContain(
      "Apply stale, quarantine, and deletion policy",
    );
    expect(runCli(["scope", "--help"])).toContain(
      "Resolve hierarchical SL scopes",
    );
  });

  test("resolves scope catalogs through the CLI", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    await writeFile(
      join(root, ".github", "SL-learning", "SL-scope-catalog.json"),
      JSON.stringify({
        schemaVersion: 1,
        scopes: [
          {
            id: "SL-SCOPE-ROOT",
            displayName: "Repository",
            kind: "repository",
            includePaths: ["**"],
            excludePaths: [],
            dependencyScopeIds: [],
            ownerAliases: [],
          },
          {
            id: "SL-SCOPE-SERVICE",
            displayName: "Service",
            kind: "service",
            includePaths: ["services/api/**"],
            excludePaths: [],
            parentScopeId: "SL-SCOPE-ROOT",
            dependencyScopeIds: [],
            ownerAliases: ["@example/api"],
          },
        ],
      }),
      "utf8",
    );
    await rm(join(root, ".github", "SL-learning", "SL-scope-catalog.yml"));

    const result = JSON.parse(
      runCli([
        "scope",
        root,
        "--file",
        "services\\api\\handler.ts",
        "--json",
      ]),
    ) as { primaryScopeId: string; orderedScopeIds: string[] };

    expect(result).toMatchObject({
      primaryScopeId: "SL-SCOPE-SERVICE",
      orderedScopeIds: ["SL-SCOPE-SERVICE", "SL-SCOPE-ROOT"],
    });
  });

  test(
    "installs, captures, and validates a repository",
    async () => {
      const root = await slCreateTestRepository();
      repositories.push(root);

      expect(runCli(["init", root])).toContain(
        ".github/SL-learning/SL-config.yml",
      );
      const captureOutput = runCli([
          "capture",
          root,
          "--title",
          "CLI verified lesson",
          "--kind",
          "win",
          "--scope",
          "tests",
          "--trigger",
          "cli verification",
        ]);
      expect(captureOutput).toContain("SL-");
      const lessonId = captureOutput.split(/\s+/).find((value) =>
        value.startsWith("SL-202"),
      );
      if (!lessonId) {
        throw new Error("CLI output did not contain a lesson ID.");
      }
      expect(
        runCli([
          "vote",
          lessonId,
          root,
          "--useful",
          "--task-run-id",
          "cli-task",
          "--application-id",
          "cli-application",
          "--idempotency-key",
          "cli-vote",
        ]),
      ).toContain("/SL-usage-events/");
      expect(runCli(["usage", lessonId, root])).toContain(
        '"verifiedSuccessCount": 1',
      );
      expect(runCli(["validate", root])).toContain("SL validation passed.");

      const registry = await slLoadRegistry(root);
      expect(
        registry.artifacts.some(
          (artifact) => artifact.classification === "evidence",
        ),
      ).toBe(true);
    },
    120_000,
  );

  test(
    "records generated and supplied usage IDs with deterministic statistics",
    async () => {
      const root = await slCreateTestRepository();
      repositories.push(root);
      const lessonId = await prepareLesson(root, "CLI usage lifecycle");

      const generated = JSON.parse(
        runCli(["use", "start", lessonId, root, "--json"]),
      ) as {
        applicationId: string;
        receiptId: string;
      };
      expect(generated.applicationId).toMatch(/^usage-[0-9a-f-]{36}$/);
      const unverified = JSON.parse(
        runCli([
          "use",
          "finish",
          generated.receiptId,
          root,
          "--outcome",
          "success",
          "--verifier-type",
          "self-report",
          "--json",
        ]),
      ) as { verified: boolean };
      expect(unverified.verified).toBe(false);

      const suppliedArguments = [
        "use",
        "start",
        lessonId,
        root,
        "--application-id",
        "cli-supplied-application",
        "--task-run-id",
        "cli-supplied-task",
        "--idempotency-key",
        "cli-supplied-start",
        "--json",
      ];
      const supplied = JSON.parse(runCli(suppliedArguments)) as {
        applicationId: string;
        changes: Array<{ action: string }>;
      };
      const suppliedRetry = JSON.parse(runCli(suppliedArguments)) as {
        changes: Array<{ action: string }>;
      };
      expect(supplied.applicationId).toBe("cli-supplied-application");
      expect(
        suppliedRetry.changes.slice(0, 2).map((change) => change.action),
      ).toEqual(["skip", "skip"]);
      runCli([
        "use",
        "finish",
        supplied.applicationId,
        root,
        "--outcome",
        "failure",
        "--verified",
        "--verifier-type",
        "test-suite",
        "--evidence-ref",
        "ci:usage-failure",
        "--idempotency-key",
        "cli-supplied-finish",
        "--json",
      ]);
      const finishRetry = JSON.parse(
        runCli([
          "use",
          "finish",
          supplied.applicationId,
          root,
          "--outcome",
          "failure",
          "--verified",
          "--verifier-type",
          "test-suite",
          "--evidence-ref",
          "ci:usage-failure",
          "--idempotency-key",
          "cli-supplied-finish",
          "--json",
        ]),
      ) as { change: { action: string } };
      expect(finishRetry.change.action).toBe("skip");

      const stats = JSON.parse(
        runCli(["stats", lessonId, root, "--json"]),
      ) as Array<{
        retrievalCount: number;
        applicationCount: number;
        resolvedCount: number;
        unknownCount: number;
        verifiedSuccessCount: number;
        verifiedFailureCount: number;
        verifiedSuccessRate: number | null;
      }>;
      expect(stats).toHaveLength(1);
      expect(stats[0]).toMatchObject({
        retrievalCount: 2,
        applicationCount: 2,
        resolvedCount: 1,
        unknownCount: 1,
        verifiedSuccessCount: 0,
        verifiedFailureCount: 1,
        verifiedSuccessRate: 0,
      });
    },
    90_000,
  );

  test(
    "prints complete side-effect-free usage dry-run plans",
    async () => {
      const root = await slCreateTestRepository();
      repositories.push(root);
      const lessonId = await prepareLesson(root, "CLI dry-run plan");

      const plannedStart = JSON.parse(
        runCli([
          "use",
          "start",
          lessonId,
          root,
          "--application-id",
          "cli-dry-run",
          "--task-run-id",
          "cli-dry-run-task",
          "--idempotency-key",
          "cli-dry-run-start",
          "--dry-run",
        ]),
      ) as {
        events: {
          selected: { stage: string };
          applied: { stage: string };
        };
        changes: Array<{ action: string; path: string }>;
      };
      expect(plannedStart.events).toMatchObject({
        selected: { stage: "selected" },
        applied: { stage: "applied" },
      });
      expect(plannedStart.changes.map((change) => change.path)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("SL-usage-events"),
          expect.stringContaining("SL-registry.json"),
          expect.stringContaining("SL-index.json"),
          expect.stringContaining("SL-usage-projection.json"),
        ]),
      );
      expect(
        plannedStart.changes.filter((change) =>
          change.path.includes("SL-usage-events"),
        ),
      ).toHaveLength(2);

      const emptyStats = JSON.parse(
        runCli(["stats", lessonId, root, "--json"]),
      ) as unknown[];
      expect(emptyStats).toEqual([]);

      const started = JSON.parse(
        runCli([
          "use",
          "start",
          lessonId,
          root,
          "--application-id",
          "cli-dry-run",
          "--task-run-id",
          "cli-dry-run-task",
          "--idempotency-key",
          "cli-dry-run-start",
          "--json",
        ]),
      ) as { receiptId: string };
      const plannedFinish = JSON.parse(
        runCli([
          "use",
          "finish",
          started.receiptId,
          root,
          "--outcome",
          "success",
          "--verified",
          "--verifier-type",
          "test-suite",
          "--evidence-ref",
          "ci:cli-dry-run",
          "--idempotency-key",
          "cli-dry-run-finish",
          "--dry-run",
        ]),
      ) as {
        event: { stage: string; outcome: string };
        changes: Array<{ action: string; path: string }>;
      };
      expect(plannedFinish.event).toMatchObject({
        stage: "verified",
        outcome: "success",
      });
      expect(plannedFinish.changes.map((change) => change.path)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("SL-usage-events"),
          expect.stringContaining("SL-registry.json"),
          expect.stringContaining("SL-index.json"),
          expect.stringContaining("SL-usage-projection.json"),
        ]),
      );
      const unfinishedStats = JSON.parse(
        runCli(["stats", lessonId, root, "--json"]),
      ) as Array<{ resolvedCount: number; unknownCount: number }>;
      expect(unfinishedStats).toEqual([
        expect.objectContaining({
          resolvedCount: 0,
          unknownCount: 1,
        }),
      ]);
    },
    30_000,
  );

  test("returns nonzero exit codes for invalid usage transitions", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lessonId = await prepareLesson(
      root,
      "CLI invalid usage transitions",
    );
    const started = JSON.parse(
      runCli([
        "use",
        "start",
        lessonId,
        root,
        "--application-id",
        "cli-invalid-transition",
        "--json",
      ]),
    ) as { applicationId: string };

    const missingVerifier = runCliResult([
      "use",
      "finish",
      started.applicationId,
      root,
      "--outcome",
      "success",
      "--verified",
      "--json",
    ]);
    expect(missingVerifier.status).toBe(1);
    expect(missingVerifier.stderr).toContain(
      "--verified requires an explicit --verifier-type declaration.",
    );

    runCli([
      "use",
      "finish",
      started.applicationId,
      root,
      "--outcome",
      "success",
      "--verified",
      "--verifier-type",
      "test-suite",
      "--json",
    ]);
    const conflicting = runCliResult([
      "use",
      "finish",
      started.applicationId,
      root,
      "--outcome",
      "failure",
      "--verified",
      "--verifier-type",
      "test-suite",
      "--json",
    ]);
    expect(conflicting.status).toBe(1);
    expect(conflicting.stderr).toContain("already has a conflicting outcome");
  });

  test("evaluates statically by default and resolves an artifact path", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const artifactId = "SL-CLI-STATIC-EVALUATION";
    const scriptPath = "SL-contract-checks/SL-static-marker.mjs";
    await mkdir(dirname(join(root, scriptPath)), { recursive: true });
    await writeFile(
      join(root, scriptPath),
      'import { writeFileSync } from "node:fs"; writeFileSync("SL-static-marker.txt", "ran");\n',
      "utf8",
    );
    const artifactPath = await preparePromotedArtifact(root, artifactId, [
      {
        id: "static-marker",
        command: "node",
        arguments: [scriptPath],
        timeoutMs: 1000,
        expectedExitCode: 0,
      },
    ]);

    const evaluation = runCliResult([
      "evaluate",
      artifactPath,
      root,
      "--json",
    ]);
    expect(evaluation.status, evaluation.stderr || evaluation.stdout).toBe(0);
    const result = JSON.parse(evaluation.stdout) as {
      status: string;
      executableChecksRequested: boolean;
      checks: Array<{ id: string; status: string }>;
    };
    expect(result.status).toBe("passed");
    expect(result.executableChecksRequested).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "executable:static-marker",
        status: "skipped",
      }),
    );
    expect(await pathExists(join(root, "SL-static-marker.txt"))).toBe(false);
  });

  test("returns identical evaluation JSON for Windows and POSIX path forms", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const artifactId = "SL-CLI-PATH-NORMALIZATION";
    const artifactPath = await preparePromotedArtifact(
      root,
      artifactId,
      undefined,
    );

    const posix = runCli([
      "evaluate",
      artifactPath,
      root,
      "--json",
    ]);
    const windows = runCli([
      "evaluate",
      artifactPath.replaceAll("/", "\\"),
      root,
      "--json",
    ]);

    expect(windows).toBe(posix);
    expect((JSON.parse(posix) as { artifactPath: string }).artifactPath).toBe(
      artifactPath,
    );
  });

  test(
    "runs opted-in executable checks and fails closed for errors and timeouts",
    async () => {
      const root = await slCreateTestRepository();
      repositories.push(root);
      const artifactId = "SL-CLI-EXECUTABLE-EVALUATION";
      const checksRoot = join(root, "SL-contract-checks");
      await mkdir(checksRoot, { recursive: true });
      await writeFile(
        join(checksRoot, "SL-pass.mjs"),
        "process.exit(0);\n",
        "utf8",
      );
      await writeFile(
        join(checksRoot, "SL-fail.mjs"),
        "process.exit(4);\n",
        "utf8",
      );
      await writeFile(
        join(checksRoot, "SL-timeout.mjs"),
        "setInterval(() => undefined, 1000);\n",
        "utf8",
      );
      await preparePromotedArtifact(root, artifactId, [
        {
          id: "pass",
          command: "node",
          arguments: ["SL-contract-checks/SL-pass.mjs"],
          timeoutMs: 5000,
          expectedExitCode: 0,
        },
        {
          id: "failure",
          command: "node",
          arguments: ["SL-contract-checks/SL-fail.mjs"],
          timeoutMs: 5000,
          expectedExitCode: 0,
        },
        {
          id: "timeout",
          command: "node",
          arguments: ["SL-contract-checks/SL-timeout.mjs"],
          timeoutMs: 250,
          expectedExitCode: 0,
        },
      ]);

      const evaluation = runCliResult(
        [
          "evaluate",
          artifactId,
          root,
          "--execute-checks",
          "--json",
        ],
        35_000,
      );
      expect(evaluation.status).toBe(1);
      const result = JSON.parse(evaluation.stdout) as {
        status: string;
        executableChecksRequested: boolean;
        checks: Array<{
          id: string;
          status: string;
          exitCode?: number | null;
          timedOut?: boolean;
        }>;
      };
      expect(result.status).toBe("failed");
      expect(result.executableChecksRequested).toBe(true);
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "executable:pass",
            status: "passed",
            exitCode: 0,
          }),
          expect.objectContaining({
            id: "executable:failure",
            status: "failed",
            exitCode: 4,
          }),
          expect.objectContaining({
            id: "executable:timeout",
            status: "failed",
            exitCode: null,
            timedOut: true,
          }),
        ]),
      );
    },
    45_000,
  );
});
