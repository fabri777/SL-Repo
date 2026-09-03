import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slRegisterPromotion } from "../../SL-src/SL-core/SL-promotion.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

describe("SL promotion", () => {
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
    await writeFile(
      join(root, ...promotedPath.split("/")),
      "---\nid: SL-SHARED-PROMOTION\napplyTo: \"**/*\"\n---\n\n# Shared\n",
      "utf8",
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
