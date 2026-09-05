import { spawn, spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slCalculateEfficiencyReport } from "../../SL-src/SL-core/SL-efficiency.js";
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
const FIXED_DATE = "2026-09-05T10:00:00.000Z";
const TEST_TIMEOUT_MS = process.platform === "win32" ? 120_000 : 60_000;
const SUITE_TEST_TIMEOUT_MS =
  process.platform === "win32" ? 240_000 : 120_000;

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

function runtimePath(root: string): string {
  return join(root, ".github", "SL-learning", "SL-runtime", "SL.ps1");
}

function runRuntime(
  root: string,
  argumentsList: string[],
): ReturnType<typeof spawnSync> {
  return spawnSync(
    "pwsh",
    [
      "-NoLogo",
      "-NoProfile",
      "-File",
      runtimePath(root),
      "--json",
      ...argumentsList,
    ],
    { cwd: root, encoding: "utf8", timeout: TEST_TIMEOUT_MS },
  );
}

function jsonOutput(result: ReturnType<typeof spawnSync>): unknown {
  const stderr = String(result.stderr ?? "");
  const stdout = String(result.stdout ?? "");
  expect(result.status, stderr).toBe(0);
  return JSON.parse(stdout);
}

async function repositorySnapshot(root: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name === ".git") {
        continue;
      }
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        result.set(absolute.slice(root.length + 1), await readFile(absolute));
      }
    }
  }
  await visit(root);
  return result;
}

async function createPowerShellRepository(): Promise<string> {
  const root = await slCreateTestRepository();
  repositories.push(root);
  await slInstall(root, "init", false);
  return root;
}

describe("repository-local PowerShell lifecycle", () => {
  test(
    "runs capture, retrieve, usage, projection, promotion, validation, forget, and undo without Node",
    async () => {
      const root = await createPowerShellRepository();
      const capture = jsonOutput(
        runRuntime(root, [
          "capture",
          "--title",
          "PowerShell lifecycle evidence",
          "--kind",
          "win",
          "--trigger",
          "local-runtime",
          "--now",
          FIXED_DATE,
        ]),
      ) as { id: string };

      const retrieve = jsonOutput(
        runRuntime(root, [
          "retrieve",
          "--path",
          "src/example.ts",
          "--trigger",
          "LOCAL-RUNTIME",
        ]),
      ) as { artifacts: Array<{ id: string }> };
      expect(retrieve.artifacts.map((artifact) => artifact.id)).toEqual([
        capture.id,
      ]);

      const startArguments = [
        "use",
        "start",
        capture.id,
        "--application-id",
        "pwsh-application",
        "--task-run-id",
        "pwsh-task",
        "--idempotency-key",
        "pwsh-start",
        "--now",
        "2026-09-05T10:01:00.000Z",
      ];
      const started = jsonOutput(runRuntime(root, startArguments)) as {
        receiptId: string;
      };
      const retried = jsonOutput(runRuntime(root, startArguments)) as {
        changes: Array<{ action: string }>;
      };
      expect(retried.changes.slice(0, 2).map((change) => change.action)).toEqual(
        ["skip", "skip"],
      );

      const finishArguments = [
        "use",
        "finish",
        started.receiptId,
        "--outcome",
        "success",
        "--verified",
        "--verifier-type",
        "test-suite",
        "--evidence-ref",
        "run:pwsh-e2e",
        "--idempotency-key",
        "pwsh-finish",
        "--now",
        "2026-09-05T10:02:00.000Z",
      ];
      jsonOutput(runRuntime(root, finishArguments));
      expect(
        (
          jsonOutput(runRuntime(root, ["stats", capture.id])) as Array<{
            verifiedSuccessCount: number;
          }>
        )[0]?.verifiedSuccessCount,
      ).toBe(1);
      jsonOutput(runRuntime(root, ["project"]));

      const artifactId = "SL-POWERSHELL-E2E";
      const artifactPath =
        ".github/instructions/SL-POWERSHELL-E2E.instructions.md";
      const contractPath = slTestContractPath(artifactId);
      await slWriteTestPromotedArtifact({
        root,
        artifactId,
        artifactType: "instruction",
        artifactPath,
        contractPath,
      });
      await slWriteTestJson(
        root,
        contractPath,
        slCreateTestContract({
          artifactId,
          artifactType: "instruction",
          artifactPath,
          sourceIds: [capture.id],
        }),
      );

      jsonOutput(
        runRuntime(root, [
          "promotion",
          "register",
          capture.id,
          artifactPath,
          "--now",
          "2026-09-05T10:03:00.000Z",
        ]),
      );
      const evaluation = jsonOutput(
        runRuntime(root, [
          "promotion",
          "approve",
          artifactId,
          "--approval-ref",
          "review:pwsh-e2e",
          "--now",
          "2026-09-05T10:04:00.000Z",
        ]),
      ) as { evaluation: { status: string } };
      expect(evaluation.evaluation.status).toBe("passed");
      jsonOutput(
        runRuntime(root, [
          "promotion",
          "activate",
          artifactId,
          "--now",
          "2026-09-05T10:05:00.000Z",
        ]),
      );
      expect(
        (
          jsonOutput(
            runRuntime(root, ["retrieve", "--path", "src/example.ts"]),
          ) as { artifacts: Array<{ id: string }> }
        ).artifacts.some((artifact) => artifact.id === artifactId),
      ).toBe(true);
      jsonOutput(
        runRuntime(root, [
          "forget",
          artifactId,
          "--reason",
          "irrelevant",
          "--now",
          "2026-09-05T10:06:00.000Z",
        ]),
      );
      jsonOutput(
        runRuntime(root, [
          "undo",
          artifactId,
          "--now",
          "2026-09-05T10:07:00.000Z",
        ]),
      );
      const validation = jsonOutput(runRuntime(root, ["validate"])) as {
        valid: boolean;
      };
      expect(validation.valid).toBe(true);
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "keeps dry-run side-effect free and handles Unicode paths",
    async () => {
      const root = await createPowerShellRepository();
      await rm(join(root, ".github", "SL-learning", "SL-scope-catalog.yml"));
      await writeFile(
        join(root, ".github", "SL-learning", "SL-scope-catalog.json"),
        `${JSON.stringify(
          {
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
                id: "SL-SCOPE-UNICODE",
                displayName: "Unicode",
                kind: "service",
                includePaths: ["services/订单/**"],
                excludePaths: [],
                parentScopeId: "SL-SCOPE-ROOT",
                dependencyScopeIds: [],
                ownerAliases: ["@example/unicode"],
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const before = await repositorySnapshot(root);
      const planned = jsonOutput(
        runRuntime(root, [
          "capture",
          "--title",
          "Crème brûlée retries",
          "--target-path",
          "services/订单/src/é.ts",
          "--trigger",
          "unicode-path",
          "--dry-run",
          "--now",
          FIXED_DATE,
        ]),
      ) as { scope: { id: string }; changes: Array<{ detail: string }> };
      expect(planned.scope.id).toBe("SL-SCOPE-UNICODE");
      expect(planned.changes.some((change) => change.detail === "planned")).toBe(
        true,
      );
      expect(await repositorySnapshot(root)).toEqual(before);
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "serializes concurrent votes and reclaims a stale mutation lock",
    async () => {
      const root = await createPowerShellRepository();
      const capture = jsonOutput(
        runRuntime(root, [
          "capture",
          "--title",
          "Concurrent PowerShell evidence",
          "--trigger",
          "concurrency",
          "--now",
          FIXED_DATE,
        ]),
      ) as { id: string };
      const lockPath = join(
        root,
        ".github",
        "SL-learning",
        ".SL-repository-mutation.lock",
      );
      await mkdir(lockPath);
      await writeFile(
        join(lockPath, "SL-owner.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          token: "abandoned",
          pid: 2_147_483_647,
          hostname: process.env.COMPUTERNAME ?? "unknown",
          acquiredAt: "2026-09-01T00:00:00.000Z",
        })}\n`,
      );
      const old = new Date("2026-09-01T00:00:00.000Z");
      await utimes(lockPath, old, old);

      const commands = [0, 1].map(
        (index) =>
          new Promise<void>((resolvePromise, rejectPromise) => {
            const child = spawn(
              "pwsh",
              [
                "-NoLogo",
                "-NoProfile",
                "-File",
                runtimePath(root),
                "--json",
                "vote",
                capture.id,
                "--useful",
                "--application-id",
                `concurrent-${index}`,
                "--task-run-id",
                `task-${index}`,
                "--idempotency-key",
                `vote-${index}`,
                "--now",
                `2026-09-05T10:0${index + 1}:00.000Z`,
              ],
              { cwd: root, stdio: "ignore" },
            );
            child.once("error", rejectPromise);
            child.once("exit", (code) =>
              code === 0
                ? resolvePromise()
                : rejectPromise(new Error(`pwsh exited ${String(code)}`)),
            );
          }),
      );
      await Promise.all(commands);
      await expect(stat(lockPath)).rejects.toThrow();
      const projections = jsonOutput(
        runRuntime(root, ["stats", capture.id]),
      ) as Array<{ verifiedSuccessCount: number }>;
      expect(projections[0]?.verifiedSuccessCount).toBe(2);
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "fails restore closed without clobbering a recreated destination",
    async () => {
      const root = await createPowerShellRepository();
      const capture = jsonOutput(
        runRuntime(root, [
          "capture",
          "--title",
          "Restore collision evidence",
          "--trigger",
          "restore",
          "--now",
          FIXED_DATE,
        ]),
      ) as { id: string; path: string };
      jsonOutput(
        runRuntime(root, [
          "forget",
          capture.id,
          "--reason",
          "wrong",
          "--now",
          "2026-09-05T10:01:00.000Z",
        ]),
      );
      const registryPath = join(
        root,
        ".github",
        "SL-learning",
        "SL-scopes",
        "SL-sl-scope-root-47ab59b49ac7",
        "SL-registry.json",
      );
      const beforeRegistry = await readFile(registryPath);
      await mkdir(dirname(join(root, capture.path)), { recursive: true });
      await writeFile(join(root, capture.path), "manual owner\n", "utf8");

      const restore = runRuntime(root, ["undo", capture.id]);

      expect(restore.status).not.toBe(0);
      expect(await readFile(join(root, capture.path), "utf8")).toBe(
        "manual owner\n",
      );
      expect(await readFile(registryPath)).toEqual(beforeRegistry);
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "activates a shared monorepo promotion only after two-scope evidence",
    async () => {
      const root = await createPowerShellRepository();
      await rm(join(root, ".github", "SL-learning", "SL-scope-catalog.yml"));
      await writeFile(
        join(root, ".github", "SL-learning", "SL-scope-catalog.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            scopes: [
              {
                id: "SL-SCOPE-ROOT",
                displayName: "Repository",
                kind: "repository",
                includePaths: ["**"],
                excludePaths: [],
                dependencyScopeIds: [],
                ownerAliases: ["@example/root"],
              },
              {
                id: "SL-SCOPE-A",
                displayName: "Service A",
                kind: "service",
                includePaths: ["services/a/**"],
                excludePaths: [],
                parentScopeId: "SL-SCOPE-ROOT",
                dependencyScopeIds: [],
                ownerAliases: ["@example/a"],
              },
              {
                id: "SL-SCOPE-B",
                displayName: "Service B",
                kind: "service",
                includePaths: ["services/b/**"],
                excludePaths: [],
                parentScopeId: "SL-SCOPE-ROOT",
                dependencyScopeIds: [],
                ownerAliases: ["@example/b"],
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const configPath = join(root, ".github", "SL-learning", "SL-config.yml");
      await writeFile(
        configPath,
        (await readFile(configPath, "utf8")).replace(
          "mode: single-repository",
          "mode: monorepo",
        ),
        "utf8",
      );
      const source = jsonOutput(
        runRuntime(root, [
          "capture",
          "--title",
          "Shared PowerShell source",
          "--scope",
          "SL-SCOPE-A",
          "--trigger",
          "shared-runtime",
          "--now",
          FIXED_DATE,
        ]),
      ) as { id: string };
      for (const [scope, suffix] of [
        ["SL-SCOPE-A", "a"],
        ["SL-SCOPE-B", "b"],
      ] as const) {
        const started = jsonOutput(
          runRuntime(root, [
            "use",
            "start",
            source.id,
            "--scope",
            scope,
            "--application-id",
            `shared-${suffix}`,
            "--idempotency-key",
            `shared-start-${suffix}`,
            "--now",
            "2026-09-05T10:01:00.000Z",
          ]),
        ) as { receiptId: string };
        jsonOutput(
          runRuntime(root, [
            "use",
            "finish",
            started.receiptId,
            "--outcome",
            "success",
            "--verified",
            "--verifier-type",
            "test-suite",
            "--evidence-ref",
            `run:shared-${suffix}`,
            "--idempotency-key",
            `shared-finish-${suffix}`,
            "--now",
            "2026-09-05T10:02:00.000Z",
          ]),
        );
      }
      const artifactId = "SL-SHARED-POWERSHELL";
      const artifactPath =
        ".github/instructions/SL-SHARED-POWERSHELL.instructions.md";
      const contractPath = slTestContractPath(artifactId);
      await slWriteTestPromotedArtifact({
        root,
        artifactId,
        artifactType: "instruction",
        artifactPath,
        contractPath,
      });
      await slWriteTestJson(
        root,
        contractPath,
        slCreateTestContract({
          artifactId,
          artifactType: "instruction",
          artifactPath,
          sourceIds: [source.id],
        }),
      );
      jsonOutput(
        runRuntime(root, [
          "promotion",
          "register",
          source.id,
          artifactPath,
          "--target-scope",
          "SL-SCOPE-ROOT",
          "--now",
          "2026-09-05T10:03:00.000Z",
        ]),
      );
      const evaluation = jsonOutput(
        runRuntime(root, [
          "promotion",
          "evaluate",
          artifactId,
          "--target-scope",
          "SL-SCOPE-ROOT",
          "--approval-ref",
          "review:root-owner",
          "--now",
          "2026-09-05T10:04:00.000Z",
        ]),
      ) as { evaluation: { status: string } };
      expect(evaluation.evaluation.status).toBe("passed");
      jsonOutput(
        runRuntime(root, [
          "promotion",
          "activate",
          artifactId,
          "--target-scope",
          "SL-SCOPE-ROOT",
          "--owner-approval-ref",
          "review:root-owner",
          "--now",
          "2026-09-05T10:05:00.000Z",
        ]),
      );
      expect(
        (
          jsonOutput(runRuntime(root, ["validate"])) as { valid: boolean }
        ).valid,
      ).toBe(true);
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "records, imports, projects, and reports resource efficiency without Node",
    async () => {
      const root = await createPowerShellRepository();
      const lesson = jsonOutput(
        runRuntime(root, [
          "capture", "--title", "Resource runtime evidence",
          "--trigger", "resource-runtime", "--now", FIXED_DATE,
        ]),
      ) as { id: string };
      jsonOutput(
        runRuntime(root, [
          "resource", "record", lesson.id, "--phase", "generation",
          "--generation-run-id", "generation-1",
          "--idempotency-key", "resource-generation-1",
          "--source", "host", "--quality", "measured",
          "--provider", "provider-a", "--model", "model-a",
          "--input-tokens", "1000", "--output-tokens", "0",
          "--wall-clock-ms", "10000", "--timestamp", FIXED_DATE,
        ]),
      );
      const usage = jsonOutput(
        runRuntime(root, [
          "use", "start", lesson.id, "--application-id", "resource-app-1",
          "--task-run-id", "resource-task-1", "--idempotency-key", "resource-use-start",
          "--now", "2026-09-05T10:00:00.000Z",
        ]),
      ) as { receiptId: string };
      jsonOutput(
        runRuntime(root, [
          "use", "finish", usage.receiptId, "--outcome", "success", "--verified",
          "--verifier-type", "test-suite", "--evidence-ref", "run:resource",
          "--idempotency-key", "resource-use-finish", "--now", "2026-09-05T10:01:00.000Z",
        ]),
      );
      jsonOutput(
        runRuntime(root, [
          "resource", "record", lesson.id, "--phase", "application",
          "--application-id", "resource-app-1", "--comparison-id", "comparison-1",
          "--scenario-key", "scenario-1", "--idempotency-key", "resource-application-1",
          "--provider", "provider-a", "--model", "model-a",
          "--input-tokens", "100", "--output-tokens", "0",
          "--wall-clock-ms", "1000", "--timestamp", "2026-09-05T10:02:00.000Z",
        ]),
      );
      jsonOutput(
        runRuntime(root, [
          "resource", "baseline", "--task-run-id", "baseline-task-1",
          "--comparison-id", "comparison-1", "--scenario-key", "scenario-1",
          "--idempotency-key", "resource-baseline-1", "--source", "manual",
          "--quality", "measured", "--provider", "provider-b", "--model", "model-b",
          "--input-tokens", "220", "--output-tokens", "0",
          "--wall-clock-ms", "1500", "--timestamp", "2026-09-05T08:00:00.000Z",
        ]),
      );
      const importPath = join(root, "resource-input.json");
      await writeFile(importPath, `${JSON.stringify({
        schemaVersion: 1,
        receipts: [{
          idempotencyKey: "resource-baseline-2",
          phase: "baseline",
          source: "manual",
          quality: "measured",
          provider: "provider-b",
          modelId: "model-b",
          tokens: { input: 220, output: 0 },
          wallClockDurationMs: 1500,
          timestamp: "2026-09-05T08:01:00.000Z",
          taskRunId: "baseline-task-2",
          comparison: {
            comparisonId: "comparison-2",
            scenarioKey: "scenario-2",
            role: "baseline",
          },
        }],
      }, null, 2)}\n`, "utf8");
      const beforeImport = await repositorySnapshot(root);
      const plannedImport = jsonOutput(
        runRuntime(root, ["resource", "import", importPath, "--dry-run"]),
      ) as { changes: Array<{ detail: string }> };
      expect(plannedImport.changes.some((change) => change.detail === "planned")).toBe(
        true,
      );
      expect(await repositorySnapshot(root)).toEqual(beforeImport);
      jsonOutput(runRuntime(root, ["resource", "import", importPath]));
      const resourceReport = jsonOutput(
        runRuntime(root, ["resource", "stats", lesson.id]),
      ) as { advisory: boolean };
      expect(resourceReport.advisory).toBe(true);
      const report = jsonOutput(
        runRuntime(root, ["efficiency", lesson.id]),
      ) as {
        advisory: boolean;
        segments: Array<{
          generation: { amortizedPerVerifiedSuccess: { inputTokens: number } };
          pairedBaseline: { medianSavings: { inputTokens: number } };
        }>;
      };
      expect(report.advisory).toBe(true);
      expect(report.segments[0]?.generation.amortizedPerVerifiedSuccess.inputTokens).toBe(1000);
      expect(report.segments[0]?.pairedBaseline.medianSavings.inputTokens).toBe(120);
      expect(report).toEqual(
        await slCalculateEfficiencyReport(root, { artifactId: lesson.id }),
      );
      jsonOutput(runRuntime(root, ["project"]));
      expect(
        (jsonOutput(runRuntime(root, ["validate"])) as { valid: boolean }).valid,
      ).toBe(true);
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "rejects unsafe or unsupported PowerShell resource inputs",
    async () => {
      const root = await createPowerShellRepository();
      const inputPath = join(root, "unsafe-resource.json");
      await writeFile(
        inputPath,
        `${JSON.stringify({
          idempotencyKey: "unsafe-resource",
          phase: "baseline",
          source: "manual",
          quality: "estimated",
          provider: "owner@example.com",
          modelId: "model-a",
          tokens: { input: 1, output: 1 },
          wallClockDurationMs: 1,
          timestamp: FIXED_DATE,
          taskRunId: "baseline-task",
          comparison: {
            comparisonId: "comparison",
            scenarioKey: "scenario",
            role: "baseline",
          },
          sourcePayload: "must-not-be-persisted",
        })}\n`,
        "utf8",
      );

      const result = runRuntime(root, ["resource", "import", inputPath]);

      expect(result.status).not.toBe(0);
      expect(String(result.stderr)).toContain("unsupported fields");
    },
    SUITE_TEST_TIMEOUT_MS,
  );
});
