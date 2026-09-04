import {
  access,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slParseMarkdown } from "../../SL-src/SL-core/SL-frontmatter.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import {
  slActivatePromotion,
  slEvaluatePromotionReadiness,
  slRegisterPromotion,
} from "../../SL-src/SL-core/SL-promotion.js";
import {
  slFinishUsage,
  slStartUsage,
} from "../../SL-src/SL-core/SL-usage.js";
import {
  slLoadRegistry,
  slSaveRegistry,
} from "../../SL-src/SL-core/SL-registry.js";
import { slVoteOnLesson } from "../../SL-src/SL-core/SL-vote.js";
import {
  SL_DEFAULT_SCOPE,
  slScopeCatalogEntry,
} from "../../SL-src/SL-core/SL-state.js";
import type {
  SLChange,
  SLRegistryArtifact,
} from "../../SL-src/SL-core/SL-types.js";
import {
  slForgetArtifact,
  slRestoreArtifact,
  slSweep,
} from "../../SL-src/SL-forgetting/SL-forgetting.js";
import { slWriteIndex } from "../../SL-src/SL-index/SL-index.js";
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

function slDefaultIndexPath(root: string): string {
  return join(root, ...slScopeCatalogEntry(SL_DEFAULT_SCOPE).indexPath.split("/"));
}

function slDefaultRegistryPath(root: string): string {
  return join(
    root,
    ...slScopeCatalogEntry(SL_DEFAULT_SCOPE).registryPath.split("/"),
  );
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

async function slPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function slCreateSource(root: string, title: string) {
  return slCaptureLesson(root, {
    title,
    kind: "win",
    scope: "promotion-lifecycle",
    triggers: [title.toLowerCase()],
    dryRun: false,
    now: FIXED_NOW,
  });
}

async function slPreparePromotion(options: {
  root: string;
  sourceId: string;
  artifactId: string;
  artifactType?: "instruction" | "skill";
  declarations?: Array<{
    key: string;
    value: string | number | boolean;
  }>;
  executableChecks?: Array<{
    id: string;
    command: "node" | "npm";
    arguments: string[];
    timeoutMs: number;
    expectedExitCode: number;
  }>;
}): Promise<{ artifactPath: string; contractPath: string }> {
  const artifactType = options.artifactType ?? "instruction";
  const artifactPath =
    artifactType === "instruction"
      ? `.github/instructions/${options.artifactId}.instructions.md`
      : `.github/skills/${options.artifactId}/SKILL.md`;
  const contractPath = slTestContractPath(options.artifactId);
  await slWriteTestPromotedArtifact({
    root: options.root,
    artifactId: options.artifactId,
    artifactType,
    artifactPath,
    contractPath,
  });
  await slWriteTestJson(
    options.root,
    contractPath,
    slCreateTestContract({
      artifactId: options.artifactId,
      artifactType,
      artifactPath,
      sourceIds: [options.sourceId],
      ...(options.declarations
        ? { declarations: options.declarations }
        : {}),
      ...(options.executableChecks
        ? { executableChecks: options.executableChecks }
        : {}),
    }),
  );
  return { artifactPath, contractPath };
}

async function slArtifact(
  root: string,
  artifactId: string,
): Promise<SLRegistryArtifact> {
  const registry = await slLoadRegistry(root);
  const artifact = registry.artifacts.find(
    (candidate) => candidate.id === artifactId,
  );
  if (!artifact) {
    throw new Error(`Missing test artifact ${artifactId}.`);
  }
  return artifact;
}

async function slPrepareConflictingPromotions(root: string) {
  const firstSource = await slCreateSource(root, "Conflict first");
  const secondSource = await slCreateSource(root, "Conflict second");
  const firstId = "SL-CONFLICT-FIRST";
  const secondId = "SL-CONFLICT-SECOND";
  const first = await slPreparePromotion({
    root,
    sourceId: firstSource.id,
    artifactId: firstId,
    declarations: [{ key: "tests.runner", value: "vitest" }],
  });
  const second = await slPreparePromotion({
    root,
    sourceId: secondSource.id,
    artifactId: secondId,
    declarations: [{ key: "tests.runner", value: "jest" }],
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
  return { firstId, secondId, first, second };
}

describe("SL promotion", () => {
  test("registers validated generated guidance into non-active probation", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Probation registration");
    const artifactId = "SL-PROBATION-REGISTRATION";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });

    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );

    const artifact = await slArtifact(root, artifactId);
    const index = JSON.parse(
      await readFile(
        slDefaultIndexPath(root),
        "utf8",
      ),
    ) as { artifacts: Array<{ id: string }> };
    expect(artifact).toMatchObject({
      status: "probation",
      promotionTargetPath: prepared.artifactPath,
      classification: "promoted",
    });
    expect(artifact.path).toBe(
      `.github/SL-learning/SL-probation/${artifactId}/${artifactId}.instructions.md`,
    );
    expect(
      await slPathExists(join(root, ...prepared.artifactPath.split("/"))),
    ).toBe(false);
    expect(
      slParseMarkdown<Record<string, unknown>>(
        await readFile(join(root, ...artifact.path!.split("/")), "utf8"),
      ).frontmatter.status,
    ).toBe("probation");
    expect(
      slParseMarkdown<Record<string, unknown>>(
        await readFile(join(root, ...source.path.split("/")), "utf8"),
      ).frontmatter.status,
    ).toBe("promoted");
    expect(index.artifacts.some((candidate) => candidate.id === artifactId)).toBe(
      false,
    );
  });

  test("records failed readiness gates and leaves the artifact in probation", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Failed readiness");
    const artifactId = "SL-FAILED-READINESS";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    const contract = slCreateTestContract({
      artifactId,
      artifactType: "instruction",
      artifactPath: prepared.artifactPath,
      sourceIds: [source.id],
    });
    contract.scenarios.push({ ...contract.scenarios[0]! });
    await slWriteTestJson(root, prepared.contractPath, contract);

    const result = await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:failed-readiness",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });

    expect(result.evaluation.status).toBe("failed");
    expect(result.evaluation.gates).toContainEqual({
      id: "static-scenarios",
      status: "failed",
      message: "One or more declared static scenarios failed.",
    });
    expect(await slArtifact(root, artifactId)).toMatchObject({
      status: "probation",
      promotionEvaluation: {
        status: "failed",
        evaluatedAt: "2026-09-03T01:00:00.000Z",
      },
    });
  });

  test("requires explicit repository approval before activation", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Approval required");
    const artifactId = "SL-APPROVAL-REQUIRED";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );

    const result = await slEvaluatePromotionReadiness(root, artifactId, {
      now: new Date("2026-09-03T01:00:00.000Z"),
    });

    expect(result.evaluation.status).toBe("failed");
    expect(result.evaluation.gates).toContainEqual({
      id: "repository-approval",
      status: "failed",
      message: "Explicit repository review approval is missing or invalid.",
    });
    await expect(
      slActivatePromotion(
        root,
        artifactId,
        false,
        new Date("2026-09-03T02:00:00.000Z"),
      ),
    ).rejects.toThrow("does not have a passing promotion evaluation");
    expect(await slArtifact(root, artifactId)).toMatchObject({
      status: "probation",
    });
  });

  test("blocks a probationary declaration that conflicts with active guidance", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const { firstId, secondId } =
      await slPrepareConflictingPromotions(root);
    await slEvaluatePromotionReadiness(root, firstId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:conflict-first",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      firstId,
      false,
      new Date("2026-09-03T02:00:00.000Z"),
    );

    const result = await slEvaluatePromotionReadiness(root, secondId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:conflict-second",
      },
      now: new Date("2026-09-03T03:00:00.000Z"),
    });

    expect(result.evaluation.gates).toContainEqual({
      id: "active-conflicts",
      status: "failed",
      message:
        "A declared conflict exists or active guidance could not be validated.",
    });
    expect(await slArtifact(root, secondId)).toMatchObject({
      status: "probation",
    });
  });

  test("rejects stale passing gates when conflicting probation artifacts were evaluated before activation", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const { firstId, secondId, second } =
      await slPrepareConflictingPromotions(root);

    const firstEvaluation = await slEvaluatePromotionReadiness(root, firstId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:stale-conflict-first",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    const secondEvaluation = await slEvaluatePromotionReadiness(
      root,
      secondId,
      {
        approval: {
          kind: "repository-review",
          evidenceRef: "review:stale-conflict-second",
        },
        now: new Date("2026-09-03T01:30:00.000Z"),
      },
    );

    expect(firstEvaluation.evaluation.status).toBe("passed");
    expect(secondEvaluation.evaluation.status).toBe("passed");
    await slActivatePromotion(
      root,
      firstId,
      false,
      new Date("2026-09-03T02:00:00.000Z"),
    );
    await expect(
      slActivatePromotion(
        root,
        secondId,
        false,
        new Date("2026-09-03T02:30:00.000Z"),
      ),
    ).rejects.toThrow(
      `Artifact ${secondId} activation gates changed and it remains in probation.`,
    );

    expect(await slArtifact(root, secondId)).toMatchObject({
      status: "probation",
      promotionEvaluation: {
        status: "failed",
        gates: expect.arrayContaining([
          {
            id: "active-conflicts",
            status: "failed",
            message:
              "A declared conflict exists or active guidance could not be validated.",
          },
        ]),
      },
    });
    expect(
      await slPathExists(join(root, ...second.artifactPath.split("/"))),
    ).toBe(false);
  });

  test("serializes concurrent activation of conflicting probation artifacts", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const { firstId, secondId } =
      await slPrepareConflictingPromotions(root);
    await slEvaluatePromotionReadiness(root, firstId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:concurrent-conflict-first",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });

    await slEvaluatePromotionReadiness(root, secondId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:concurrent-conflict-second",
      },
      now: new Date("2026-09-03T01:30:00.000Z"),
    });

    const results = await Promise.allSettled([
      slActivatePromotion(
        root,
        firstId,
        false,
        new Date("2026-09-03T02:00:00.000Z"),
      ),
      slActivatePromotion(
        root,
        secondId,
        false,
        new Date("2026-09-03T02:00:00.000Z"),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    const artifacts = (await slLoadRegistry(root)).artifacts.filter(
      (artifact) => artifact.id === firstId || artifact.id === secondId,
    );
    expect(
      artifacts.filter((artifact) => artifact.status === "active"),
    ).toHaveLength(1);
    expect(
      artifacts.filter((artifact) => artifact.status === "probation"),
    ).toHaveLength(1);
    expect(
      artifacts.find((artifact) => artifact.status === "probation"),
    ).toMatchObject({
      promotionEvaluation: {
        status: "failed",
        gates: expect.arrayContaining([
          expect.objectContaining({
            id: "active-conflicts",
            status: "failed",
          }),
        ]),
      },
    });
  });

  test("verified usage returns stale promoted guidance to probation and rechecks new conflicts", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const firstSource = await slCreateSource(root, "Reactivation first");
    const secondSource = await slCreateSource(root, "Reactivation second");
    const firstId = "SL-REACTIVATION-FIRST";
    const secondId = "SL-REACTIVATION-SECOND";
    const first = await slPreparePromotion({
      root,
      sourceId: firstSource.id,
      artifactId: firstId,
      declarations: [{ key: "tests.runner", value: "vitest" }],
    });
    const second = await slPreparePromotion({
      root,
      sourceId: secondSource.id,
      artifactId: secondId,
      declarations: [{ key: "tests.runner", value: "jest" }],
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
        evidenceRef: "review:reactivation-first",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      firstId,
      false,
      new Date("2026-09-03T02:00:00.000Z"),
    );
    const usage = await slStartUsage(root, firstId, {
      applicationId: "reactivation-usage",
      now: new Date("2026-09-03T03:00:00.000Z"),
    });

    await slSweep(root, false, new Date("2027-09-04T00:00:00.000Z"));
    expect(await slArtifact(root, firstId)).toMatchObject({
      status: "stale",
      previousStatus: "active",
    });
    await slRegisterPromotion(
      root,
      secondSource.id,
      second.artifactPath,
      false,
      new Date("2027-09-04T01:00:00.000Z"),
    );
    await slEvaluatePromotionReadiness(root, secondId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:reactivation-second",
      },
      now: new Date("2027-09-04T02:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      secondId,
      false,
      new Date("2027-09-04T03:00:00.000Z"),
    );

    await slFinishUsage(root, usage.applicationId, {
      outcome: "success",
      verified: true,
      verifierType: "test-suite",
      evidenceRef: "ci:reactivation-usage",
      now: new Date("2027-09-05T00:00:00.000Z"),
    });

    const probationPath =
      `.github/SL-learning/SL-probation/${firstId}/${firstId}.instructions.md`;
    expect(await slArtifact(root, firstId)).toMatchObject({
      status: "probation",
      path: probationPath,
      promotionTargetPath: first.artifactPath,
      lastSuccessfulUseAt: "2027-09-05T00:00:00.000Z",
      usageProjection: {
        verifiedSuccessCount: 1,
      },
    });
    expect((await slArtifact(root, firstId)).promotionEvaluation).toBeUndefined();
    expect(await slPathExists(join(root, ...first.artifactPath.split("/")))).toBe(
      false,
    );
    expect(
      slParseMarkdown<Record<string, unknown>>(
        await readFile(join(root, ...probationPath.split("/")), "utf8"),
      ).frontmatter.status,
    ).toBe("probation");
    let index = JSON.parse(
      await readFile(
        slDefaultIndexPath(root),
        "utf8",
      ),
    ) as { artifacts: Array<{ id: string; status: string }> };
    expect(index.artifacts.some((artifact) => artifact.id === firstId)).toBe(
      false,
    );
    await expect(
      slActivatePromotion(
        root,
        firstId,
        false,
        new Date("2027-09-05T01:00:00.000Z"),
      ),
    ).rejects.toThrow("does not have a passing promotion evaluation");

    const blocked = await slEvaluatePromotionReadiness(root, firstId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:reactivation-blocked",
      },
      now: new Date("2027-09-05T02:00:00.000Z"),
    });
    expect(blocked.evaluation.gates).toContainEqual(
      expect.objectContaining({
        id: "active-conflicts",
        status: "failed",
      }),
    );
    await slForgetArtifact(
      root,
      secondId,
      "superseded",
      false,
      new Date("2027-09-06T00:00:00.000Z"),
    );
    const readiness = await slEvaluatePromotionReadiness(root, firstId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:reactivation-approved",
      },
      now: new Date("2027-09-07T00:00:00.000Z"),
    });
    expect(readiness.evaluation.status).toBe("passed");
    await slActivatePromotion(
      root,
      firstId,
      false,
      new Date("2027-09-08T00:00:00.000Z"),
    );
    index = JSON.parse(
      await readFile(
        slDefaultIndexPath(root),
        "utf8",
      ),
    ) as { artifacts: Array<{ id: string; status: string }> };
    expect(index.artifacts).toContainEqual(
      expect.objectContaining({ id: firstId, status: "active" }),
    );
  });

  test("occupied probation path leaves stale reactivation ownership unchanged", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Occupied stale reactivation");
    const artifactId = "SL-OCCUPIED-STALE-REACTIVATION";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:occupied-stale-reactivation",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      artifactId,
      false,
      new Date("2026-09-03T02:00:00.000Z"),
    );
    const usage = await slStartUsage(root, artifactId, {
      applicationId: "occupied-stale-reactivation",
      now: new Date("2026-09-03T03:00:00.000Z"),
    });
    await slSweep(root, false, new Date("2027-09-04T00:00:00.000Z"));
    const beforeRegistry = await slLoadRegistry(root);
    const beforeArtifact = await slArtifact(root, artifactId);
    const sourcePath = join(root, ...beforeArtifact.path!.split("/"));
    const beforeSource = await readFile(sourcePath, "utf8");
    const probationPath =
      `.github/SL-learning/SL-probation/${artifactId}/${artifactId}.instructions.md`;
    const occupiedPath = join(root, ...probationPath.split("/"));
    await mkdir(dirname(occupiedPath), { recursive: true });
    await writeFile(occupiedPath, "occupied probation destination\n", "utf8");

    await expect(
      slFinishUsage(root, usage.applicationId, {
        outcome: "success",
        verified: true,
        verifierType: "test-suite",
        evidenceRef: "ci:occupied-stale-reactivation",
        now: new Date("2027-09-05T00:00:00.000Z"),
      }),
    ).rejects.toThrow(
      `Promotion probation path already exists: ${probationPath}`,
    );

    expect(await slLoadRegistry(root)).toEqual(beforeRegistry);
    expect(await readFile(sourcePath, "utf8")).toBe(beforeSource);
    expect(
      slParseMarkdown<Record<string, unknown>>(beforeSource).frontmatter.status,
    ).toBe("stale");
    expect(await readFile(occupiedPath, "utf8")).toBe(
      "occupied probation destination\n",
    );
  });

  test("occupied probation path leaves quarantined restore ownership unchanged", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Occupied quarantine restore");
    const artifactId = "SL-OCCUPIED-QUARANTINE-RESTORE";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:occupied-quarantine-restore",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      artifactId,
      false,
      new Date("2026-09-03T02:00:00.000Z"),
    );
    await slForgetArtifact(
      root,
      artifactId,
      "irrelevant",
      false,
      new Date("2026-09-04T00:00:00.000Z"),
    );
    const beforeRegistry = await slLoadRegistry(root);
    const beforeArtifact = await slArtifact(root, artifactId);
    const quarantinePath = join(root, ...beforeArtifact.path!.split("/"));
    const beforeQuarantine = await readFile(quarantinePath, "utf8");
    const probationPath =
      `.github/SL-learning/SL-probation/${artifactId}/${artifactId}.instructions.md`;
    const occupiedPath = join(root, ...probationPath.split("/"));
    await mkdir(dirname(occupiedPath), { recursive: true });
    await writeFile(occupiedPath, "occupied probation destination\n", "utf8");

    await expect(
      slRestoreArtifact(
        root,
        artifactId,
        false,
        new Date("2026-09-05T00:00:00.000Z"),
      ),
    ).rejects.toThrow(
      `Promotion probation path already exists: ${probationPath}`,
    );

    expect(await slLoadRegistry(root)).toEqual(beforeRegistry);
    expect(await readFile(quarantinePath, "utf8")).toBe(beforeQuarantine);
    expect(
      slParseMarkdown<Record<string, unknown>>(beforeQuarantine).frontmatter
        .status,
    ).toBe("quarantined");
    expect(await readFile(occupiedPath, "utf8")).toBe(
      "occupied probation destination\n",
    );
  });

  test("undo restores promoted guidance to probation and blocks inactive source evidence", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Undo reactivation source");
    const artifactId = "SL-UNDO-REACTIVATION";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:undo-reactivation-initial",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      artifactId,
      false,
      new Date("2026-09-03T02:00:00.000Z"),
    );
    await slForgetArtifact(
      root,
      artifactId,
      "irrelevant",
      false,
      new Date("2026-09-04T00:00:00.000Z"),
    );
    await slForgetArtifact(
      root,
      source.id,
      "irrelevant",
      false,
      new Date("2026-09-04T01:00:00.000Z"),
    );

    await slRestoreArtifact(
      root,
      artifactId,
      false,
      new Date("2026-09-04T02:00:00.000Z"),
    );

    const restored = await slArtifact(root, artifactId);
    expect(restored).toMatchObject({
      status: "probation",
      path:
        `.github/SL-learning/SL-probation/${artifactId}/${artifactId}.instructions.md`,
      promotionTargetPath: prepared.artifactPath,
    });
    expect(restored.promotionEvaluation).toBeUndefined();
    const indexBeforeActivation = JSON.parse(
      await readFile(
        slDefaultIndexPath(root),
        "utf8",
      ),
    ) as { artifacts: Array<{ id: string }> };
    expect(
      indexBeforeActivation.artifacts.some(
        (artifact) => artifact.id === artifactId,
      ),
    ).toBe(false);
    await expect(
      slActivatePromotion(
        root,
        artifactId,
        false,
        new Date("2026-09-04T03:00:00.000Z"),
      ),
    ).rejects.toThrow("does not have a passing promotion evaluation");

    const blocked = await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:undo-reactivation-blocked",
      },
      now: new Date("2026-09-04T04:00:00.000Z"),
    });
    expect(blocked.evaluation.gates).toContainEqual(
      expect.objectContaining({
        id: "provenance",
        status: "failed",
      }),
    );
    expect(await slValidateRepository(root)).toContainEqual(
      expect.objectContaining({
        code: "promotion-source",
        path: restored.path,
      }),
    );

    await slRestoreArtifact(
      root,
      source.id,
      false,
      new Date("2026-09-05T00:00:00.000Z"),
    );
    const readiness = await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:undo-reactivation-approved",
      },
      now: new Date("2026-09-05T01:00:00.000Z"),
    });
    expect(readiness.evaluation.status).toBe("passed");
    await slActivatePromotion(
      root,
      artifactId,
      false,
      new Date("2026-09-05T02:00:00.000Z"),
    );
    const indexAfterActivation = JSON.parse(
      await readFile(
        slDefaultIndexPath(root),
        "utf8",
      ),
    ) as { artifacts: Array<{ id: string; status: string }> };
    expect(indexAfterActivation.artifacts).toContainEqual(
      expect.objectContaining({ id: artifactId, status: "active" }),
    );
  });

  test("serializes usage projection with promotion activation", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Projection activation race");
    const artifactId = "SL-PROJECTION-ACTIVATION-RACE";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:projection-activation-race",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });

    await Promise.all([
      slVoteOnLesson(
        root,
        source.id,
        "useful",
        false,
        new Date("2026-09-03T02:00:00.000Z"),
        {
          applicationId: "projection-activation-application",
          taskRunId: "projection-activation-task",
          idempotencyKey: "projection-activation-vote",
        },
      ),
      slActivatePromotion(
        root,
        artifactId,
        false,
        new Date("2026-09-03T02:00:00.000Z"),
      ),
    ]);

    expect(await slArtifact(root, artifactId)).toMatchObject({
      status: "active",
      path: prepared.artifactPath,
    });
    expect(await slArtifact(root, source.id)).toMatchObject({
      status: "promoted",
      usageProjection: {
        verifiedSuccessCount: 1,
      },
    });
    const index = JSON.parse(
      await readFile(
        slDefaultIndexPath(root),
        "utf8",
      ),
    ) as {
      artifacts: Array<{
        id: string;
        status: string;
        usageProjection?: { verifiedSuccessCount: number };
      }>;
    };
    expect(index.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: artifactId,
          status: "active",
        }),
        expect.objectContaining({
          id: source.id,
          status: "promoted",
        }),
      ]),
    );
  });

  test("evaluates and activates a full promotion dry run in memory", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Dry run promotion sequence");
    const artifactId = "SL-DRY-RUN-PROMOTION-SEQUENCE";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    const registryPath = slDefaultRegistryPath(root);
    const registryBefore = await readFile(registryPath, "utf8");

    const readiness = await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:dry-run-promotion-sequence",
      },
      dryRun: true,
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    const changes = await slActivatePromotion(
      root,
      artifactId,
      true,
      new Date("2026-09-03T02:00:00.000Z"),
    );

    expect(readiness.evaluation.status).toBe("passed");
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "move",
          path: expect.stringContaining("SL-probation"),
        }),
        expect.objectContaining({
          action: "update",
          path: expect.stringContaining("SL-registry.json"),
          detail: "planned",
        }),
      ]),
    );
    expect(await readFile(registryPath, "utf8")).toBe(registryBefore);
    expect(
      await slPathExists(join(root, ...prepared.artifactPath.split("/"))),
    ).toBe(false);
    expect((await slArtifact(root, artifactId)).status).toBe("probation");
  });

  test("rejects a promoted artifact junction before parsing external YAML", async () => {
    const root = await slCreateTestRepository();
    const outside = await slCreateTestRepository();
    repositories.push(root, outside);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "External promoted artifact");
    const artifactId = "SL-EXTERNAL-PROMOTED-ARTIFACT";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    const instructionRoot = join(root, ".github", "instructions");
    const outsideInstructionRoot = join(outside, "outside-instructions");
    const externalMarker = "EXTERNAL-PARSER-CONTENT-MUST-NOT-LEAK";
    await mkdir(outsideInstructionRoot);
    await writeFile(
      join(outsideInstructionRoot, `${artifactId}.instructions.md`),
      `---\nid: [${externalMarker}\n---\n`,
      "utf8",
    );
    await rm(instructionRoot, { recursive: true });
    await symlink(
      outsideInstructionRoot,
      instructionRoot,
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
    expect(await slArtifact(root, source.id)).toMatchObject({ status: "raw" });
  });

  test("rejects a source lesson junction before parsing external YAML", async () => {
    const root = await slCreateTestRepository();
    const outside = await slCreateTestRepository();
    repositories.push(root, outside);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "External promotion source");
    const artifactId = "SL-EXTERNAL-PROMOTION-SOURCE";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    const sourcePath = join(root, ...source.path.split("/"));
    const sourceRoot = dirname(sourcePath);
    const outsideSourceRoot = join(outside, "outside-lessons");
    const externalMarker = "EXTERNAL-SOURCE-YAML-MUST-NOT-LEAK";
    await mkdir(outsideSourceRoot);
    await writeFile(
      join(outsideSourceRoot, basename(sourcePath)),
      `---\nid: [${externalMarker}\n---\n`,
      "utf8",
    );
    await rm(sourceRoot, { recursive: true });
    await symlink(
      outsideSourceRoot,
      sourceRoot,
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
    expect(await slArtifact(root, source.id)).toMatchObject({ status: "raw" });
    expect(
      await slPathExists(join(root, ...prepared.artifactPath.split("/"))),
    ).toBe(true);
  });

  test("rejects a probation artifact junction before activation parsing", async () => {
    const root = await slCreateTestRepository();
    const outside = await slCreateTestRepository();
    repositories.push(root, outside);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "External probation artifact");
    const artifactId = "SL-EXTERNAL-PROBATION-ARTIFACT";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:external-probation-artifact",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    const before = await slArtifact(root, artifactId);
    const probationPath = join(root, ...before.path!.split("/"));
    const probationRoot = dirname(probationPath);
    const outsideProbationRoot = join(outside, "outside-probation");
    const externalMarker = "EXTERNAL-ACTIVATION-YAML-MUST-NOT-LEAK";
    await mkdir(outsideProbationRoot);
    await writeFile(
      join(outsideProbationRoot, basename(probationPath)),
      `---\nid: [${externalMarker}\n---\n`,
      "utf8",
    );
    await rm(probationRoot, { recursive: true });
    await symlink(
      outsideProbationRoot,
      probationRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    const error = await slActivatePromotion(
      root,
      artifactId,
      false,
      new Date("2026-09-03T02:00:00.000Z"),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "Path resolves outside repository root",
    );
    expect((error as Error).message).not.toContain(externalMarker);
    expect(await slArtifact(root, artifactId)).toEqual(before);
  });

  test("rejects a probation artifact junction before readiness parsing", async () => {
    const root = await slCreateTestRepository();
    const outside = await slCreateTestRepository();
    repositories.push(root, outside);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "External readiness artifact");
    const artifactId = "SL-EXTERNAL-READINESS-ARTIFACT";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    const before = await slArtifact(root, artifactId);
    const probationPath = join(root, ...before.path!.split("/"));
    const probationRoot = dirname(probationPath);
    const outsideProbationRoot = join(outside, "outside-readiness");
    const externalMarker = "EXTERNAL-READINESS-YAML-MUST-NOT-LEAK";
    await mkdir(outsideProbationRoot);
    await writeFile(
      join(outsideProbationRoot, basename(probationPath)),
      `---\nid: [${externalMarker}\n---\n`,
      "utf8",
    );
    await rm(probationRoot, { recursive: true });
    await symlink(
      outsideProbationRoot,
      probationRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    const error = await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:external-readiness-artifact",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "Path resolves outside repository root",
    );
    expect((error as Error).message).not.toContain(externalMarker);
    expect(await slArtifact(root, artifactId)).toEqual(before);
  });

  test("activates only after all configured gates pass", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Successful activation");
    const artifactId = "SL-SUCCESSFUL-ACTIVATION";
    const scriptPath = "SL-contract-checks/SL-pass.mjs";
    await mkdir(join(root, "SL-contract-checks"), { recursive: true });
    await writeFile(join(root, ...scriptPath.split("/")), "process.exit(0);\n");
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
      artifactType: "skill",
      executableChecks: [
        {
          id: "repository-check",
          command: "node",
          arguments: [scriptPath],
          timeoutMs: 1000,
          expectedExitCode: 0,
        },
      ],
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );

    const readiness = await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:successful-activation",
      },
      executeCommands: true,
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      artifactId,
      false,
      new Date("2026-09-03T02:00:00.000Z"),
    );

    const artifact = await slArtifact(root, artifactId);
    const index = JSON.parse(
      await readFile(
        slDefaultIndexPath(root),
        "utf8",
      ),
    ) as { artifacts: Array<{ id: string; status: string }> };
    expect(readiness.evaluation).toMatchObject({
      status: "passed",
      approvalEvidence: {
        kind: "repository-review",
        evidenceRef: "review:successful-activation",
      },
    });
    expect(readiness.evaluation.artifactContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(readiness.evaluation.artifactVersion).toBe(
      `sha256:${readiness.evaluation.artifactContentHash}`,
    );
    expect(artifact).toMatchObject({
      path: prepared.artifactPath,
      promotionTargetPath: prepared.artifactPath,
      status: "active",
      activatedAt: "2026-09-03T02:00:00.000Z",
      promotionEvaluation: {
        status: "passed",
        evaluatedAt: "2026-09-03T02:00:00.000Z",
      },
    });
    expect(
      slParseMarkdown<Record<string, unknown>>(
        await readFile(
          join(root, ...prepared.artifactPath.split("/")),
          "utf8",
        ),
      ).frontmatter.status,
    ).toBe("active");
    expect(index.artifacts).toContainEqual(
      expect.objectContaining({ id: artifactId, status: "active" }),
    );
  });

  test("re-runs executable gates immediately before activation", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Executable activation freshness");
    const artifactId = "SL-EXECUTABLE-ACTIVATION-FRESHNESS";
    const scriptPath = "SL-contract-checks/SL-activation-freshness.mjs";
    await mkdir(join(root, "SL-contract-checks"), { recursive: true });
    await writeFile(join(root, ...scriptPath.split("/")), "process.exit(0);\n");
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
      artifactType: "skill",
      executableChecks: [
        {
          id: "activation-freshness",
          command: "node",
          arguments: [scriptPath],
          timeoutMs: 1000,
          expectedExitCode: 0,
        },
      ],
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:executable-activation-freshness",
      },
      executeCommands: true,
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    await writeFile(join(root, ...scriptPath.split("/")), "process.exit(1);\n");

    await expect(
      slActivatePromotion(
        root,
        artifactId,
        false,
        new Date("2026-09-03T02:00:00.000Z"),
      ),
    ).rejects.toThrow(
      `Artifact ${artifactId} activation gates changed and it remains in probation.`,
    );
    expect(await slArtifact(root, artifactId)).toMatchObject({
      status: "probation",
      promotionEvaluation: {
        status: "failed",
        gates: expect.arrayContaining([
          expect.objectContaining({
            id: "executable-checks",
            status: "failed",
          }),
        ]),
      },
    });
  });

  test("invalidates passing gates when probation content changes", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Content invalidation");
    const artifactId = "SL-CONTENT-INVALIDATION";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:content-invalidation",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    const artifact = await slArtifact(root, artifactId);
    await writeFile(
      join(root, ...artifact.path!.split("/")),
      `${await readFile(join(root, ...artifact.path!.split("/")), "utf8")}\nChanged guidance.\n`,
      "utf8",
    );

    await expect(
      slActivatePromotion(
        root,
        artifactId,
        false,
        new Date("2026-09-03T02:00:00.000Z"),
      ),
    ).rejects.toThrow("changed after evaluation");

    expect(await slArtifact(root, artifactId)).toMatchObject({
      status: "probation",
      promotionEvaluation: {
        status: "failed",
        gates: expect.arrayContaining([
          {
            id: "content-unchanged",
            status: "failed",
            message:
              "Artifact or validation contract content changed after evaluation.",
          },
        ]),
      },
    });
    expect(
      await slPathExists(join(root, ...prepared.artifactPath.split("/"))),
    ).toBe(false);
  });

  test("treats approval and evaluation as stale when the contract changes", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Contract invalidation");
    const artifactId = "SL-CONTRACT-INVALIDATION";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:contract-invalidation",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    const contract = slCreateTestContract({
      artifactId,
      artifactType: "instruction",
      artifactPath: prepared.artifactPath,
      sourceIds: [source.id],
    });
    contract.provenance.summary = "Changed after repository approval.";
    await slWriteTestJson(root, prepared.contractPath, contract);

    const staleIssues = (await slValidateRepository(root)).filter(
      (issue) => issue.code === "promotion-evaluation-stale",
    );
    expect(staleIssues).toEqual([
      {
        severity: "error",
        code: "promotion-evaluation-stale",
        path: `.github/SL-learning/SL-probation/${artifactId}/${artifactId}.instructions.md`,
        message:
          "Probation promotion content changed after its passing evaluation.",
      },
    ]);
    await expect(
      slActivatePromotion(
        root,
        artifactId,
        false,
        new Date("2026-09-03T02:00:00.000Z"),
      ),
    ).rejects.toThrow(
      `Artifact ${artifactId} changed after evaluation and remains in probation.`,
    );
    expect(await slArtifact(root, artifactId)).toMatchObject({
      status: "probation",
      promotionEvaluation: {
        status: "failed",
        approvalEvidence: {
          kind: "repository-review",
          evidenceRef: "review:contract-invalidation",
        },
        gates: expect.arrayContaining([
          {
            id: "content-unchanged",
            status: "failed",
            message:
              "Artifact or validation contract content changed after evaluation.",
          },
        ]),
      },
    });
  });

  test("removes edited active guidance from discovery until re-evaluated", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Active content invalidation");
    const artifactId = "SL-ACTIVE-CONTENT-INVALIDATION";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );
    await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef: "review:active-content-invalidation",
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });
    await slActivatePromotion(
      root,
      artifactId,
      false,
      new Date("2026-09-03T02:00:00.000Z"),
    );
    const activePath = join(root, ...prepared.artifactPath.split("/"));
    await writeFile(
      activePath,
      `${await readFile(activePath, "utf8")}\nEdited after activation.\n`,
      "utf8",
    );
    const registry = await slLoadRegistry(root);
    const changes: SLChange[] = [];
    await slWriteIndex(root, registry, false, changes);

    const index = JSON.parse(
      await readFile(
        slDefaultIndexPath(root),
        "utf8",
      ),
    ) as { artifacts: Array<{ id: string }> };
    const staleIssues = (await slValidateRepository(root)).filter(
      (issue) => issue.code === "promotion-evaluation-stale",
    );
    expect(index.artifacts.some((artifact) => artifact.id === artifactId)).toBe(
      false,
    );
    expect(staleIssues).toEqual([
      {
        severity: "error",
        code: "promotion-evaluation-stale",
        path: prepared.artifactPath,
        message:
          "Active promotion evaluation is missing, failed, or no longer matches artifact and contract content.",
      },
    ]);
  });

  test.each([
    "mailto:reviewer@example.com",
    "file:C:\\Users\\example\\approval.txt",
    "host:10.0.0.1",
    `token:ghp_${"a".repeat(24)}`,
  ])("rejects unsafe approval reference %s", async (evidenceRef) => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, `Unsafe approval ${evidenceRef.length}`);
    const artifactId = `SL-UNSAFE-APPROVAL-${evidenceRef.length}`;
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );

    const result = await slEvaluatePromotionReadiness(root, artifactId, {
      approval: {
        kind: "repository-review",
        evidenceRef,
      },
      now: new Date("2026-09-03T01:00:00.000Z"),
    });

    expect(result.evaluation.status).toBe("failed");
    expect(result.evaluation.approvalEvidence).toBeUndefined();
    expect(
      result.evaluation.gates.find(
        (gate) => gate.id === "repository-approval",
      ),
    ).toEqual({
      id: "repository-approval",
      status: "failed",
      message: "Explicit repository review approval is missing or invalid.",
    });
  });

  test("treats legacy promoted artifacts as active without stranding discovery", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Legacy compatibility");
    const artifactId = "SL-LEGACY-PROMOTED";
    const artifactPath =
      ".github/instructions/SL-LEGACY-PROMOTED.instructions.md";
    await mkdir(join(root, ".github", "instructions"), { recursive: true });
    await writeFile(
      join(root, ...artifactPath.split("/")),
      [
        "---",
        `id: ${artifactId}`,
        "schemaVersion: 1",
        "managedBy: SL-Repo",
        "status: promoted",
        "pinned: false",
        `sourceIds: [${source.id}]`,
        'applyTo: "**/*"',
        "---",
        "",
        "# Legacy promoted guidance",
        "",
      ].join("\n"),
      "utf8",
    );
    const registry = await slLoadRegistry(root);
    registry.artifacts.push({
      id: artifactId,
      path: artifactPath,
      artifactType: "instruction",
      classification: "promoted",
      managedBy: "SL-Repo",
      status: "promoted",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastVerifiedAt: "2026-01-01T00:00:00.000Z",
      pinned: false,
      relatedTo: [source.id],
      dependsOn: [source.id],
    });
    const changes: SLChange[] = [];
    await slSaveRegistry(root, registry, false, changes);
    await slWriteIndex(root, registry, false, changes);

    const issues = await slValidateRepository(root);
    const index = JSON.parse(
      await readFile(
        slDefaultIndexPath(root),
        "utf8",
      ),
    ) as { artifacts: Array<{ id: string }> };
    expect(index.artifacts).toContainEqual(
      expect.objectContaining({ id: artifactId }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "legacy-promoted-compatibility",
        path: artifactPath,
      }),
    );
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  test("applies promoted retention stages to probation without direct deletion", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCreateSource(root, "Probation retention");
    const artifactId = "SL-PROBATION-RETENTION";
    const prepared = await slPreparePromotion({
      root,
      sourceId: source.id,
      artifactId,
    });
    await slRegisterPromotion(
      root,
      source.id,
      prepared.artifactPath,
      false,
      FIXED_NOW,
    );

    await slSweep(root, false, new Date("2027-09-04T00:00:00.000Z"));
    expect(await slArtifact(root, artifactId)).toMatchObject({
      status: "stale",
      previousStatus: "probation",
    });
    await slSweep(root, false, new Date("2027-10-05T00:00:00.000Z"));
    expect(await slArtifact(root, artifactId)).toMatchObject({
      status: "quarantined",
      previousStatus: "stale",
    });
    await slSweep(root, false, new Date("2027-10-18T00:00:00.000Z"));
    expect(await slArtifact(root, artifactId)).toMatchObject({
      status: "quarantined",
    });
    await slSweep(root, false, new Date("2027-11-06T00:00:00.000Z"));
    expect(await slArtifact(root, artifactId)).toMatchObject({
      status: "deleted",
      path: null,
    });
  });

  test("rejects an ID collision with source evidence", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCaptureLesson(root, {
      title: "Promotion source",
      kind: "win",
      scope: "tests",
      triggers: ["promotion source"],
      dryRun: false,
      now: new Date("2026-09-03T00:00:00.000Z"),
    });
    const instructionDirectory = join(root, ".github", "instructions");
    await mkdir(instructionDirectory, { recursive: true });
    await writeFile(
      join(instructionDirectory, "SL-collision.instructions.md"),
      `---\nid: ${source.id}\napplyTo: "**/*"\n---\n\n# Collision\n`,
      "utf8",
    );

    await expect(
      slRegisterPromotion(
        root,
        source.id,
        ".github/instructions/SL-collision.instructions.md",
        false,
      ),
    ).rejects.toThrow("must differ");

    const registry = await slLoadRegistry(root);
    expect(
      registry.artifacts.find((artifact) => artifact.id === source.id),
    ).toMatchObject({
      classification: "evidence",
      status: "raw",
    });
  });

  test("cannot convert an installed system artifact into a promotion", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const source = await slCaptureLesson(root, {
      title: "Protected promotion source",
      kind: "win",
      scope: "tests",
      triggers: ["protected promotion"],
      dryRun: false,
      now: new Date("2026-09-03T00:00:00.000Z"),
    });
    const registry = await slLoadRegistry(root);
    const systemSkill = registry.artifacts.find(
      (artifact) =>
        artifact.classification === "system" &&
        artifact.artifactType === "skill",
    );
    if (!systemSkill?.path) {
      throw new Error("Expected an installed system skill.");
    }
    await writeFile(
      join(root, ...systemSkill.path.split("/")),
      `---\nid: ${systemSkill.id}\nname: SL-bootstrap\n---\n\n# Protected\n`,
      "utf8",
    );

    await expect(
      slRegisterPromotion(root, source.id, systemSkill.path, false),
    ).rejects.toThrow("non-promoted");

    const unchangedRegistry = await slLoadRegistry(root);
    expect(
      unchangedRegistry.artifacts.find(
        (artifact) => artifact.id === systemSkill.id,
      ),
    ).toMatchObject({
      classification: "system",
      pinned: true,
    });
  });

  test("cannot rebind an existing promotion to different evidence", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const firstSource = await slCaptureLesson(root, {
      title: "First promotion source",
      kind: "win",
      scope: "tests",
      triggers: ["first promotion"],
      dryRun: false,
      now: new Date("2026-09-03T00:00:00.000Z"),
    });
    const secondSource = await slCaptureLesson(root, {
      title: "Second promotion source",
      kind: "win",
      scope: "tests",
      triggers: ["second promotion"],
      dryRun: false,
      now: new Date("2026-09-03T00:00:00.000Z"),
    });
    const instructionDirectory = join(root, ".github", "instructions");
    await mkdir(instructionDirectory, { recursive: true });
    const promotedPath = ".github/instructions/SL-shared.instructions.md";
    const contractPath = slTestContractPath("SL-SHARED-PROMOTION");
    await slWriteTestPromotedArtifact({
      root,
      artifactId: "SL-SHARED-PROMOTION",
      artifactType: "instruction",
      artifactPath: promotedPath,
      contractPath,
      body: "# Shared",
    });
    await slWriteTestJson(
      root,
      contractPath,
      slCreateTestContract({
        artifactId: "SL-SHARED-PROMOTION",
        artifactType: "instruction",
        artifactPath: promotedPath,
        sourceIds: [firstSource.id],
      }),
    );
    await slRegisterPromotion(root, firstSource.id, promotedPath, false);

    await expect(
      slRegisterPromotion(root, secondSource.id, promotedPath, false),
    ).rejects.toThrow("different source evidence");

    const registry = await slLoadRegistry(root);
    expect(
      registry.artifacts.find(
        (artifact) => artifact.id === "SL-SHARED-PROMOTION",
      ),
    ).toMatchObject({
      dependsOn: [firstSource.id],
    });
  });
});
