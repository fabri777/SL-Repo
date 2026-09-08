import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import fg from "fast-glob";
import { afterEach, describe, expect, test } from "vitest";
import {
  SL_MANAGED_BLOCK_END,
  SL_MANAGED_BLOCK_START,
  SL_PATHS,
  SL_RUNTIME_MANIFEST_FILE,
} from "../../SL-src/SL-core/SL-constants.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import { slLoadStateCatalog } from "../../SL-src/SL-core/SL-state.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";
import {
  slCompareOrdinal,
  slWriteText,
} from "../../SL-src/SL-core/SL-utils.js";

const repositories: string[] = [];
const INSTALLER_TEST_TIMEOUT_MS =
  process.platform === "win32" ? 120_000 : 60_000;
const addFormats = createRequire(import.meta.url)(
  "ajv-formats",
) as FormatsPlugin;

function normalizeLineEndings(value: string): string {
  return value.replaceAll("\r\n", "\n");
}

async function preparePriorRuntime(root: string) {
  await slInstall(root, "init", false);
  const runtimeRoot = join(root, ...SL_PATHS.runtimeRoot.split("/"));
  const manifestPath = join(runtimeRoot, SL_RUNTIME_MANIFEST_FILE);
  const managedPath = join(runtimeRoot, "sl.runtime.psm1");
  const obsoletePath = join(runtimeRoot, "sl.obsolete.ps1");
  const manualPath = join(runtimeRoot, "manual-notes.txt");
  const previousManagedContent = Buffer.from(
    "# prior reviewed runtime\r\n",
    "utf8",
  );
  const obsoleteContent = Buffer.from("# obsolete reviewed runtime\r\n", "utf8");
  const manualContent = Buffer.from("preserve user bytes\r\n", "utf8");
  await writeFile(managedPath, previousManagedContent);
  await writeFile(obsoletePath, obsoleteContent);
  await writeFile(manualPath, manualContent);
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as {
    runtimeVersion: string;
    files: Array<{ path: string; sha256: string }>;
  };
  manifest.runtimeVersion = "0.0.9";
  manifest.files.find(
    (file) => file.path === "sl.runtime.psm1",
  )!.sha256 = createHash("sha256")
    .update(previousManagedContent.toString("utf8").replaceAll("\r\n", "\n"))
    .digest("hex");
  manifest.files.push({
    path: "sl.obsolete.ps1",
    sha256: createHash("sha256")
      .update(obsoleteContent.toString("utf8").replaceAll("\r\n", "\n"))
      .digest("hex"),
  });
  manifest.files.sort((left, right) =>
    slCompareOrdinal(left.path, right.path),
  );
  const previousManifestContent = Buffer.from(
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(manifestPath, previousManifestContent);
  return {
    manifestPath,
    managedPath,
    obsoletePath,
    manualPath,
    previousManifestContent,
    previousManagedContent,
    obsoleteContent,
    manualContent,
  };
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
    const catalog = await slLoadStateCatalog(root);
    const registryPath = join(
      root,
      ...catalog.scopes[0]!.registryPath.split("/"),
    );
    const firstRegistry = await readFile(registryPath, "utf8");

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
    const secondRegistry = await readFile(registryPath, "utf8");

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
      readFile(join(root, ".github", "sl-learning", "sl-config.yml"), "utf8"),
    ).rejects.toThrow();
  });

  test("installs bundled skills with lowercase names", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const skills = ["sl-learning-audit", "sl-lesson-curator"];

    await slInstall(root, "init", false);

    expect(
      (await readdir(join(root, ".github", "skills"))).sort(),
    ).toEqual(skills);
    for (const skill of skills) {
      await expect(
        readFile(
          join(root, ".github", "skills", skill, "SKILL.md"),
          "utf8",
        ),
      ).resolves.toContain(`name: ${skill}`);
    }
  });

  test("installs the exact minimal default inventory", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);

    await slInstall(root, "init", false);

    const files = (
      await fg("**/*", {
        cwd: root,
        dot: true,
        onlyFiles: true,
        ignore: [".git/**"],
      })
    ).sort(slCompareOrdinal);
    expect(files).toEqual([
      ".github/copilot-instructions.md",
      ".github/skills/sl-learning-audit/SKILL.md",
      ".github/skills/sl-lesson-curator/SKILL.md",
      ".github/sl-learning/.gitattributes",
      ".github/sl-learning/sl-config.yml",
      ".github/sl-learning/sl-runtime/sl-runtime.manifest.json",
      ".github/sl-learning/sl-runtime/sl.ps1",
      ".github/sl-learning/sl-runtime/sl.runtime.psm1",
      ".github/sl-learning/sl-runtime/sl.sh",
      ".github/sl-learning/sl-schema-bundle.schema.json",
      ".github/sl-learning/sl-scopes/sl-sl-scope-root-47ab59b49ac7/sl-index.json",
      ".github/sl-learning/sl-scopes/sl-sl-scope-root-47ab59b49ac7/sl-registry.json",
      ".github/sl-learning/sl-state-catalog.json",
      ".github/sl-learning/sl-system.manifest.json",
      "AGENTS.md",
    ]);
    expect(
      files.filter((path) =>
        path.startsWith(".github/sl-learning/sl-runtime/"),
      ),
    ).toHaveLength(4);
    expect(
      files.some(
        (path) =>
          path.startsWith(".github/workflows/") ||
          path.startsWith(".azure-pipelines/"),
      ),
    ).toBe(false);
  });

  test("omits empty usage and resource projection shards", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);

    await slInstall(root, "init", false);

    const catalog = await slLoadStateCatalog(root);
    expect(catalog.scopes).toHaveLength(1);
    const entry = catalog.scopes[0]!;
    await expect(
      access(join(root, ...entry.projectionPath.split("/"))),
    ).rejects.toThrow();
    await expect(
      access(join(root, ...entry.resourceProjectionPath!.split("/"))),
    ).rejects.toThrow();
  });

  test("rolls back a partial initialization after an injected write failure", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const agentsPath = join(root, "AGENTS.md");
    const unrelatedPath = join(root, "user-file.txt");
    const agentsContent = Buffer.from("# Existing policy\r\n", "utf8");
    const unrelatedContent = Buffer.from("unrelated user bytes\r\n", "utf8");
    await writeFile(agentsPath, agentsContent);
    await writeFile(unrelatedPath, unrelatedContent);
    let injected = false;

    await expect(
      slInstall(root, "init", false, {
        writeText: async (...argumentsList) => {
          await slWriteText(...argumentsList);
          if (argumentsList[1] === SL_PATHS.stateCatalog) {
            injected = true;
            throw new Error("injected installer write failure");
          }
        },
      }),
    ).rejects.toThrow("injected installer write failure");

    expect(injected).toBe(true);
    expect(await readFile(agentsPath)).toEqual(agentsContent);
    expect(await readFile(unrelatedPath)).toEqual(unrelatedContent);
    await expect(
      access(join(root, ...SL_PATHS.learningRoot.split("/"))),
    ).rejects.toThrow();
    await expect(
      access(join(root, ".github", "copilot-instructions.md")),
    ).rejects.toThrow();
  }, INSTALLER_TEST_TIMEOUT_MS);

  test("does not claim a pre-existing matching skill", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const skillPath = join(
      root,
      ".github",
      "skills",
      "sl-learning-audit",
      "SKILL.md",
    );
    await mkdir(join(root, ".github", "skills", "sl-learning-audit"), {
      recursive: true,
    });

    await writeFile(skillPath, "---\nname: custom\n---\n\n# Custom\n", "utf8");

    await slInstall(root, "init", false);
    const registry = await slLoadRegistry(root);

    expect(await readFile(skillPath, "utf8")).toContain("name: custom");
    expect(
      registry.artifacts.some(
        (artifact) =>
          artifact.path === ".github/skills/sl-learning-audit/SKILL.md",
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
      "sl-learning",
      "sl-validation.yml",
    );
    await mkdir(join(root, ".azure-pipelines", "sl-learning"), {
      recursive: true,
    });
    await writeFile(manualPipeline, "steps: []\n", "utf8");
    await writeFile(manualMatchingTemplate, "jobs: []\n", "utf8");

    await slInstall(root, "init", false, {}, { automation: "azure" });

    expect(await readFile(manualPipeline, "utf8")).toBe("steps: []\n");
    expect(await readFile(manualMatchingTemplate, "utf8")).toBe("jobs: []\n");
    await expect(
      readFile(
        join(
          root,
          ".azure-pipelines",
          "sl-learning",
          "sl-retention.yml",
        ),
        "utf8",
      ),
    ).resolves.toContain(".github/sl-learning/sl-runtime/sl.ps1");
    const registry = await slLoadRegistry(root);
    expect(
      registry.artifacts.some(
        (artifact) =>
          artifact.path ===
          ".azure-pipelines/sl-learning/sl-validation.yml",
      ),
    ).toBe(false);
    expect(
      registry.artifacts.some(
        (artifact) =>
          artifact.path ===
          ".azure-pipelines/sl-learning/sl-retention.yml",
      ),
    ).toBe(true);
  }, INSTALLER_TEST_TIMEOUT_MS);

  test("keeps provider automation absent by default and removes only unchanged selected adapters", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);

    await slInstall(root, "init", false);
    await expect(
      access(
        join(
          root,
          ".github",
          "workflows",
          "sl-learning-validation.yml",
        ),
      ),
    ).rejects.toThrow();
    await expect(
      access(
        join(
          root,
          ".azure-pipelines",
          "sl-learning",
          "sl-validation.yml",
        ),
      ),
    ).rejects.toThrow();

    await slInstall(root, "update", false, {}, { automation: "all" });
    const adapterPaths = [
      ".github/workflows/sl-learning-forget.yml",
      ".github/workflows/sl-learning-validation.yml",
      ".azure-pipelines/sl-learning/sl-retention.yml",
      ".azure-pipelines/sl-learning/sl-validation.yml",
    ];
    await slInstall(root, "update", false);
    for (const path of adapterPaths) {
      await expect(access(join(root, ...path.split("/")))).resolves.toBeUndefined();
    }
    const dryRunChanges = await slInstall(
      root,
      "update",
      true,
      {},
      { automation: "none" },
    );
    expect(
      dryRunChanges
        .filter((change) => change.action === "delete")
        .map((change) => change.path)
        .sort(slCompareOrdinal),
    ).toEqual([...adapterPaths].sort(slCompareOrdinal));
    for (const path of adapterPaths) {
      await expect(access(join(root, ...path.split("/")))).resolves.toBeUndefined();
    }
    const githubPath = join(
      root,
      ".github",
      "workflows",
      "sl-learning-validation.yml",
    );
    await expect(access(githubPath)).resolves.toBeUndefined();
    await writeFile(githubPath, "name: locally-modified\n", "utf8");

    await expect(
      slInstall(root, "update", false, {}, { automation: "none" }),
    ).rejects.toThrow("locally modified obsolete SL system artifact");
    await writeFile(
      githubPath,
      await readFile(
        resolve(
          "SL-templates",
          "SL-repository",
          ".github",
          "workflows",
          "sl-learning-validation.yml",
        ),
      ),
    );

    await slInstall(root, "update", false, {}, { automation: "none" });

    for (const path of adapterPaths) {
      await expect(access(join(root, ...path.split("/")))).rejects.toThrow();
    }
  }, INSTALLER_TEST_TIMEOUT_MS);

  test("preserves an existing JSON scope catalog without creating YAML", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const learningRoot = join(root, ".github", "sl-learning");
    await mkdir(learningRoot, { recursive: true });
    const jsonPath = join(learningRoot, "sl-scope-catalog.json");
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
      readFile(join(learningRoot, "sl-scope-catalog.yml"), "utf8"),
    ).rejects.toThrow();
  });

  test("installs one compound schema bundle and preserves unowned schema files", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const schemaNames = (await readdir(resolve("SL-schemas")))
      .filter((name) => name.endsWith(".schema.json"))
      .sort();
    const installedRoot = join(
      root,
      ".github",
      "sl-learning",
      "sl-schema-bundle.schema.json",
    );
    const bundle = JSON.parse(await readFile(installedRoot, "utf8")) as {
      $defs: Record<string, { $id?: string }>;
    };
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    ajv.addSchema(bundle);
    for (const schemaName of schemaNames) {
      const sourceSchema = JSON.parse(
        await readFile(resolve("SL-schemas", schemaName), "utf8"),
      ) as { $id: string };
      expect(bundle.$defs[schemaName]).toEqual(sourceSchema);
      expect(ajv.getSchema(sourceSchema.$id)).toBeTypeOf("function");
    }
    expect(
      ajv.getSchema(
        "https://github.com/ffishkel_microsoft/SL/sl-resource-projection.schema.json",
      )?.({
        schemaVersion: 1,
        scope: { id: "SL-SCOPE-ROOT", path: "." },
        projections: [],
      }),
    ).toBe(true);
    expect(
      ajv.getSchema(
        "https://github.com/ffishkel_microsoft/SL/sl-scope-registry.schema.json",
      )?.({
        schemaVersion: 1,
        scope: { id: "SL-SCOPE-ROOT", path: "." },
        artifacts: [],
      }),
    ).toBe(true);
    const manualSchemaRoot = join(root, ".github", "sl-learning", "sl-schemas");
    await mkdir(manualSchemaRoot, { recursive: true });
    const manualSchema = join(manualSchemaRoot, "sl-manual.schema.json");
    await writeFile(manualSchema, '{"manual":true}\n', "utf8");

    await slInstall(root, "update", false);

    expect(await readFile(manualSchema, "utf8")).toBe('{"manual":true}\n');
    const registry = await slLoadRegistry(root);
    expect(
      registry.artifacts.filter(
        (artifact) =>
          artifact.path ===
          ".github/sl-learning/sl-schema-bundle.schema.json",
      ),
    ).toHaveLength(1);
    expect(
      registry.artifacts.filter((artifact) =>
        artifact.path?.startsWith(".github/sl-learning/sl-schemas/"),
      ),
    ).toEqual([]);
  });

  test("rejects unsupported uppercase layouts without mutation", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const legacyRoot = join(root, ".github", "SL-learning");
    await mkdir(legacyRoot, { recursive: true });
    const legacyConfig = join(legacyRoot, "SL-config.yml");
    await writeFile(legacyConfig, "legacy: true\n", "utf8");

    await expect(slInstall(root, "init", false)).rejects.toThrow(
      "Unsupported SL layout",
    );
    expect(await readFile(legacyConfig, "utf8")).toBe("legacy: true\n");
    await expect(
      access(join(root, ".github", "copilot-instructions.md")),
    ).rejects.toThrow();
  });

  test("rolls back runtime updates after an injected remove failure", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const prior = await preparePriorRuntime(root);
    const catalog = await slLoadStateCatalog(root);
    const registryPath = join(
      root,
      ...catalog.scopes[0]!.registryPath.split("/"),
    );
    const previousRegistryContent = await readFile(registryPath);
    let injected = false;

    await expect(
      slInstall(root, "update", false, {
        remove: async (path) => {
          await rm(path);
          injected = true;
          throw new Error("injected installer remove failure");
        },
      }),
    ).rejects.toThrow("injected installer remove failure");

    expect(injected).toBe(true);
    expect(await readFile(prior.managedPath)).toEqual(
      prior.previousManagedContent,
    );
    expect(await readFile(prior.obsoletePath)).toEqual(prior.obsoleteContent);
    expect(await readFile(prior.manifestPath)).toEqual(
      prior.previousManifestContent,
    );
    expect(await readFile(prior.manualPath)).toEqual(prior.manualContent);
    expect(await readFile(registryPath)).toEqual(previousRegistryContent);
  }, INSTALLER_TEST_TIMEOUT_MS);

  test("restores removed files and the prior manifest after an injected manifest write failure", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const prior = await preparePriorRuntime(root);
    let injected = false;

    await expect(
      slInstall(root, "update", false, {
        writeText: async (...argumentsList) => {
          await slWriteText(...argumentsList);
          if (
            argumentsList[1] ===
            `${SL_PATHS.runtimeRoot}/${SL_RUNTIME_MANIFEST_FILE}`
          ) {
            injected = true;
            throw new Error("injected runtime manifest write failure");
          }
        },
      }),
    ).rejects.toThrow("injected runtime manifest write failure");

    expect(injected).toBe(true);
    expect(await readFile(prior.managedPath)).toEqual(
      prior.previousManagedContent,
    );
    expect(await readFile(prior.obsoletePath)).toEqual(prior.obsoleteContent);
    expect(await readFile(prior.manifestPath)).toEqual(
      prior.previousManifestContent,
    );
    expect(await readFile(prior.manualPath)).toEqual(prior.manualContent);
  }, INSTALLER_TEST_TIMEOUT_MS);

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
