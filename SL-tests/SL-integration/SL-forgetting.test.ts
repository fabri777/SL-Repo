import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import {
  slLoadRegistry,
  slSaveRegistry,
} from "../../SL-src/SL-core/SL-registry.js";
import type { SLChange, SLRegistryArtifact } from "../../SL-src/SL-core/SL-types.js";
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
