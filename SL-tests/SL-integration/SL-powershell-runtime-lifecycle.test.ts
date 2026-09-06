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
  environment: NodeJS.ProcessEnv = {},
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
    {
      cwd: root,
      encoding: "utf8",
      timeout: TEST_TIMEOUT_MS,
      env: { ...process.env, ...environment },
    },
  );
}

function runRuntimeWithoutJson(
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
    "enforces deterministic lowercase skill names during PowerShell promotion",
    async () => {
      const root = await createPowerShellRepository();
      const captureSource = (title: string, now: string) =>
        jsonOutput(
          runRuntime(root, [
            "capture",
            "--title",
            title,
            "--kind",
            "win",
            "--trigger",
            "skill-name",
            "--now",
            now,
          ]),
        ) as { id: string };
      const writeSkill = async (
        sourceId: string,
        artifactId: string,
        skillName: string,
        frontmatterName = skillName,
      ) => {
        const artifactPath = `.github/skills/${skillName}/SKILL.md`;
        const contractPath = slTestContractPath(artifactId);
        await slWriteTestPromotedArtifact({
          root,
          artifactId,
          artifactType: "skill",
          artifactPath,
          contractPath,
        });
        if (frontmatterName !== skillName) {
          const absolutePath = join(root, ...artifactPath.split("/"));
          await writeFile(
            absolutePath,
            (await readFile(absolutePath, "utf8")).replace(
              `name: ${skillName}`,
              `name: ${frontmatterName}`,
            ),
            "utf8",
          );
        }
        await slWriteTestJson(
          root,
          contractPath,
          slCreateTestContract({
            artifactId,
            artifactType: "skill",
            artifactPath,
            sourceIds: [sourceId],
          }),
        );
        return artifactPath;
      };

      const validSource = captureSource(
        "PowerShell valid skill name",
        "2026-09-05T10:00:00.000Z",
      );
      const validId = "SL-POWERSHELL-SKILL-NAME";
      const validPath = await writeSkill(
        validSource.id,
        validId,
        "sl-powershell-skill-name",
      );
      jsonOutput(
        runRuntime(root, [
          "promotion",
          "register",
          validSource.id,
          validPath,
          "--now",
          "2026-09-05T10:01:00.000Z",
        ]),
      );

      const uppercaseSource = captureSource(
        "PowerShell uppercase skill name",
        "2026-09-05T10:02:00.000Z",
      );
      const uppercasePath = await writeSkill(
        uppercaseSource.id,
        "SL-POWERSHELL-UPPERCASE",
        "SL-POWERSHELL-UPPERCASE",
      );
      const uppercaseResult = runRuntime(root, [
        "promotion",
        "register",
        uppercaseSource.id,
        uppercasePath,
        "--now",
        "2026-09-05T10:03:00.000Z",
      ]);
      expect(uppercaseResult.status).not.toBe(0);
      expect(`${uppercaseResult.stdout}${uppercaseResult.stderr}`).toContain(
        "lowercase kebab-case",
      );

      const mismatchSource = captureSource(
        "PowerShell mismatched skill name",
        "2026-09-05T10:04:00.000Z",
      );
      const mismatchPath = await writeSkill(
        mismatchSource.id,
        "SL-POWERSHELL-MISMATCH",
        "sl-powershell-mismatch",
        "different-skill",
      );
      const mismatchResult = runRuntime(root, [
        "promotion",
        "register",
        mismatchSource.id,
        mismatchPath,
        "--now",
        "2026-09-05T10:05:00.000Z",
      ]);
      expect(mismatchResult.status).not.toBe(0);
      expect(`${mismatchResult.stdout}${mismatchResult.stderr}`).toContain(
        "frontmatter name must match its directory",
      );

      const stateCatalog = JSON.parse(
        await readFile(
          join(root, ".github", "SL-learning", "SL-state-catalog.json"),
          "utf8",
        ),
      ) as { scopes: Array<{ registryPath: string }> };
      const registry = JSON.parse(
        await readFile(
          join(root, ...stateCatalog.scopes[0]!.registryPath.split("/")),
          "utf8",
        ),
      ) as { artifacts: Array<{ id: string; path: string }> };
      const validArtifact = registry.artifacts.find(
        (artifact) => artifact.id === validId,
      );
      expect(validArtifact).toBeDefined();
      const validArtifactPath = join(
        root,
        ...validArtifact!.path.split("/"),
      );
      await writeFile(
        validArtifactPath,
        (await readFile(validArtifactPath, "utf8")).replace(
          /name: "?sl-powershell-skill-name"?/,
          'name: "different-skill"',
        ),
        "utf8",
      );
      const validationResult = runRuntime(root, ["validate"]);
      expect(validationResult.status).not.toBe(0);
      const validation = JSON.parse(String(validationResult.stdout)) as {
        issues: Array<{ code: string }>;
      };
      expect(validation.issues).toContainEqual(
        expect.objectContaining({ code: "skill-name" }),
      );
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test("keeps empty usage projections as JSON arrays", async () => {
    const root = await createPowerShellRepository();
    jsonOutput(runRuntime(root, ["project"]));
    const stateCatalog = JSON.parse(
      await readFile(
        join(root, ".github", "SL-learning", "SL-state-catalog.json"),
        "utf8",
      ),
    ) as { scopes: Array<{ projectionPath: string }> };
    const projection = JSON.parse(
      await readFile(
        join(root, ...stateCatalog.scopes[0]!.projectionPath.split("/")),
        "utf8",
      ),
    ) as { projections: unknown };

    expect(projection.projections).toEqual([]);
    expect(
      (jsonOutput(runRuntime(root, ["doctor"])) as { healthy: boolean }).healthy,
    ).toBe(true);
    expect(
      (jsonOutput(runRuntime(root, ["validate"])) as { valid: boolean }).valid,
    ).toBe(true);
  });

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
          "--input-tokens", "1001", "--output-tokens", "0",
          "--wall-clock-ms", "10000", "--timestamp", FIXED_DATE,
          "--cost-amount", "3", "--cost-currency", "USD",
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
      const secondUsage = jsonOutput(
        runRuntime(root, [
          "use", "start", lesson.id, "--application-id", "resource-app-2",
          "--task-run-id", "resource-task-2", "--idempotency-key", "resource-use-start-2",
          "--now", "2026-09-05T10:01:30.000Z",
        ]),
      ) as { receiptId: string };
      jsonOutput(
        runRuntime(root, [
          "use", "finish", secondUsage.receiptId, "--outcome", "success", "--verified",
          "--verifier-type", "test-suite", "--evidence-ref", "run:resource-2",
          "--idempotency-key", "resource-use-finish-2", "--now", "2026-09-05T10:01:45.000Z",
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
          generation: {
            amortizedPerVerifiedSuccess: {
              inputTokens: number;
              reportedCosts: { USD: string };
              reportedCostSampleCounts: { USD: number };
            };
          };
          verifiedSuccessApplications: { coverage: number };
          pairedBaseline: { medianSavings: { inputTokens: number } };
        }>;
      };
      expect(report.advisory).toBe(true);
      expect(report.segments[0]?.generation.amortizedPerVerifiedSuccess).toMatchObject({
        inputTokens: 500.5,
        reportedCosts: { USD: "1.5" },
        reportedCostSampleCounts: { USD: 2 },
      });
      expect(report.segments[0]?.verifiedSuccessApplications.coverage).toBe(0.5);
      expect(report.segments[0]?.pairedBaseline.medianSavings.inputTokens).toBe(120);
      expect(report).toEqual(
        await slCalculateEfficiencyReport(root, { artifactId: lesson.id }),
      );
      const plainReport = runRuntimeWithoutJson(root, [
        "efficiency",
        lesson.id,
      ]);
      expect(plainReport.status, String(plainReport.stderr)).toBe(0);
      expect(JSON.parse(String(plainReport.stdout))).toEqual(report);
      expect(
        String(
          runRuntimeWithoutJson(root, ["efficiency", lesson.id]).stdout,
        ),
      ).toBe(String(plainReport.stdout));
      jsonOutput(runRuntime(root, ["project"]));
      expect(
        (jsonOutput(runRuntime(root, ["validate"])) as { valid: boolean }).valid,
      ).toBe(true);
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "enforces nested resource input schemas, phase roles, and recursive privacy checks",
    async () => {
      const root = await createPowerShellRepository();
      const inputPath = join(root, "unsafe-resource.json");
      const baseline = {
        idempotencyKey: "unsafe-resource",
        phase: "baseline",
        source: "manual",
        quality: "estimated",
        provider: "provider-a",
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
      };
      const cases: Array<{
        value: unknown;
        expected: string;
      }> = [
        {
          value: { ...baseline, tokens: { ...baseline.tokens, extra: 1 } },
          expected: "receipts[0].tokens contains unsupported fields",
        },
        {
          value: {
            ...baseline,
            comparison: { ...baseline.comparison, role: "treatment" },
          },
          expected: "comparison.role must be baseline",
        },
        {
          value: {
            ...baseline,
            comparison: {
              ...baseline.comparison,
              scenarioKey: "owner@example.com",
            },
          },
          expected: "must not contain secrets, PII, or user paths",
        },
        {
          value: {
            ...baseline,
            scope: { id: "SL-SCOPE-ROOT", path: ".", extra: true },
          },
          expected: "receipts[0].scope contains unsupported fields",
        },
        {
          value: {
            ...baseline,
            reportedCost: {
              amount: "1",
              currency: "USD",
              basis: "host-reported",
              extra: "invalid",
            },
          },
          expected: "receipts[0].reportedCost contains unsupported fields",
        },
        {
          value: {
            schemaVersion: 1,
            receipts: [baseline],
            extra: true,
          },
          expected: "resource input contains unsupported fields",
        },
        {
          value: {
            ...baseline,
            phase: "generation",
            artifactId: "SL-TEST",
            artifactContentHash: "a".repeat(64),
            generationRunId: "generation",
          },
          expected: "generation input cannot contain taskRunId",
        },
      ];

      for (const [index, testCase] of cases.entries()) {
        await writeFile(
          inputPath,
          `${JSON.stringify(testCase.value)}\n`,
          "utf8",
        );
        const before = await repositorySnapshot(root);
        const result = runRuntime(root, ["resource", "import", inputPath]);
        expect(result.status).not.toBe(0);
        expect(String(result.stderr)).toContain(testCase.expected);
        expect(await repositorySnapshot(root), `case ${index}`).toEqual(before);
      }
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "deduplicates equivalent resource receipt identities across month paths",
    async () => {
      const root = await createPowerShellRepository();
      jsonOutput(
        runRuntime(root, [
          "resource", "baseline", "--task-run-id", "dedupe-task",
          "--comparison-id", "dedupe-comparison", "--scenario-key", "dedupe-scenario",
          "--idempotency-key", "dedupe-resource", "--source", "manual",
          "--quality", "measured", "--provider", "provider-a", "--model", "model-a",
          "--input-tokens", "10", "--output-tokens", "2",
          "--wall-clock-ms", "100", "--timestamp", FIXED_DATE,
        ]),
      );
      const snapshot = await repositorySnapshot(root);
      const originalRelative = [...snapshot.keys()]
        .map((path) => path.replaceAll("\\", "/"))
        .find(
          (path) =>
            path.includes("/SL-resource-receipts/") &&
            path.includes("/2026-09/SL-resource-"),
        );
      expect(originalRelative).toBeDefined();
      const receipt = JSON.parse(
        await readFile(join(root, ...originalRelative!.split("/")), "utf8"),
      ) as { timestamp: string };
      receipt.timestamp = "2026-10-05T10:00:00.000Z";
      const duplicateRelative = originalRelative!.replace(
        "/2026-09/",
        "/2026-10/",
      );
      const duplicatePath = join(root, ...duplicateRelative.split("/"));
      await mkdir(dirname(duplicatePath), { recursive: true });
      await writeFile(duplicatePath, `${JSON.stringify(receipt, null, 2)}\n`);

      const report = jsonOutput(
        runRuntime(root, ["efficiency"]),
      ) as { baselineReceiptCount: number };
      expect(report.baselineReceiptCount).toBe(1);
      jsonOutput(runRuntime(root, ["project"]));
      const stateCatalog = JSON.parse(
        await readFile(
          join(root, ".github", "SL-learning", "SL-state-catalog.json"),
          "utf8",
        ),
      ) as { scopes: Array<{ resourceProjectionPath: string }> };
      const projection = JSON.parse(
        await readFile(
          join(root, ...stateCatalog.scopes[0]!.resourceProjectionPath.split("/")),
          "utf8",
        ),
      ) as { projections: Array<{ receiptCount: number }> };
      expect(projection.projections).toHaveLength(1);
      expect(projection.projections[0]?.receiptCount).toBe(1);
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "matches TypeScript case-sensitive parent exclusion validation",
    async () => {
      const root = await createPowerShellRepository();
      await rm(join(root, ".github", "SL-learning", "SL-scope-catalog.yml"));
      const catalogPath = join(
        root,
        ".github",
        "SL-learning",
        "SL-scope-catalog.json",
      );
      const catalog = {
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
            includePaths: ["Services/orders/**"],
            excludePaths: ["services/**"],
            parentScopeId: "SL-SCOPE-ROOT",
            dependencyScopeIds: [],
            ownerAliases: [],
          },
        ],
      };
      await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
      expect(runRuntime(root, ["scope", "validate"]).status).toBe(0);

      catalog.scopes[1]!.includePaths = ["services/orders/**"];
      await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
      const invalid = runRuntime(root, ["scope", "validate"]);
      expect(invalid.status).toBe(8);
      expect(String(invalid.stderr)).toContain("unmatchable-scope");
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "reports a missing declared resource projection as validation failure",
    async () => {
      const root = await createPowerShellRepository();
      const stateCatalog = JSON.parse(
        await readFile(
          join(root, ".github", "SL-learning", "SL-state-catalog.json"),
          "utf8",
        ),
      ) as { scopes: Array<{ resourceProjectionPath: string }> };
      await rm(
        join(root, ...stateCatalog.scopes[0]!.resourceProjectionPath.split("/")),
      );

      const validation = runRuntime(root, ["validate"]);

      expect(validation.status).toBe(8);
      expect(JSON.parse(String(validation.stdout)).issues).toContainEqual(
        expect.objectContaining({ code: "missing-resource-projection" }),
      );
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "rolls back forget and sweep after injected I/O failures",
    async () => {
      const root = await createPowerShellRepository();
      const capture = jsonOutput(
        runRuntime(root, [
          "capture", "--title", "Transactional retention evidence",
          "--trigger", "transaction", "--now", FIXED_DATE,
        ]),
      ) as { id: string };
      const beforeForget = await repositorySnapshot(root);
      const failedForget = runRuntime(
        root,
        [
          "forget", capture.id, "--reason", "wrong",
          "--now", "2026-09-05T10:01:00.000Z",
        ],
        { SL_TEST_INJECT_IO_FAILURE_AFTER: "2" },
      );
      expect(failedForget.status).toBe(9);
      expect(String(failedForget.stderr)).toContain("Injected I/O failure");
      expect(await repositorySnapshot(root)).toEqual(beforeForget);

      jsonOutput(
        runRuntime(root, [
          "forget", capture.id, "--reason", "wrong",
          "--now", "2026-09-05T10:01:00.000Z",
        ]),
      );
      const beforeSweep = await repositorySnapshot(root);
      const failedSweep = runRuntime(
        root,
        ["sweep", "--now", "2026-09-20T10:01:00.000Z"],
        { SL_TEST_INJECT_IO_FAILURE_AFTER: "2" },
      );
      expect(failedSweep.status).toBe(9);
      expect(String(failedSweep.stderr)).toContain("Injected I/O failure");
      expect(await repositorySnapshot(root)).toEqual(beforeSweep);
    },
    SUITE_TEST_TIMEOUT_MS,
  );

  test(
    "rolls back promotion registration and activation after injected I/O failures",
    async () => {
      const root = await createPowerShellRepository();
      const capture = jsonOutput(
        runRuntime(root, [
          "capture", "--title", "Transactional promotion evidence",
          "--trigger", "transaction", "--now", FIXED_DATE,
        ]),
      ) as { id: string };
      const artifactId = "SL-TRANSACTIONAL-PROMOTION";
      const artifactPath =
        ".github/instructions/SL-TRANSACTIONAL-PROMOTION.instructions.md";
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
      const before = await repositorySnapshot(root);

      const result = runRuntime(
        root,
        [
          "promotion", "register", capture.id, artifactPath,
          "--now", "2026-09-05T10:03:00.000Z",
        ],
        { SL_TEST_INJECT_IO_FAILURE_AFTER: "2" },
      );

      expect(result.status).toBe(9);
      expect(String(result.stderr)).toContain("Injected I/O failure");
      expect(await repositorySnapshot(root)).toEqual(before);

      jsonOutput(
        runRuntime(root, [
          "promotion", "register", capture.id, artifactPath,
          "--now", "2026-09-05T10:03:00.000Z",
        ]),
      );
      jsonOutput(
        runRuntime(root, [
          "promotion", "evaluate", artifactId,
          "--approval-ref", "review:transaction",
          "--now", "2026-09-05T10:04:00.000Z",
        ]),
      );
      const beforeActivation = await repositorySnapshot(root);
      const failedActivation = runRuntime(
        root,
        [
          "promotion", "activate", artifactId,
          "--now", "2026-09-05T10:05:00.000Z",
        ],
        { SL_TEST_INJECT_IO_FAILURE_AFTER: "2" },
      );
      expect(failedActivation.status).toBe(9);
      expect(String(failedActivation.stderr)).toContain(
        "Injected I/O failure",
      );
      expect(await repositorySnapshot(root)).toEqual(beforeActivation);
    },
    SUITE_TEST_TIMEOUT_MS,
  );
});
