import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slLoadScopeCatalog } from "../../SL-src/SL-core/SL-scope.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

describe("SL validation", () => {
  test("loads the backward-compatible root scope when no catalog exists", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);

    await expect(slLoadScopeCatalog(root)).resolves.toMatchObject({
      schemaVersion: 1,
      scopes: [
        {
          id: "SL-SCOPE-ROOT",
          kind: "repository",
          includePaths: ["**"],
        },
      ],
    });
  });

  test("rejects unregistered lessons", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lessonDirectory = join(
      root,
      ".github",
      "SL-learning",
      "SL-lessons",
      "2026-09",
    );
    await mkdir(lessonDirectory, { recursive: true });
    await writeFile(
      join(lessonDirectory, "SL-2026-09-03-unregistered.md"),
      "---\nid: SL-UNREGISTERED\n---\n",
      "utf8",
    );

    const issues = await slValidateRepository(root);

    expect(issues).toContainEqual(
      expect.objectContaining({ code: "unregistered-lesson" }),
    );
  });

  test("validates a YAML scope catalog with semantic errors", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    await writeFile(
      join(root, ".github", "SL-learning", "SL-scope-catalog.yml"),
      [
        "schemaVersion: 1",
        "scopes:",
        "  - id: SL-SCOPE-ROOT",
        "    displayName: Repository",
        "    kind: repository",
        "    includePaths: ['**']",
        "    excludePaths: []",
        "    dependencyScopeIds: []",
        "    ownerAliases: []",
        "  - id: SL-SCOPE-BROKEN",
        "    displayName: Broken",
        "    kind: service",
        "    includePaths: ['../outside/**']",
        "    excludePaths: []",
        "    parentScopeId: SL-SCOPE-ROOT",
        "    dependencyScopeIds: []",
        "    ownerAliases: ['@example/broken']",
        "",
      ].join("\n"),
      "utf8",
    );

    const issues = await slValidateRepository(root);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["unsafe-scope-path"]),
    );
  });
});
