import {
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SL_MANAGED_BLOCK_END, SL_MANAGED_BLOCK_START } from "../../SL-src/SL-core/SL-constants.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import {
  slProjectUsage,
  slSynchronizeUsageProjection,
} from "../../SL-src/SL-core/SL-usage.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";
import { slCreateLegacy02Fixture } from "../SL-fixtures/SL-monorepo-fixture.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];

function normalizeLineEndings(value: string): string {
  return value.replaceAll("\r\n", "\n");
}

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
    await writeFile(
      join(root, "AGENTS.md"),
      "# Existing agent policy\n",
      "utf8",
    );

    await slInstall(root, "init", false);
    const instructionsPath = join(root, ".github", "copilot-instructions.md");
    const agentsPath = join(root, "AGENTS.md");
    const first = await readFile(instructionsPath, "utf8");
    const firstAgents = await readFile(agentsPath, "utf8");
    const firstRegistry = await readFile(
      join(root, ".github", "SL-learning", "SL-registry.json"),
      "utf8",
    );

    await writeFile(
      instructionsPath,
      `# Existing repository policy\n\n${first}`,
      "utf8",
    );
    await writeFile(
      agentsPath,
      `# Existing agent policy\n\n${firstAgents}`,
      "utf8",
    );
    await slInstall(root, "init", false);
    const second = await readFile(instructionsPath, "utf8");
    const secondAgents = await readFile(agentsPath, "utf8");
    const secondRegistry = await readFile(
      join(root, ".github", "SL-learning", "SL-registry.json"),
      "utf8",
    );

    expect(second).toContain("# Existing repository policy");
    expect(second.match(new RegExp(SL_MANAGED_BLOCK_START, "g"))).toHaveLength(1);
    expect(second.match(new RegExp(SL_MANAGED_BLOCK_END, "g"))).toHaveLength(1);
    expect(secondAgents).toContain("# Existing agent policy");
    expect(
      secondAgents.match(new RegExp(SL_MANAGED_BLOCK_START, "g")),
    ).toHaveLength(1);
    expect(
      secondAgents.match(new RegExp(SL_MANAGED_BLOCK_END, "g")),
    ).toHaveLength(1);
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

  test("installs SL-owned Azure Pipelines templates without claiming manual files", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const manualPipeline = join(root, ".azure-pipelines", "manual.yml");
    const manualMatchingTemplate = join(
      root,
      ".azure-pipelines",
      "SL-learning",
      "SL-validation.yml",
    );
    await mkdir(join(root, ".azure-pipelines", "SL-learning"), {
      recursive: true,
    });
    await writeFile(manualPipeline, "steps: []\n", "utf8");
    await writeFile(manualMatchingTemplate, "jobs: []\n", "utf8");

    await slInstall(root, "init", false);

    expect(await readFile(manualPipeline, "utf8")).toBe("steps: []\n");
    expect(await readFile(manualMatchingTemplate, "utf8")).toBe("jobs: []\n");
    await expect(
      readFile(
        join(
          root,
          ".azure-pipelines",
          "SL-learning",
          "SL-retention.yml",
        ),
        "utf8",
      ),
    ).resolves.toContain("3c6bb31d1f717595791e9a575d698b5593cbcf10");
    const registry = await slLoadRegistry(root);
    expect(
      registry.artifacts.some(
        (artifact) =>
          artifact.path ===
          ".azure-pipelines/SL-learning/SL-validation.yml",
      ),
    ).toBe(false);
    expect(
      registry.artifacts.some(
        (artifact) =>
          artifact.path ===
          ".azure-pipelines/SL-learning/SL-retention.yml",
      ),
    ).toBe(true);
  });

  test("preserves an existing JSON scope catalog without creating YAML", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const learningRoot = join(root, ".github", "SL-learning");
    await mkdir(learningRoot, { recursive: true });
    const jsonPath = join(learningRoot, "SL-scope-catalog.json");
    const catalog = JSON.stringify({
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
      ],
    });
    await writeFile(jsonPath, catalog, "utf8");

    await slInstall(root, "init", false);

    expect(await readFile(jsonPath, "utf8")).toBe(catalog);
    await expect(
      readFile(join(learningRoot, "SL-scope-catalog.yml"), "utf8"),
    ).rejects.toThrow();
  });

  test("installs every bundled schema and updates only registered copies", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const schemaNames = (await readdir(resolve("SL-schemas")))
      .filter((name) => name.endsWith(".schema.json"))
      .sort();
    const installedRoot = join(
      root,
      ".github",
      "SL-learning",
      "SL-schemas",
    );
    for (const schemaName of schemaNames) {
      expect(
        normalizeLineEndings(
          await readFile(join(installedRoot, schemaName), "utf8"),
        ),
      ).toBe(
        normalizeLineEndings(
          await readFile(resolve("SL-schemas", schemaName), "utf8"),
        ),
      );
    }

    const managedSchema = join(installedRoot, schemaNames[0]!);
    const manualSchema = join(installedRoot, "SL-manual.schema.json");
    await writeFile(managedSchema, '{"manual":"drift"}\n', "utf8");
    await writeFile(manualSchema, '{"manual":true}\n', "utf8");

    await slInstall(root, "update", false);

    expect(
      normalizeLineEndings(await readFile(managedSchema, "utf8")),
    ).toBe(
      normalizeLineEndings(
        await readFile(resolve("SL-schemas", schemaNames[0]!), "utf8"),
      ),
    );
    expect(await readFile(manualSchema, "utf8")).toBe('{"manual":true}\n');
    const registry = await slLoadRegistry(root);
    expect(
      registry.artifacts.filter((artifact) =>
        artifact.path?.startsWith(".github/SL-learning/SL-schemas/"),
      ),
    ).toHaveLength(schemaNames.length);
  });

  test("updates a legacy 0.2 repository without rewriting or losing legacy state", async () => {
    const legacy = await slCreateLegacy02Fixture();
    repositories.push(legacy.root);
    const before = await readFile(legacy.legacyRegistryPath, "utf8");

    await slInstall(legacy.root, "update", false);
    await slSynchronizeUsageProjection(legacy.root, false);

    expect(await readFile(legacy.legacyRegistryPath, "utf8")).toBe(before);
    const projections = await slProjectUsage(legacy.root, legacy.lessonId);
    expect(projections).toEqual([
      expect.objectContaining({
        scope: { id: "SL-SCOPE-ROOT", path: "." },
        retrievalCount: 4,
        applicationCount: 4,
        verifiedSuccessCount: 3,
        verifiedFailureCount: 1,
      }),
    ]);
    expect(
      (await slValidateRepository(legacy.root)).filter(
        (issue) => issue.severity === "error",
      ),
    ).toEqual([]);
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
