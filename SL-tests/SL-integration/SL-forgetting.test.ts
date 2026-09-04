import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slParseMarkdown } from "../../SL-src/SL-core/SL-frontmatter.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import {
  slFinishUsage,
  slStartUsage,
} from "../../SL-src/SL-core/SL-usage.js";
import {
  slCreateLifecycleEvent,
  slLifecycleEventPath,
  slLoadRegistry,
  slSaveRegistry,
} from "../../SL-src/SL-core/SL-registry.js";
import type { SLChange, SLRegistryArtifact } from "../../SL-src/SL-core/SL-types.js";
import {
  SL_DEFAULT_SCOPE,
  slScopeCatalogEntry,
} from "../../SL-src/SL-core/SL-state.js";
import {
  slForgetArtifact,
  slRestoreArtifact,
  slSweep,
} from "../../SL-src/SL-forgetting/SL-forgetting.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];
const CAPTURED_AT = new Date("2026-01-01T00:00:00.000Z");

function slDefaultIndexPath(root: string): string {
  return join(root, ...slScopeCatalogEntry(SL_DEFAULT_SCOPE).indexPath.split("/"));
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

async function createLesson(root: string, title: string): Promise<string> {
  const result = await slCaptureLesson(root, {
    title,
    kind: "win",
    scope: "tests",
    triggers: [title],
    dryRun: false,
    now: CAPTURED_AT,
  });
  return result.id;
}

async function getArtifact(
  root: string,
  id: string,
): Promise<SLRegistryArtifact> {
  const registry = await slLoadRegistry(root);
  const artifact = registry.artifacts.find((candidate) => candidate.id === id);
  if (!artifact) {
    throw new Error(`Missing test artifact ${id}`);
  }
  return artifact;
}

describe("SL forgetting", () => {
  test("ages evidence through stale, quarantine, and deletion", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const id = await createLesson(root, "Aged evidence");

    await slSweep(root, false, new Date("2026-04-02T00:00:00.000Z"));
    expect(await getArtifact(root, id)).toMatchObject({ status: "stale" });

    await slSweep(root, false, new Date("2026-07-01T00:00:00.000Z"));
    expect(await getArtifact(root, id)).toMatchObject({
      status: "quarantined",
      forgetReason: "unused",
    });

    await slSweep(root, false, new Date("2026-08-01T00:00:00.000Z"));
    expect(await getArtifact(root, id)).toMatchObject({
      status: "deleted",
      path: null,
    });
  });

  test("serializes sweep with usage completion without losing fresh activity", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const id = await createLesson(root, "Sweep usage race");
    const started = await slStartUsage(root, id, {
      applicationId: "sweep-usage-application",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    await Promise.all([
      slSweep(root, false, new Date("2026-09-04T00:00:00.000Z")),
      slFinishUsage(root, started.applicationId, {
        outcome: "success",
        verified: true,
        verifierType: "test-suite",
        evidenceRef: "ci:sweep-usage-race",
        now: new Date("2026-09-05T00:00:00.000Z"),
      }),
    ]);

    expect(await getArtifact(root, id)).toMatchObject({
      status: "raw",
      lastSuccessfulUseAt: "2026-09-05T00:00:00.000Z",
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
      }>;
    };
    expect(index.artifacts.find((artifact) => artifact.id === id)).toMatchObject({
      status: "raw",
    });
  });

  test("quarantines wrong knowledge immediately and supports undo", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const id = await createLesson(root, "Wrong evidence");

    await slForgetArtifact(
      root,
      id,
      "wrong",
      false,
      new Date("2026-01-02T00:00:00.000Z"),
    );
    expect(await getArtifact(root, id)).toMatchObject({
      status: "quarantined",
      forgetReason: "wrong",
    });

    await slRestoreArtifact(
      root,
      id,
      false,
      new Date("2026-01-03T00:00:00.000Z"),
    );
    expect(await getArtifact(root, id)).toMatchObject({
      status: "raw",
    });
  });

  test("restore atomically rejects a destination created after preflight and remains recoverable", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const id = await createLesson(root, "Recreated restore destination");
    await slForgetArtifact(
      root,
      id,
      "wrong",
      false,
      new Date("2026-01-02T00:00:00.000Z"),
    );

    const quarantined = await getArtifact(root, id);
    const quarantinePath = join(root, ...quarantined.path!.split("/"));
    const originalPath = join(root, ...quarantined.originalPath!.split("/"));
    const registryPath = join(
      root,
      ".github",
      "SL-learning",
      "SL-registry.json",
    );
    const indexPath = join(root, ".github", "SL-learning", "SL-index.json");
    const originalQuarantineContent = await readFile(quarantinePath, "utf8");
    const originalRegistryContent = await readFile(registryPath, "utf8");
    const originalIndexContent = await readFile(indexPath, "utf8");
    let destinationInjected = false;

    await expect(
      slRestoreArtifact(
        root,
        id,
        false,
        new Date("2026-01-03T00:00:00.000Z"),
        {
          beforeDestinationLink: async () => {
            destinationInjected = true;
            await mkdir(dirname(originalPath), { recursive: true });
            await writeFile(
              originalPath,
              "# Recreated by another owner\n",
              { encoding: "utf8", flag: "wx" },
            );
          },
        },
      ),
    ).rejects.toThrow(
      `Evidence restore path already exists: ${quarantined.originalPath}`,
    );

    expect(destinationInjected).toBe(true);
    expect(await readFile(quarantinePath, "utf8")).toBe(
      originalQuarantineContent,
    );
    expect(await readFile(originalPath, "utf8")).toBe(
      "# Recreated by another owner\n",
    );
    expect(await readFile(registryPath, "utf8")).toBe(originalRegistryContent);
    expect(await readFile(indexPath, "utf8")).toBe(originalIndexContent);
    expect(await getArtifact(root, id)).toEqual(quarantined);

    await rm(originalPath);
    await slRestoreArtifact(
      root,
      id,
      false,
      new Date("2026-01-03T00:00:00.000Z"),
    );

    expect(await getArtifact(root, id)).toMatchObject({
      path: quarantined.originalPath,
      status: "raw",
    });
    expect(
      slParseMarkdown<Record<string, unknown>>(
        await readFile(originalPath, "utf8"),
      ).frontmatter.status,
    ).toBe("raw");
    await expect(readFile(quarantinePath, "utf8")).rejects.toThrow();
  });

  test("restore move failure preserves quarantined file and registry state", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const id = await createLesson(root, "Restore move failure");
    await slForgetArtifact(
      root,
      id,
      "wrong",
      false,
      new Date("2026-01-02T00:00:00.000Z"),
    );

    const registry = await slLoadRegistry(root);
    const artifact = registry.artifacts.find((candidate) => candidate.id === id)!;
    artifact.originalPath = `${"x".repeat(256)}/SL-restore-move-failure.md`;
    const changes: SLChange[] = [];
    await slSaveRegistry(root, registry, false, changes);

    const quarantinePath = join(root, ...artifact.path!.split("/"));
    const registryPath = join(
      root,
      ".github",
      "SL-learning",
      "SL-registry.json",
    );
    const indexPath = join(root, ".github", "SL-learning", "SL-index.json");
    const originalQuarantineContent = await readFile(quarantinePath, "utf8");
    const originalRegistryContent = await readFile(registryPath, "utf8");
    const originalIndexContent = await readFile(indexPath, "utf8");

    await expect(
      slRestoreArtifact(
        root,
        id,
        false,
        new Date("2026-01-03T00:00:00.000Z"),
      ),
    ).rejects.toThrow();

    expect(await readFile(quarantinePath, "utf8")).toBe(
      originalQuarantineContent,
    );
    expect(await readFile(registryPath, "utf8")).toBe(originalRegistryContent);
    expect(await readFile(indexPath, "utf8")).toBe(originalIndexContent);
    expect(await getArtifact(root, id)).toEqual(artifact);
  });

  test.each([
    {
      name: "pre-existing drifted index bytes",
      indexContent: Buffer.from(
        '{"schemaVersion":1,"artifacts":[{"id":"SL-DRIFTED"}]}\r\n',
        "utf8",
      ),
    },
    {
      name: "originally missing index",
      indexContent: null,
    },
  ])(
    "restore rolls back $name after a later failure",
    async ({ name, indexContent }) => {
      const root = await slCreateTestRepository();
      repositories.push(root);
      await slInstall(root, "init", false);
      const id = await createLesson(root, `Restore transaction ${name}`);
      await slForgetArtifact(
        root,
        id,
        "wrong",
        false,
        new Date("2026-01-02T00:00:00.000Z"),
      );

      const quarantined = await getArtifact(root, id);
      const quarantinePath = join(root, ...quarantined.path!.split("/"));
      const originalPath = join(root, ...quarantined.originalPath!.split("/"));
      const registryPath = join(
        root,
        ".github",
        "SL-learning",
        "SL-registry.json",
      );
      const indexPath = join(root, ".github", "SL-learning", "SL-index.json");
      if (indexContent) {
        await writeFile(indexPath, indexContent);
      } else {
        await rm(indexPath);
      }
      const originalQuarantineContent = await readFile(quarantinePath);
      const originalRegistryContent = await readFile(registryPath);
      const now = new Date("2026-01-03T00:00:00.000Z");
      const eventPath = slLifecycleEventPath(
        slCreateLifecycleEvent({
          schemaVersion: 1,
          timestamp: now.toISOString(),
          artifactId: id,
          action: "restored",
          fromStatus: "quarantined",
          toStatus: "raw",
          fromPath: quarantined.path,
          toPath: quarantined.originalPath!,
        }),
      );
      const absoluteEventPath = join(root, ...eventPath.split("/"));
      const originalEventContent = Buffer.from("{}\r\n", "utf8");
      await mkdir(dirname(absoluteEventPath), { recursive: true });
      await writeFile(absoluteEventPath, originalEventContent);

      await expect(slRestoreArtifact(root, id, false, now)).rejects.toThrow(
        `Immutable SL lifecycle event collision: ${eventPath}`,
      );

      expect(await readFile(quarantinePath)).toEqual(
        originalQuarantineContent,
      );
      await expect(readFile(originalPath)).rejects.toThrow();
      expect(await readFile(registryPath)).toEqual(originalRegistryContent);
      if (indexContent) {
        expect(await readFile(indexPath)).toEqual(indexContent);
      } else {
        await expect(readFile(indexPath)).rejects.toThrow();
      }
      expect(await readFile(absoluteEventPath)).toEqual(originalEventContent);
      expect(await getArtifact(root, id)).toEqual(quarantined);
    },
  );

  test("never ages pinned evidence", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const id = await createLesson(root, "Pinned evidence");
    const registry = await slLoadRegistry(root);
    const artifact = registry.artifacts.find((candidate) => candidate.id === id)!;
    artifact.pinned = true;
    const changes: SLChange[] = [];
    await slSaveRegistry(root, registry, false, changes);

    await slSweep(root, false, new Date("2027-01-01T00:00:00.000Z"));

    expect(await getArtifact(root, id)).toMatchObject({
      status: "raw",
      pinned: true,
    });
  });

  test("does not delete quarantined evidence with an active dependent", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const id = await createLesson(root, "Referenced evidence");
    await slForgetArtifact(
      root,
      id,
      "wrong",
      false,
      new Date("2026-01-02T00:00:00.000Z"),
    );
    const registry = await slLoadRegistry(root);
    registry.artifacts.push({
      id: "SL-ACTIVE-DEPENDENT",
      path: ".github/instructions/SL-dependent.instructions.md",
      artifactType: "instruction",
      classification: "promoted",
      managedBy: "SL-Repo",
      status: "promoted",
      createdAt: "2026-01-02T00:00:00.000Z",
      lastVerifiedAt: "2026-01-02T00:00:00.000Z",
      pinned: false,
      relatedTo: [],
      dependsOn: [id],
    });
    const changes: SLChange[] = [];
    await slSaveRegistry(root, registry, false, changes);

    const result = await slSweep(
      root,
      false,
      new Date("2026-01-10T00:00:00.000Z"),
    );

    expect(await getArtifact(root, id)).toMatchObject({ status: "quarantined" });
    expect(result.changes).toContainEqual(
      expect.objectContaining({ detail: "artifact has an active dependent" }),
    );
  });

  test("does not stale or quarantine evidence with an active dependent", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const id = await createLesson(root, "Actively referenced evidence");
    const registry = await slLoadRegistry(root);
    registry.artifacts.push({
      id: "SL-ACTIVE-REFERENCE",
      path: ".github/instructions/SL-active-reference.instructions.md",
      artifactType: "instruction",
      classification: "promoted",
      managedBy: "SL-Repo",
      status: "promoted",
      createdAt: "2026-01-02T00:00:00.000Z",
      lastVerifiedAt: "2026-01-02T00:00:00.000Z",
      pinned: false,
      relatedTo: [],
      dependsOn: [id],
    });
    const changes: SLChange[] = [];
    await slSaveRegistry(root, registry, false, changes);

    const sweep = await slSweep(
      root,
      false,
      new Date("2027-01-01T00:00:00.000Z"),
    );

    expect(await getArtifact(root, id)).toMatchObject({ status: "raw" });
    expect(sweep.changes).toContainEqual(
      expect.objectContaining({ detail: "artifact has an active dependent" }),
    );
    await expect(
      slForgetArtifact(
        root,
        id,
        "wrong",
        false,
        new Date("2027-01-02T00:00:00.000Z"),
      ),
    ).rejects.toThrow("active dependent");
  });

  test("does not delete a hand-authored file claimed only by the registry", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const manualPath = join(root, "README.md");
    await writeFile(manualPath, "# Hand-authored\n", "utf8");
    const registry = await slLoadRegistry(root);
    registry.artifacts.push({
      id: "SL-FORGED-OWNERSHIP",
      path: "README.md",
      artifactType: "lesson",
      classification: "evidence",
      managedBy: "SL-Repo",
      status: "quarantined",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastVerifiedAt: "2026-01-01T00:00:00.000Z",
      quarantinedAt: "2026-01-02T00:00:00.000Z",
      deleteEligibleAt: "2026-01-03T00:00:00.000Z",
      pinned: false,
      relatedTo: [],
    });
    const changes: SLChange[] = [];
    await slSaveRegistry(root, registry, false, changes);

    await expect(
      slSweep(root, false, new Date("2026-02-01T00:00:00.000Z")),
    ).rejects.toThrow("file ownership does not match");
    expect(await readFile(manualPath, "utf8")).toBe("# Hand-authored\n");
  });

  test("does not delete when the eligibility timestamp is invalid", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const id = await createLesson(root, "Invalid deletion timestamp");
    await slForgetArtifact(
      root,
      id,
      "wrong",
      false,
      new Date("2026-01-02T00:00:00.000Z"),
    );
    const registry = await slLoadRegistry(root);
    const artifact = registry.artifacts.find((candidate) => candidate.id === id)!;
    artifact.deleteEligibleAt = "not-a-date";
    const changes: SLChange[] = [];
    await slSaveRegistry(root, registry, false, changes);

    const result = await slSweep(
      root,
      false,
      new Date("2026-02-01T00:00:00.000Z"),
    );

    expect(await getArtifact(root, id)).toMatchObject({ status: "quarantined" });
    expect(result.changes).toContainEqual(
      expect.objectContaining({
        detail: "delete eligibility timestamp is invalid",
      }),
    );
  });

  test("rejects unsafe retention configuration", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    await writeFile(
      join(root, ".github", "SL-learning", "SL-config.yml"),
      [
        "schemaVersion: 1",
        "scope: repo",
        "retention:",
        "  staleAfterDays: -1",
        "  quarantineAfterDays: 180",
        "  deleteAfterQuarantineDays: 30",
        "  wrongDeleteAfterDays: 7",
        "  promotedStaleAfterDays: 365",
        "  promotedQuarantineAfterDays: 30",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(slSweep(root, false)).rejects.toThrow("positive integer");
  });
});
