import {
  access,
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import {
  slActivatePromotion,
  slEvaluatePromotionReadiness,
  slRegisterPromotion,
} from "../../SL-src/SL-core/SL-promotion.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import {
  slEvaluate,
  slFindValidationContractConflicts,
  slParseLivePosixProcessGroups,
  type SLValidationContract,
} from "../../SL-src/SL-validation/SL-validation-contract.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";
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
const FIXED_NOW = new Date("2026-09-03T00:00:00.000Z");
const SL_PROCESS_TREE_TEST_TIMEOUT_MS =
  process.platform === "win32" ? 30_000 : 15_000;
// Keep the larger Windows startup budget local to this nested-process regression.
const SL_PROCESS_TREE_SUCCESS_TIMEOUT_MS =
  process.platform === "win32" ? 8_000 : 3_000;
const PROCESS_TREE_FIXTURE = fileURLToPath(
  new URL("../SL-fixtures/SL-process-tree.mjs", import.meta.url),
);

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

async function slCreateSource(root: string, title: string) {
  return slCaptureLesson(root, {
    title,
    kind: "win",
    scope: "validation-contracts",
    triggers: [title.toLowerCase()],
    dryRun: false,
    now: FIXED_NOW,
  });
}

async function slPreparePromotion(options: {
  root: string;
  sourceId: string;
  artifactId: string;
  artifactType: "instruction" | "skill";
  contract?: SLValidationContract;
}): Promise<{ artifactPath: string; contractPath: string }> {
  const artifactPath =
    options.artifactType === "instruction"
      ? `.github/instructions/${options.artifactId}.instructions.md`
      : `.github/skills/${options.artifactId}/SKILL.md`;
  const contractPath = slTestContractPath(options.artifactId);
  await slWriteTestPromotedArtifact({
    root: options.root,
    artifactId: options.artifactId,
    artifactType: options.artifactType,
    artifactPath,
    contractPath,
  });
  await slWriteTestJson(
    options.root,
    contractPath,
    options.contract ??
      slCreateTestContract({
        artifactId: options.artifactId,
        artifactType: options.artifactType,
        artifactPath,
        sourceIds: [options.sourceId],
      }),
  );
  return { artifactPath, contractPath };
}

async function slPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function slProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function slWaitForProcessesToExit(
  pids: number[],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !slProcessExists(pid))) {
      return true;
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 25);
    });
  }
  return pids.every((pid) => !slProcessExists(pid));
}

function slConflictsForScopes(
  leftScope: SLValidationContract["scope"],
  rightScope: SLValidationContract["scope"],
) {
  const left = slCreateTestContract({
    artifactId: "SL-SCOPE-LEFT",
    artifactType: "instruction",
    artifactPath: ".github/instructions/SL-SCOPE-LEFT.instructions.md",
    sourceIds: ["SL-SOURCE-LEFT"],
    declarations: [{ key: "scope.mode", value: "left" }],
  });
  const right = slCreateTestContract({
    artifactId: "SL-SCOPE-RIGHT",
    artifactType: "instruction",
    artifactPath: ".github/instructions/SL-SCOPE-RIGHT.instructions.md",
    sourceIds: ["SL-SOURCE-RIGHT"],
    declarations: [{ key: "scope.mode", value: "right" }],
  });
  left.scope = leftScope;
  right.scope = rightScope;
  return slFindValidationContractConflicts([
    { artifactId: left.artifact.id, contract: left },
    { artifactId: right.artifact.id, contract: right },
  ]);
}

describe("SL promoted validation contracts", () => {
  test.each([
    {
      name: "repository and path scope",
      left: { kind: "repository" as const },
      right: { kind: "paths" as const, paths: ["src/api/**"] },
    },
    {
      name: "global and nested glob",
      left: { kind: "paths" as const, paths: ["**/*"] },
      right: { kind: "paths" as const, paths: ["src/api/**"] },
    },
    {
      name: "nested glob prefixes",
      left: { kind: "paths" as const, paths: ["src/**"] },
      right: { kind: "paths" as const, paths: ["src/api/**"] },
    },
    {
      name: "single-segment glob and exact path",
      left: { kind: "paths" as const, paths: ["src/*.ts"] },
      right: { kind: "paths" as const, paths: ["src/index.ts"] },
    },
    {
      name: "equal exact paths",
      left: { kind: "paths" as const, paths: ["src/index.ts"] },
      right: { kind: "paths" as const, paths: ["src/index.ts"] },
    },
    {
      name: "unsupported syntax fails closed",
      left: { kind: "paths" as const, paths: ["src/{api,web}/**"] },
      right: { kind: "paths" as const, paths: ["tests/**"] },
    },
  ])("detects overlapping scope patterns: $name", ({ left, right }) => {
    expect(slConflictsForScopes(left, right)).toEqual([
      {
        declarationKey: "scope.mode",
        leftArtifactId: "SL-SCOPE-LEFT",
        rightArtifactId: "SL-SCOPE-RIGHT",
        message:
          "Active artifacts SL-SCOPE-LEFT and SL-SCOPE-RIGHT declare conflicting values for scope.mode in overlapping scopes.",
      },
    ]);
  });

  test.each([
    {
      name: "different top-level trees",
      left: { kind: "paths" as const, paths: ["src/**"] },
      right: { kind: "paths" as const, paths: ["tests/**"] },
    },
    {
      name: "different nested trees",
      left: { kind: "paths" as const, paths: ["src/api/**"] },
      right: { kind: "paths" as const, paths: ["src/web/**"] },
    },
    {
      name: "different exact paths",
      left: { kind: "paths" as const, paths: ["src/left.ts"] },
      right: { kind: "paths" as const, paths: ["src/right.ts"] },
    },
    {
      name: "incompatible extensions",
      left: { kind: "paths" as const, paths: ["src/*.ts"] },
      right: { kind: "paths" as const, paths: ["src/index.js"] },
    },
  ])("proves scope patterns disjoint: $name", ({ left, right }) => {
    expect(slConflictsForScopes(left, right)).toEqual([]);
  });

  test("accepts and evaluates a valid instruction contract", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Instruction contract source");
    const artifactId = "SL-INSTRUCTION-CONTRACT";
    const artifactPath = `.github/instructions/${artifactId}.instructions.md`;
    const contract = slCreateTestContract({
      artifactId,
      artifactType: "instruction",
      artifactPath,
      sourceIds: [source.id],
    });
    contract.provenance.sourcePaths = [source.path];
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
      artifactType: "instruction",
      contract,
    });

    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );

    const evaluation = await slEvaluate(root, artifactId);
    const issues = await slValidateRepository(root);
    expect(evaluation.status).toBe("passed");
    expect(evaluation.executableChecksRequested).toBe(false);
    expect(evaluation.checks).toContainEqual({
      id: "scenario:applies-expected-guidance",
      kind: "scenario",
      status: "passed",
      message:
        "Scenario applies-expected-guidance has a deterministic input and expected behavior.",
    });
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  test("accepts a valid skill contract without running its command during validation", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Skill contract source");
    const artifactId = "SL-SKILL-CONTRACT";
    const artifactPath = `.github/skills/${artifactId}/SKILL.md`;
    const markerPath = join(root, "SL-command-ran.txt");
    const scriptPath = "SL-contract-checks/SL-write-marker.mjs";
    await mkdir(dirname(join(root, scriptPath)), { recursive: true });
    await writeFile(
      join(root, scriptPath),
      'import { writeFileSync } from "node:fs"; writeFileSync("SL-command-ran.txt", "ran");\n',
      "utf8",
    );
    const contract = slCreateTestContract({
      artifactId,
      artifactType: "skill",
      artifactPath,
      sourceIds: [source.id],
      executableChecks: [
        {
          id: "write-marker",
          command: "node",
          arguments: [scriptPath],
          timeoutMs: 1000,
          expectedExitCode: 0,
        },
      ],
    });
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
      artifactType: "skill",
      contract,
    });

    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    const issues = await slValidateRepository(root);
    const evaluation = await slEvaluate(root, artifactId);

    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(await slPathExists(markerPath)).toBe(false);
    expect(evaluation.checks).toContainEqual({
      id: "executable:write-marker",
      kind: "executable",
      status: "skipped",
      message: "Executable check requires explicit executeCommands opt-in.",
    });
  });

  test("rejects missing and invalid contracts during promotion registration", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Missing contract source");
    const missingPath =
      ".github/instructions/SL-MISSING-CONTRACT.instructions.md";
    await mkdir(dirname(join(root, ...missingPath.split("/"))), {
      recursive: true,
    });
    await writeFile(
      join(root, ...missingPath.split("/")),
      "---\nid: SL-MISSING-CONTRACT\napplyTo: \"**/*\"\n---\n\n# Missing\n",
      "utf8",
    );

    await expect(
      slRegisterPromotion(root, source.id, missingPath, false, FIXED_NOW),
    ).rejects.toThrow("must reference a validationContract");

    const invalid = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId: "SL-INVALID-CONTRACT",
      artifactType: "instruction",
      contract: {
        schemaVersion: 1,
      } as SLValidationContract,
    });
    await expect(
      slRegisterPromotion(
        root,
        source.id,
        invalid.artifactPath,
        false,
        FIXED_NOW,
      ),
    ).rejects.toThrow("contract-schema");
  });

  test("rejects contract provenance that does not match the promotion source", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Source mismatch source");
    const artifactId = "SL-SOURCE-MISMATCH";
    const artifactPath = `.github/instructions/${artifactId}.instructions.md`;
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
      artifactType: "instruction",
      contract: slCreateTestContract({
        artifactId,
        artifactType: "instruction",
        artifactPath,
        sourceIds: ["SL-DIFFERENT-SOURCE"],
      }),
    });

    await expect(
      slRegisterPromotion(
        root,
        source.id,
        prepared.artifactPath,
        false,
        FIXED_NOW,
      ),
    ).rejects.toThrow("contract-sources");
  });

  test("rejects secrets and personal paths in validation contracts", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Sensitive contract source");
    const artifactId = "SL-SENSITIVE-CONTRACT";
    const artifactPath = `.github/instructions/${artifactId}.instructions.md`;
    const contract = slCreateTestContract({
      artifactId,
      artifactType: "instruction",
      artifactPath,
      sourceIds: [source.id],
    });
    contract.provenance.summary =
      "password=abcdefghijklmnop at C:\\Users\\example\\private";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
      artifactType: "instruction",
      contract,
    });

    await expect(
      slRegisterPromotion(
        root,
        source.id,
        prepared.artifactPath,
        false,
        FIXED_NOW,
      ),
    ).rejects.toThrow("contract-content-safety");
  });

  test("rejects a validation contract directory junction outside the repository", async () => {
    const root = await slCreateTestRepository();
    const outside = await slCreateTestRepository();
    repositories.push(root, outside);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "External contract source");
    const artifactId = "SL-EXTERNAL-CONTRACT";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
      artifactType: "instruction",
    });
    const contractRoot = join(
      root,
      ".github",
      "SL-learning",
      "SL-validation-contracts",
    );
    const outsideContractRoot = join(outside, "outside-contracts");
    await mkdir(outsideContractRoot);
    const externalMarker = "EXTERNAL-CONTRACT-PARSER-CONTENT-MUST-NOT-LEAK";
    await writeFile(
      join(outsideContractRoot, `${artifactId}.validation.json`),
      `{"external":"${externalMarker}",`,
      "utf8",
    );
    await rm(contractRoot, { recursive: true });
    await symlink(
      outsideContractRoot,
      contractRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    const error = await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "Path resolves outside repository root",
    );
    expect((error as Error).message).not.toContain(externalMarker);
    expect(
      (await slLoadRegistry(root)).artifacts.some(
        (artifact) => artifact.id === artifactId,
      ),
    ).toBe(false);
  });

  test("rejects executable checks reached through an external directory junction", async () => {
    const root = await slCreateTestRepository();
    const outside = await slCreateTestRepository();
    repositories.push(root, outside);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "External executable source");
    const artifactId = "SL-EXTERNAL-EXECUTABLE";
    const checksRoot = join(root, "SL-contract-checks");
    const outsideChecksRoot = join(outside, "outside-checks");
    await mkdir(outsideChecksRoot);
    await writeFile(
      join(outsideChecksRoot, "SL-pass.mjs"),
      "process.exit(0);\n",
      "utf8",
    );
    await symlink(
      outsideChecksRoot,
      checksRoot,
      process.platform === "win32" ? "junction" : "dir",
    );
    const artifactPath = `.github/skills/${artifactId}/SKILL.md`;
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
      artifactType: "skill",
      contract: slCreateTestContract({
        artifactId,
        artifactType: "skill",
        artifactPath,
        sourceIds: [source.id],
        executableChecks: [
          {
            id: "external-script",
            command: "node",
            arguments: ["SL-pass.mjs"],
            cwd: "SL-contract-checks",
            timeoutMs: 1000,
            expectedExitCode: 0,
          },
        ],
      }),
    });

    await expect(
      slRegisterPromotion(
        root,
        source.id,
        prepared.artifactPath,
        false,
        FIXED_NOW,
      ),
    ).rejects.toThrow("Path resolves outside repository root");
    expect(await slPathExists(join(root, "SL-command-ran.txt"))).toBe(false);
  });

  test("allows probation conflicts but blocks activation against active declarations", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const firstSource = await slCreateSource(root, "First declaration source");
    const secondSource = await slCreateSource(root, "Second declaration source");
    const firstId = "SL-FIRST-DECLARATION";
    const secondId = "SL-SECOND-DECLARATION";
    const firstPath = `.github/instructions/${firstId}.instructions.md`;
    const secondPath = `.github/instructions/${secondId}.instructions.md`;
    const first = await slPreparePromotion({
      root,
      sourceId: firstSource.id,
      artifactId: firstId,
      artifactType: "instruction",
      contract: slCreateTestContract({
        artifactId: firstId,
        artifactType: "instruction",
        artifactPath: firstPath,
        sourceIds: [firstSource.id],
        declarations: [{ key: "tests.runner", value: "vitest" }],
      }),
    });
    const second = await slPreparePromotion({
      root,
      sourceId: secondSource.id,
      artifactId: secondId,
      artifactType: "instruction",
      contract: slCreateTestContract({
        artifactId: secondId,
        artifactType: "instruction",
        artifactPath: secondPath,
        sourceIds: [secondSource.id],
        declarations: [{ key: "tests.runner", value: "jest" }],
      }),
    });

    await slRegisterPromotion(
      root,
      firstSource.id,
      first.artifactPath,
      false,
      FIXED_NOW,
    );
    await slEvaluatePromotionReadiness(root, firstId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:first-declaration",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      firstId,
      false,
      new Date("2026-09-03T02:00:00.000Z"),
    );
    await slRegisterPromotion(
      root,
      secondSource.id,
      second.artifactPath,
      false,
      FIXED_NOW,
    );

    const readiness = await slEvaluatePromotionReadiness(root, secondId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:second-declaration",
      },
      now: new Date("2026-09-03T03:00:00.000Z"),
    });

    expect(readiness.evaluation.gates).toContainEqual(
      expect.objectContaining({
        id: "active-conflicts",
        status: "failed",
      }),
    );
  });

  test.each([
    {
      name: "unsupported command",
      executableCheck: {
        id: "malicious-command",
        command: "powershell",
        arguments: ["-Command", "Remove-Item", "-Recurse", "."],
        timeoutMs: 1000,
        expectedExitCode: 0,
      },
      expected: "contract-schema",
    },
    {
      name: "escaping script path",
      executableCheck: {
        id: "malicious-path",
        command: "node",
        arguments: ["../outside.mjs"],
        timeoutMs: 1000,
        expectedExitCode: 0,
      },
      expected: "repository-contained JavaScript file",
    },
    {
      name: "shell metacharacter argument",
      executableCheck: {
        id: "malicious-argument",
        command: "npm",
        arguments: ["run", "test", "--", "&&echo"],
        timeoutMs: 1000,
        expectedExitCode: 0,
      },
      expected: "unsafe command argument",
    },
  ])("rejects $name in executable checks", async ({ executableCheck, expected }) => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, `Malicious ${executableCheck.id}`);
    const artifactId = `SL-${executableCheck.id.toUpperCase()}`;
    const artifactPath = `.github/skills/${artifactId}/SKILL.md`;
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
      artifactType: "skill",
      contract: slCreateTestContract({
        artifactId,
        artifactType: "skill",
        artifactPath,
        sourceIds: [source.id],
        executableChecks: [executableCheck] as never,
      }),
    });

    await expect(
      slRegisterPromotion(
        root,
        source.id,
        prepared.artifactPath,
        false,
        FIXED_NOW,
      ),
    ).rejects.toThrow(expected);
  });

  test("fails closed for executable timeout and unexpected exit code", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Executable outcomes source");
    const artifactId = "SL-EXECUTABLE-OUTCOMES";
    const artifactPath = `.github/skills/${artifactId}/SKILL.md`;
    const timeoutScript = "SL-contract-checks/SL-timeout.mjs";
    const failureScript = "SL-contract-checks/SL-failure.mjs";
    await mkdir(join(root, "SL-contract-checks"), { recursive: true });
    await writeFile(
      join(root, ...timeoutScript.split("/")),
      "setInterval(() => undefined, 1000);\n",
      "utf8",
    );
    await writeFile(
      join(root, ...failureScript.split("/")),
      "process.exit(3);\n",
      "utf8",
    );
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
      artifactType: "skill",
      contract: slCreateTestContract({
        artifactId,
        artifactType: "skill",
        artifactPath,
        sourceIds: [source.id],
        executableChecks: [
          {
            id: "timeout",
            command: "node",
            arguments: [timeoutScript],
            timeoutMs: 250,
            expectedExitCode: 0,
          },
          {
            id: "unexpected-exit",
            command: "node",
            arguments: [failureScript],
            timeoutMs: 2000,
            expectedExitCode: 0,
          },
        ],
      }),
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );

    const evaluation = await slEvaluate(root, artifactId, {
      executeCommands: true,
    });

    expect(evaluation.status).toBe("failed");
    const timeoutCheck = evaluation.checks.find(
      (check) => check.id === "executable:timeout",
    );
    expect(timeoutCheck).toMatchObject({
      id: "executable:timeout",
      kind: "executable",
      status: "failed",
      exitCode: null,
      timedOut: true,
    });
    expect(timeoutCheck?.message).toMatch(
      /^Executable check exceeded 250ms(?:\.|, but process-tree termination could not be confirmed: .+)$/,
    );
    expect(evaluation.checks).toContainEqual({
      id: "executable:unexpected-exit",
      kind: "executable",
      status: "failed",
      message: "Executable check exited with code 3; expected 0.",
      exitCode: 3,
      timedOut: false,
    });
  }, 30000);

  test("parses live POSIX process groups and excludes zombies", () => {
    const snapshot = slParseLivePosixProcessGroups(
      "    0 I\n  101 Ss\n202 Z+\n  303 R<\n",
    );

    expect(snapshot).toEqual({
      processGroupIds: new Set([101, 303]),
    });
  });

  test("rejects malformed POSIX process snapshot rows", () => {
    expect(slParseLivePosixProcessGroups("101\n")).toEqual({
      error: "POSIX process snapshot contained an unrecognized row: 101",
    });
  });

  test.each([
    {
      name: "expected success",
      mode: "success",
      artifactId: "SL-PROCESS-TREE-SUCCESS",
      checkId: "process-tree-success",
      timeoutMs: SL_PROCESS_TREE_SUCCESS_TIMEOUT_MS,
      expectedStatus: "passed" as const,
      expectedMessage: "Executable check exited with expected code 0.",
      expectedExitCode: 0,
      expectedTimedOut: false,
    },
    {
      name: "timeout",
      mode: "timeout",
      artifactId: "SL-PROCESS-TREE-TIMEOUT",
      checkId: "process-tree-timeout",
      timeoutMs: 1500,
      expectedStatus: "failed" as const,
      expectedMessage: "Executable check exceeded 1500ms.",
      expectedExitCode: null,
      expectedTimedOut: true,
    },
  ])(
    "terminates child and grandchild processes after $name",
    async ({
      mode,
      artifactId,
      checkId,
      timeoutMs,
      expectedStatus,
      expectedMessage,
      expectedExitCode,
      expectedTimedOut,
    }) => {
      const root = await slCreateTestRepository();
      repositories.push(root);
      await slInstall(root, "init", false);
      const source = await slCreateSource(root, `Process tree ${mode} source`);
      const artifactPath = `.github/skills/${artifactId}/SKILL.md`;
      const fixturePath = "SL-contract-checks/SL-process-tree.mjs";
      const pidPath = join(root, "SL-process-tree-pids.json");
      const readyPath = join(root, "SL-process-tree-ready.json");
      const evaluationCompletePath = join(root, "SL-evaluator-complete.txt");
      const markerPath = join(root, "SL-delayed-marker.txt");
      await mkdir(join(root, "SL-contract-checks"), { recursive: true });
      await copyFile(
        PROCESS_TREE_FIXTURE,
        join(root, ...fixturePath.split("/")),
      );
      const prepared = await slPreparePromotion({
        root,
        sourceId: source.id,
        artifactId,
        artifactType: "skill",
        contract: slCreateTestContract({
          artifactId,
          artifactType: "skill",
          artifactPath,
          sourceIds: [source.id],
          executableChecks: [
            {
              id: checkId,
              command: "node",
              arguments: [fixturePath, "parent", mode],
              timeoutMs,
              expectedExitCode: 0,
            },
          ],
        }),
      });
      await slRegisterPromotion(
        root,
        source.id,
        prepared.artifactPath,
        false,
        FIXED_NOW,
      );

      const evaluation = await slEvaluate(root, artifactId, {
        executeCommands: true,
      });
      const pids = JSON.parse(
        await readFile(pidPath, "utf8"),
      ) as { childPid: number; grandchildPid: number };
      const descendantPids = [pids.childPid, pids.grandchildPid];
      try {
        const executableCheck = evaluation.checks.find(
          (check) => check.id === `executable:${checkId}`,
        );
        expect(executableCheck).toMatchObject({
          id: `executable:${checkId}`,
          kind: "executable",
          status: expectedStatus,
          exitCode: expectedExitCode,
          timedOut: expectedTimedOut,
        });
        if (expectedTimedOut) {
          expect(executableCheck?.message).toMatch(
            new RegExp(
              `^Executable check exceeded ${timeoutMs}ms(?:\\.|, but process-tree termination could not be confirmed: .+)$`,
            ),
          );
        } else {
          expect(executableCheck?.message).toBe(expectedMessage);
        }
        expect(await slPathExists(readyPath)).toBe(true);
        expect(await slWaitForProcessesToExit(descendantPids, 750)).toBe(true);
        await writeFile(evaluationCompletePath, "complete", "utf8");
        await new Promise((resolveDelay) => {
          setTimeout(resolveDelay, 500);
        });
        expect(await slPathExists(markerPath)).toBe(false);
        expect(descendantPids.every((pid) => !slProcessExists(pid))).toBe(true);
      } finally {
        for (const pid of descendantPids) {
          if (slProcessExists(pid)) {
            process.kill(pid, "SIGKILL");
          }
        }
      }
    },
    SL_PROCESS_TREE_TEST_TIMEOUT_MS,
  );

  test("repository validation reports missing and mismatched contracts", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const firstSource = await slCreateSource(root, "Repository first source");
    const secondSource = await slCreateSource(root, "Repository second source");
    const firstId = "SL-REPOSITORY-FIRST";
    const secondId = "SL-REPOSITORY-SECOND";
    const firstPath = `.github/instructions/${firstId}.instructions.md`;
    const secondPath = `.github/instructions/${secondId}.instructions.md`;
    const firstContract = slCreateTestContract({
      artifactId: firstId,
      artifactType: "instruction",
      artifactPath: firstPath,
      sourceIds: [firstSource.id],
      declarations: [{ key: "format.mode", value: "strict" }],
    });
    const secondContract = slCreateTestContract({
      artifactId: secondId,
      artifactType: "instruction",
      artifactPath: secondPath,
      sourceIds: [secondSource.id],
      declarations: [{ key: "format.mode", value: "strict" }],
    });
    const first = await slPreparePromotion({
      root,
      sourceId: firstSource.id,
      artifactId: firstId,
      artifactType: "instruction",
      contract: firstContract,
    });
    const second = await slPreparePromotion({
      root,
      sourceId: secondSource.id,
      artifactId: secondId,
      artifactType: "instruction",
      contract: secondContract,
    });
    await slRegisterPromotion(
      root,
      firstSource.id,
      first.artifactPath,
      false,
      FIXED_NOW,
    );
    await slRegisterPromotion(
      root,
      secondSource.id,
      second.artifactPath,
      false,
      FIXED_NOW,
    );

    await rm(join(root, ...first.contractPath.split("/")));
    secondContract.provenance.sourceIds = ["SL-DIFFERENT-SOURCE"];
    await slWriteTestJson(root, second.contractPath, secondContract);

    const issues = await slValidateRepository(root);
    const registry = await slLoadRegistry(root);
    const firstRegistryArtifact = registry.artifacts.find(
      (artifact) => artifact.id === firstId,
    )!;
    const secondRegistryArtifact = registry.artifacts.find(
      (artifact) => artifact.id === secondId,
    )!;
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "validation-contract-contract-exists",
          path: firstRegistryArtifact.path,
        }),
        expect.objectContaining({
          code: "validation-contract-contract-sources",
          path: secondRegistryArtifact.path,
        }),
      ]),
    );
  });

  test("repository validation reports conflicts introduced after registration", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const firstSource = await slCreateSource(root, "Validation conflict first");
    const secondSource = await slCreateSource(root, "Validation conflict second");
    const firstId = "SL-VALIDATION-CONFLICT-FIRST";
    const secondId = "SL-VALIDATION-CONFLICT-SECOND";
    const firstPath = `.github/instructions/${firstId}.instructions.md`;
    const secondPath = `.github/instructions/${secondId}.instructions.md`;
    const first = await slPreparePromotion({
      root,
      sourceId: firstSource.id,
      artifactId: firstId,
      artifactType: "instruction",
      contract: slCreateTestContract({
        artifactId: firstId,
        artifactType: "instruction",
        artifactPath: firstPath,
        sourceIds: [firstSource.id],
        declarations: [{ key: "validation.mode", value: "strict" }],
      }),
    });
    const secondContract = slCreateTestContract({
      artifactId: secondId,
      artifactType: "instruction",
      artifactPath: secondPath,
      sourceIds: [secondSource.id],
      declarations: [{ key: "validation.mode", value: "strict" }],
    });
    const second = await slPreparePromotion({
      root,
      sourceId: secondSource.id,
      artifactId: secondId,
      artifactType: "instruction",
      contract: secondContract,
    });
    await slRegisterPromotion(
      root,
      firstSource.id,
      first.artifactPath,
      false,
      FIXED_NOW,
    );
    await slRegisterPromotion(
      root,
      secondSource.id,
      second.artifactPath,
      false,
      FIXED_NOW,
    );
    await slEvaluatePromotionReadiness(root, firstId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:validation-conflict-first",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      firstId,
      false,
      new Date("2026-09-03T02:00:00.000Z"),
    );
    await slEvaluatePromotionReadiness(root, secondId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:validation-conflict-second",
      },
      now: new Date("2026-09-03T03:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      secondId,
      false,
      new Date("2026-09-03T04:00:00.000Z"),
    );
    secondContract.declarations = [
      { key: "validation.mode", value: "permissive" },
    ];
    await slWriteTestJson(root, second.contractPath, secondContract);

    const issues = await slValidateRepository(root);

    expect(issues).toContainEqual({
      severity: "error",
      code: "validation-contract-conflict",
      path: secondPath,
      message: `Active artifacts ${firstId} and ${secondId} declare conflicting values for validation.mode in overlapping scopes.`,
    });
  });
});
