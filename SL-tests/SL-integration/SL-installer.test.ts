import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SL_MANAGED_BLOCK_END, SL_MANAGED_BLOCK_START } from "../../SL-src/SL-core/SL-constants.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

describe("SL installer", () => {
  test("preserves existing instructions and is idempotent", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await writeFile(
      join(root, ".github-copilot-placeholder"),
      "placeholder",
      "utf8",
    );
    await writeFile(
      join(root, "existing.txt"),
      "preserve",
      "utf8",
    );

    await slInstall(root, "init", false);
    const instructionsPath = join(root, ".github", "copilot-instructions.md");
    const first = await readFile(instructionsPath, "utf8");
    const firstRegistry = await readFile(
      join(root, ".github", "SL-learning", "SL-registry.json"),
      "utf8",
    );

    await writeFile(
      instructionsPath,
      `# Existing repository policy\n\n${first}`,
      "utf8",
    );
    await slInstall(root, "init", false);
    const second = await readFile(instructionsPath, "utf8");
    const secondRegistry = await readFile(
      join(root, ".github", "SL-learning", "SL-registry.json"),
      "utf8",
    );

    expect(second).toContain("# Existing repository policy");
    expect(second.match(new RegExp(SL_MANAGED_BLOCK_START, "g"))).toHaveLength(1);
    expect(second.match(new RegExp(SL_MANAGED_BLOCK_END, "g"))).toHaveLength(1);
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("preserve");
    expect(secondRegistry).toBe(firstRegistry);
  });

  test("dry run does not create files", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);

    const changes = await slInstall(root, "init", true);

    expect(changes.some((change) => change.action === "create")).toBe(true);
    await expect(
      readFile(join(root, ".github", "SL-learning", "SL-config.yml"), "utf8"),
    ).rejects.toThrow();
  });

  test("does not claim a pre-existing matching skill", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const skillPath = join(
      root,
      ".github",
      "skills",
      "SL-bootstrap",
      "SKILL.md",
    );
    await mkdir(join(root, ".github", "skills", "SL-bootstrap"), {
      recursive: true,
    });
    await writeFile(skillPath, "---\nname: custom\n---\n\n# Custom\n", "utf8");

    await slInstall(root, "init", false);
    const registry = await slLoadRegistry(root);

    expect(await readFile(skillPath, "utf8")).toContain("name: custom");
    expect(
      registry.artifacts.some(
        (artifact) => artifact.path === ".github/skills/SL-bootstrap/SKILL.md",
      ),
    ).toBe(false);
  });

  test("rejects a target path that resolves outside the repository", async () => {
    const root = await slCreateTestRepository();
    const outside = await slCreateTestRepository();
    repositories.push(root, outside);
    const outsideGithub = join(outside, "outside-github");
    await mkdir(outsideGithub);
    await symlink(
      outsideGithub,
      join(root, ".github"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(slInstall(root, "init", false)).rejects.toThrow(
      "Path resolves outside repository root",
    );
  });
});
