import {
  access,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import fg from "fast-glob";
import { afterEach, describe, expect, test } from "vitest";
import { parse } from "yaml";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import {
  slActivatePromotion,
  slEvaluatePromotionReadiness,
  slRegisterPromotion,
} from "../../SL-src/SL-core/SL-promotion.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import {
  slArtifactUsageContentHash,
  slCreateUsageEvent,
  slFinishUsage,
  slProjectUsage,
  slStartUsage,
  slSynchronizeUsageProjection,
  slWriteUsageEvent,
} from "../../SL-src/SL-core/SL-usage.js";
import { slSweep } from "../../SL-src/SL-forgetting/SL-forgetting.js";
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
const CAPTURED_AT = new Date("2026-01-01T00:00:00.000Z");
const SL_RUNTIME_COMMIT = "29dcce4836ccbae45b4c1b5bc2cd9b0dfe4b3098";
const CHECKOUT_ACTION =
  "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const SETUP_NODE_ACTION =
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
const UPLOAD_ARTIFACT_ACTION =
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";
const DOWNLOAD_ARTIFACT_ACTION =
  "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093";
const CREATE_PULL_REQUEST_ACTION =
  "peter-evans/create-pull-request@22a9089034f40e5a961c8808d113e2c98fb63676";

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function prepareLesson(root: string, title: string) {
  await slInstall(root, "init", false);
  return slCaptureLesson(root, {
    title,
    kind: "win",
    scope: "telemetry-integration",
    triggers: [title.toLowerCase()],
    dryRun: false,
    now: CAPTURED_AT,
  });
}

async function writeMergedSuccess(
  root: string,
  artifactId: string,
  artifactContentHash: string,
  sequence: number,
): Promise<void> {
  await slWriteUsageEvent(
    root,
    slCreateUsageEvent({
      artifactId,
      artifactContentHash,
      taskRunId: `branch-task-${sequence}`,
      applicationId: `branch-application-${sequence}`,
      stage: "verified",
      outcome: "success",
      verifierType: "merged-test-suite",
      timestamp: `2026-02-0${sequence}T00:00:00.000Z`,
      idempotencyKey: `branch-${sequence}`,
      evidenceRef: `ci:branch-${sequence}`,
    }),
    false,
  );
}

describe("SL telemetry integration", () => {
  test("derives a promotion candidate after independent branch events are combined", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await prepareLesson(root, "Merged branch threshold");
    const content = await readFile(join(root, ...lesson.path.split("/")), "utf8");
    const contentHash = slArtifactUsageContentHash(content);

    await Promise.all(
      [1, 2, 3].map((sequence) =>
        writeMergedSuccess(root, lesson.id, contentHash, sequence),
      ),
    );
    expect(
      (await slLoadRegistry(root)).artifacts.find(
        (artifact) => artifact.id === lesson.id,
      )?.status,
    ).toBe("raw");

    await slSynchronizeUsageProjection(root, false);

    const artifact = (await slLoadRegistry(root)).artifacts.find(
      (candidate) => candidate.id === lesson.id,
    );
    expect(artifact).toMatchObject({
      status: "promotion-candidate",
      lastRetrievedAt: "2026-02-03T00:00:00.000Z",
      lastSuccessfulUseAt: "2026-02-03T00:00:00.000Z",
      usageProjection: {
        verifiedSuccessCount: 3,
        verifiedFailureCount: 0,
        verifiedSuccessRate: 1,
      },
    });
  });

  test("segments metrics and maturity when artifact content changes", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await prepareLesson(root, "Version segmented evidence");
    const lessonPath = join(root, ...lesson.path.split("/"));
    const originalHash = slArtifactUsageContentHash(
      await readFile(lessonPath, "utf8"),
    );
    for (const sequence of [1, 2, 3]) {
      await writeMergedSuccess(root, lesson.id, originalHash, sequence);
    }
    await slSynchronizeUsageProjection(root, false);

    await writeFile(
      lessonPath,
      `${await readFile(lessonPath, "utf8")}\nMaterially revised guidance.\n`,
      "utf8",
    );
    const started = await slStartUsage(root, lesson.id, {
      applicationId: "revised-application",
      taskRunId: "revised-task",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    await slFinishUsage(root, started.applicationId, {
      outcome: "success",
      verified: true,
      verifierType: "integration-test",
      evidenceRef: "ci:revised-version",
      now: new Date("2026-03-01T01:00:00.000Z"),
    });

    const artifact = (await slLoadRegistry(root)).artifacts.find(
      (candidate) => candidate.id === lesson.id,
    );
    const projections = await slProjectUsage(root, lesson.id);
    expect(projections).toHaveLength(2);
    expect(artifact).toMatchObject({
      status: "raw",
      lastSuccessfulUseAt: "2026-03-01T01:00:00.000Z",
      usageProjection: {
        artifactContentHash: started.artifactContentHash,
        verifiedSuccessCount: 1,
      },
    });
    expect(artifact?.usageProjection?.artifactContentHash).not.toBe(originalHash);
  });

  test("allows activated guidance to record verified use while probation stays undiscoverable", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const source = await prepareLesson(root, "Activated usage source");
    const artifactId = "SL-ACTIVATED-USAGE";
    const artifactPath = `.github/instructions/${artifactId}.instructions.md`;
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
    await slRegisterPromotion(root, source.id, artifactPath, false, CAPTURED_AT);

    const probationIndex = JSON.parse(
      await readFile(
        join(root, ".github", "SL-learning", "SL-index.json"),
        "utf8",
      ),
    ) as { artifacts: Array<{ id: string }> };
    expect(probationIndex.artifacts.some((artifact) => artifact.id === artifactId)).toBe(false);

    await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:activated-usage",
      },
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      artifactId,
      false,
      new Date("2026-01-03T00:00:00.000Z"),
    );
    const started = await slStartUsage(root, artifactId, {
      applicationId: "active-guidance-use",
      now: new Date("2026-01-04T00:00:00.000Z"),
    });
    await slFinishUsage(root, started.applicationId, {
      outcome: "success",
      verified: true,
      verifierType: "integration-test",
      evidenceRef: "ci:active-guidance",
      now: new Date("2026-01-04T01:00:00.000Z"),
    });

    const active = (await slLoadRegistry(root)).artifacts.find(
      (artifact) => artifact.id === artifactId,
    );
    const activeIndex = JSON.parse(
      await readFile(
        join(root, ".github", "SL-learning", "SL-index.json"),
        "utf8",
      ),
    ) as {
      artifacts: Array<{
        id: string;
        usageProjection?: { verifiedSuccessCount: number };
      }>;
    };
    expect(active).toMatchObject({
      status: "active",
      lastSuccessfulUseAt: "2026-01-04T01:00:00.000Z",
    });
    expect(activeIndex.artifacts).toContainEqual(
      expect.objectContaining({
        id: artifactId,
        usageProjection: expect.objectContaining({
          verifiedSuccessCount: 1,
        }),
      }),
    );
  });

  test("uses merged verified-success projection for forgetting decisions", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await prepareLesson(root, "Projection protected evidence");
    const contentHash = slArtifactUsageContentHash(
      await readFile(join(root, ...lesson.path.split("/")), "utf8"),
    );
    await slWriteUsageEvent(
      root,
      slCreateUsageEvent({
        artifactId: lesson.id,
        artifactContentHash: contentHash,
        taskRunId: "forgetting-task",
        applicationId: "forgetting-application",
        stage: "verified",
        outcome: "success",
        verifierType: "integration-test",
        timestamp: "2026-04-01T00:00:00.000Z",
        idempotencyKey: "forgetting-success",
      }),
      false,
    );

    await slSweep(root, false, new Date("2026-04-02T00:00:00.000Z"));

    expect(
      (await slLoadRegistry(root)).artifacts.find(
        (artifact) => artifact.id === lesson.id,
      ),
    ).toMatchObject({
      status: "raw",
      lastSuccessfulUseAt: "2026-04-01T00:00:00.000Z",
    });
  });

  test("reports projection and index drift until immutable events are projected", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await prepareLesson(root, "Projection drift evidence");
    const contentHash = slArtifactUsageContentHash(
      await readFile(join(root, ...lesson.path.split("/")), "utf8"),
    );
    await writeMergedSuccess(root, lesson.id, contentHash, 1);

    const drift = await slValidateRepository(root);
    expect(drift).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "usage-projection-drift" }),
        expect.objectContaining({ code: "index-drift" }),
      ]),
    );

    await slSynchronizeUsageProjection(root, false);
    expect(
      (await slValidateRepository(root)).filter(
        (issue) => issue.severity === "error",
      ),
    ).toEqual([]);
  });

  test("validates every immutable event file and cross-event invariant", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await prepareLesson(root, "Event validation evidence");
    const contentHash = slArtifactUsageContentHash(
      await readFile(join(root, ...lesson.path.split("/")), "utf8"),
    );
    const validEvent = slCreateUsageEvent({
      artifactId: lesson.id,
      artifactContentHash: contentHash,
      taskRunId: "validation-task",
      applicationId: "validation-application",
      stage: "verified",
      outcome: "success",
      verifierType: "integration-test",
      timestamp: "2026-02-01T00:00:00.000Z",
      idempotencyKey: "validation-event",
    });
    const validChange = await slWriteUsageEvent(root, validEvent, false);
    const duplicatePath = join(
      root,
      ".github",
      "SL-learning",
      "SL-usage-events",
      "2026-02",
      "SL-usage-DUPLICATE.json",
    );
    await copyFile(
      join(root, ...validChange.path.split("/")),
      duplicatePath,
    );
    const unknownEvent = slCreateUsageEvent({
      artifactId: "SL-UNKNOWN-ARTIFACT",
      artifactContentHash: contentHash,
      taskRunId: "unknown-task",
      applicationId: "unknown-application",
      stage: "verified",
      outcome: "failure",
      verifierType: "integration-test",
      timestamp: "2026-02-02T00:00:00.000Z",
      idempotencyKey: "unknown-event",
    });
    await slWriteUsageEvent(root, unknownEvent, false);
    const invalidVersion = {
      ...slCreateUsageEvent({
        artifactId: lesson.id,
        artifactContentHash: contentHash,
        taskRunId: "invalid-version-task",
        applicationId: "invalid-version-application",
        stage: "verified" as const,
        outcome: "success" as const,
        verifierType: "integration-test",
        timestamp: "2026-02-03T00:00:00.000Z",
        idempotencyKey: "invalid-version-event",
      }),
      artifactVersion: `sha256:${"f".repeat(64)}`,
    };
    const invalidVersionPath = join(
      root,
      ".github",
      "SL-learning",
      "SL-usage-events",
      "2026-02",
      `SL-usage-${invalidVersion.eventId.slice("SL-USE-".length)}.json`,
    );
    await writeFile(
      invalidVersionPath,
      `${JSON.stringify(invalidVersion, null, 2)}\n`,
      "utf8",
    );
    const lifecycleFiles = await fg(
      ".github/SL-learning/SL-lifecycle-events/**/*.json",
      { cwd: root },
    );
    const lifecyclePath = lifecycleFiles[0];
    if (!lifecyclePath) {
      throw new Error("Expected capture lifecycle event.");
    }
    await copyFile(
      join(root, ...lifecyclePath.split("/")),
      join(
        root,
        ".github",
        "SL-learning",
        "SL-lifecycle-events",
        "2026-01",
        "SL-event-DUPLICATE.json",
      ),
    );

    const issues = await slValidateRepository(root);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "usage-event-path" }),
        expect.objectContaining({ code: "usage-event-duplicate-id" }),
        expect.objectContaining({ code: "usage-event-artifact" }),
        expect.objectContaining({ code: "usage-event-integrity" }),
        expect.objectContaining({ code: "lifecycle-event-path" }),
        expect.objectContaining({ code: "lifecycle-event-duplicate-id" }),
      ]),
    );
  });

  test("reports duplicate stages, conflicting outcomes, and reused application identities", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await prepareLesson(root, "Application invariant evidence");
    const lessonPath = join(root, ...lesson.path.split("/"));
    const firstHash = slArtifactUsageContentHash(
      await readFile(lessonPath, "utf8"),
    );
    const applicationId = "shared-application";
    const events = [
      slCreateUsageEvent({
        artifactId: lesson.id,
        artifactContentHash: firstHash,
        taskRunId: "shared-task",
        applicationId,
        stage: "selected",
        outcome: "unknown",
        verifierType: "unverified",
        timestamp: "2026-02-01T00:00:00.000Z",
        idempotencyKey: "duplicate-selected-1",
      }),
      slCreateUsageEvent({
        artifactId: lesson.id,
        artifactContentHash: firstHash,
        taskRunId: "shared-task",
        applicationId,
        stage: "selected",
        outcome: "unknown",
        verifierType: "unverified",
        timestamp: "2026-02-01T01:00:00.000Z",
        idempotencyKey: "duplicate-selected-2",
      }),
      slCreateUsageEvent({
        artifactId: lesson.id,
        artifactContentHash: firstHash,
        taskRunId: "shared-task",
        applicationId,
        stage: "verified",
        outcome: "success",
        verifierType: "test-suite",
        timestamp: "2026-02-01T02:00:00.000Z",
        idempotencyKey: "conflicting-outcome-success",
      }),
      slCreateUsageEvent({
        artifactId: lesson.id,
        artifactContentHash: firstHash,
        taskRunId: "different-task",
        applicationId,
        stage: "verified",
        outcome: "failure",
        verifierType: "test-suite",
        timestamp: "2026-02-01T03:00:00.000Z",
        idempotencyKey: "conflicting-outcome-failure",
      }),
    ];
    await Promise.all(
      events.map((event) => slWriteUsageEvent(root, event, false)),
    );

    const issues = (await slValidateRepository(root))
      .filter((issue) => issue.code.startsWith("usage-application-"))
      .map(({ code, message }) => ({ code, message }))
      .sort((left, right) =>
        `${left.code}:${left.message}`.localeCompare(
          `${right.code}:${right.message}`,
        ),
      );

    expect(issues).toEqual([
      {
        code: "usage-application-duplicate-stage",
        message:
          "Application shared-application has 2 distinct selected events.",
      },
      {
        code: "usage-application-duplicate-stage",
        message:
          "Application shared-application has 2 distinct verified events.",
      },
      {
        code: "usage-application-identity",
        message:
          "Application shared-application is bound to conflicting artifact identity data.",
      },
      {
        code: "usage-application-outcome",
        message:
          "Application shared-application has conflicting terminal outcomes.",
      },
    ]);
  });

  test("keeps usage, evaluation, and activation dry runs side-effect free", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const source = await prepareLesson(root, "Dry run source");
    const registryPath = join(
      root,
      ".github",
      "SL-learning",
      "SL-registry.json",
    );
    const indexPath = join(root, ".github", "SL-learning", "SL-index.json");
    const beforeUsageRegistry = await readFile(registryPath, "utf8");
    const beforeUsageIndex = await readFile(indexPath, "utf8");

    await slStartUsage(root, source.id, {
      applicationId: "dry-run-application",
      taskRunId: "dry-run-task",
      idempotencyKey: "dry-run-start",
      now: new Date("2026-01-02T00:00:00.000Z"),
      dryRun: true,
    });
    expect(await readFile(registryPath, "utf8")).toBe(beforeUsageRegistry);
    expect(await readFile(indexPath, "utf8")).toBe(beforeUsageIndex);
    expect(
      await pathExists(
        join(root, ".github", "SL-learning", "SL-usage-events"),
      ),
    ).toBe(false);

    const actualStart = await slStartUsage(root, source.id, {
      applicationId: "dry-run-finish-application",
      taskRunId: "dry-run-finish-task",
      idempotencyKey: "dry-run-finish-start",
      now: new Date("2026-01-02T01:00:00.000Z"),
    });
    const beforeFinishRegistry = await readFile(registryPath, "utf8");
    const beforeFinishIndex = await readFile(indexPath, "utf8");
    const beforeFinishEvents = await fg(
      ".github/SL-learning/SL-usage-events/**/*.json",
      { cwd: root },
    );
    await slFinishUsage(root, actualStart.applicationId, {
      outcome: "success",
      verified: true,
      verifierType: "integration-test",
      evidenceRef: "ci:dry-run-finish",
      idempotencyKey: "dry-run-finish",
      now: new Date("2026-01-02T02:00:00.000Z"),
      dryRun: true,
    });
    expect(await readFile(registryPath, "utf8")).toBe(beforeFinishRegistry);
    expect(await readFile(indexPath, "utf8")).toBe(beforeFinishIndex);
    expect(
      await fg(".github/SL-learning/SL-usage-events/**/*.json", {
        cwd: root,
      }),
    ).toEqual(beforeFinishEvents);

    const artifactId = "SL-DRY-RUN-PROMOTION";
    const artifactPath = `.github/skills/${artifactId}/SKILL.md`;
    const contractPath = slTestContractPath(artifactId);
    const scriptPath = "SL-contract-checks/SL-dry-run-marker.mjs";
    const markerPath = join(root, "SL-dry-run-marker.txt");
    await mkdir(dirname(join(root, scriptPath)), { recursive: true });
    await writeFile(
      join(root, scriptPath),
      'import { writeFileSync } from "node:fs"; writeFileSync("SL-dry-run-marker.txt", "ran");\n',
      "utf8",
    );
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
        executableChecks: [
          {
            id: "dry-run-marker",
            command: "node",
            arguments: [scriptPath],
            timeoutMs: 1000,
            expectedExitCode: 0,
          },
        ],
      }),
    );
    await slRegisterPromotion(root, source.id, artifactPath, false, CAPTURED_AT);
    const beforeEvaluation = await readFile(registryPath, "utf8");
    const dryEvaluation = await slEvaluatePromotionReadiness(
      root,
      artifactId,
      {
        approval: {
          kind: "repository-review",
          evidenceRef: "review:dry-run",
        },
        executeCommands: true,
        dryRun: true,
        now: new Date("2026-01-03T00:00:00.000Z"),
      },
    );
    expect(dryEvaluation.evaluation.status).toBe("failed");
    expect(await pathExists(markerPath)).toBe(false);
    expect(await readFile(registryPath, "utf8")).toBe(beforeEvaluation);

    await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:dry-run",
      },
      executeCommands: true,
      now: new Date("2026-01-04T00:00:00.000Z"),
    });
    await rm(markerPath);
    const beforeActivation = await readFile(registryPath, "utf8");
    const probation = (await slLoadRegistry(root)).artifacts.find(
      (artifact) => artifact.id === artifactId,
    );
    await slActivatePromotion(
      root,
      artifactId,
      true,
      new Date("2026-01-05T00:00:00.000Z"),
    );
    expect(await readFile(registryPath, "utf8")).toBe(beforeActivation);
    expect(await pathExists(join(root, ...artifactPath.split("/")))).toBe(false);
    expect(
      await pathExists(join(root, ...probation!.path!.split("/"))),
    ).toBe(true);
  });

  test("installs validation and integrated forgetting workflows", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);

    const validationWorkflow = await readFile(
      join(root, ".github", "workflows", "SL-learning-validation.yml"),
      "utf8",
    );
    const forgettingWorkflow = await readFile(
      join(root, ".github", "workflows", "SL-learning-forget.yml"),
      "utf8",
    );
    type WorkflowStep = {
      name?: string;
      uses?: string;
      run?: string;
      if?: string;
      with?: Record<string, unknown>;
    };
    const validation = parse(validationWorkflow) as {
      permissions: { contents: string };
      jobs: { validate: { steps: WorkflowStep[] } };
    };
    const forgetting = parse(forgettingWorkflow) as {
      permissions: { contents: string };
      jobs: {
        plan: {
          permissions: { contents: string };
          steps: WorkflowStep[];
        };
        propose: {
          permissions: { contents: string; "pull-requests": string };
          steps: WorkflowStep[];
        };
      };
    };
    const validationSteps = new Map(
      validation.jobs.validate.steps
        .filter((step) => typeof step.name === "string")
        .map((step) => [step.name!, step]),
    );
    const planningSteps = new Map(
      forgetting.jobs.plan.steps
        .filter((step) => typeof step.name === "string")
        .map((step) => [step.name!, step]),
    );
    const proposalSteps = new Map(
      forgetting.jobs.propose.steps
        .filter((step) => typeof step.name === "string")
        .map((step) => [step.name!, step]),
    );
    const validationCheckouts = validation.jobs.validate.steps.filter(
      (step) => step.uses === "actions/checkout@v4",
    );
    const planningCheckouts = forgetting.jobs.plan.steps.filter(
      (step) => step.uses?.startsWith("actions/checkout@"),
    );
    const proposalCheckouts = forgetting.jobs.propose.steps.filter(
      (step) => step.uses?.startsWith("actions/checkout@"),
    );

    expect(validation.permissions).toEqual({ contents: "read" });
    expect(forgetting.permissions).toEqual({ contents: "read" });
    expect(forgetting.jobs.plan.permissions).toEqual({ contents: "read" });
    expect(forgetting.jobs.propose.permissions).toEqual({
      contents: "write",
      "pull-requests": "write",
    });
    expect(validationCheckouts).toHaveLength(2);
    expect(planningCheckouts).toHaveLength(2);
    expect(proposalCheckouts).toHaveLength(1);
    for (const checkout of [
      ...validationCheckouts,
      ...planningCheckouts,
      ...proposalCheckouts,
    ]) {
      expect(checkout.with?.["persist-credentials"]).toBe(false);
    }
    expect(validationSteps.get("Check out SL Repo runtime")).toEqual({
      name: "Check out SL Repo runtime",
      uses: "actions/checkout@v4",
      with: {
        repository: "fabri777/SL-Repo",
        ref: SL_RUNTIME_COMMIT,
        token: "${{ secrets.SL_REPO_TOKEN }}",
        path: ".SL-tool",
        "persist-credentials": false,
      },
    });
    expect(
      [
        ...forgetting.jobs.plan.steps,
        ...forgetting.jobs.propose.steps,
      ].flatMap((step) => (step.uses === undefined ? [] : [step.uses])),
    ).toEqual([
      CHECKOUT_ACTION,
      SETUP_NODE_ACTION,
      CHECKOUT_ACTION,
      UPLOAD_ARTIFACT_ACTION,
      CHECKOUT_ACTION,
      DOWNLOAD_ARTIFACT_ACTION,
      CREATE_PULL_REQUEST_ACTION,
    ]);
    expect(planningSteps.get("Check out SL Repo runtime")?.with?.ref).toBe(
      SL_RUNTIME_COMMIT,
    );
    expect(SL_RUNTIME_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(`${validationWorkflow}\n${forgettingWorkflow}`).not.toMatch(
      /\bref:\s*(?:main|master|refs\/heads\/\S+)\b/i,
    );
    expect(
      validationSteps.get(
        "Validate contracts, events, projections, and index",
      ),
    ).toEqual({
      name: "Validate contracts, events, projections, and index",
      run: "node .SL-tool/dist/SL-src/SL-cli/SL-cli.js validate .",
    });
    expect(planningSteps.get("Preview")).toEqual({
      name: "Preview",
      run: "node .SL-tool/dist/SL-src/SL-cli/SL-cli.js sweep . --dry-run",
    });
    expect(planningSteps.get("Apply")).toEqual({
      name: "Apply",
      if: "${{ github.event_name == 'workflow_dispatch' && inputs.apply }}",
      run:
        "node .SL-tool/dist/SL-src/SL-cli/SL-cli.js sweep .\n" +
        "node .SL-tool/dist/SL-src/SL-cli/SL-cli.js validate .\n",
    });
    expect(planningSteps.get("Remove SL Repo runtime checkout")).toEqual({
      name: "Remove SL Repo runtime checkout",
      if: "always()",
      run: "rm -rf .SL-tool",
    });
    expect(planningSteps.get("Capture retention patch")?.run).toContain(
      "git diff --cached --binary --full-index",
    );
    expect(proposalSteps.get("Apply reviewed retention patch")?.run).toContain(
      "git apply --check --binary",
    );
    expect(proposalSteps.get("Create pull request")?.with?.token).toBe(
      "${{ secrets.GITHUB_TOKEN }}",
    );
    expect(proposalSteps.get("Create pull request")?.uses).toBe(
      CREATE_PULL_REQUEST_ACTION,
    );
    expect(JSON.stringify(forgetting.jobs.plan.steps)).not.toContain(
      "secrets.GITHUB_TOKEN",
    );
    expect(JSON.stringify(forgetting.jobs.propose.steps)).not.toContain(
      "fabri777/SL-Repo",
    );
    expect(JSON.stringify(forgetting.jobs.propose.steps)).not.toContain(
      ".SL-tool",
    );
    expect(forgettingWorkflow).not.toContain("gh pr merge");
  });
});
