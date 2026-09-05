import { access, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { slParseMarkdown } from "../../SL-src/SL-core/SL-frontmatter.js";

const SL_PACKAGE_AUDIT_TIMEOUT_MS =
  process.platform === "win32" ? 60_000 : 30_000;

type WorkflowStep = {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

type Workflow = {
  permissions?: Record<string, string>;
  jobs: Record<
    string,
    {
      permissions?: Record<string, string>;
      steps?: WorkflowStep[];
    }
  >;
};

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
const addFormats = createRequire(import.meta.url)(
  "ajv-formats",
) as FormatsPlugin;

type SLNpmArborist = new (options: {
  path: string;
}) => {
  loadActual(): Promise<unknown>;
};

type SLNpmPacklist = (tree: unknown) => Promise<string[]>;

async function slReadNpmPackageFileList(): Promise<string[]> {
  const npmRoot = process.env.npm_execpath
    ? dirname(dirname(process.env.npm_execpath))
    : join(dirname(process.execPath), "node_modules", "npm");
  const npmRequire = createRequire(join(npmRoot, "package.json"));
  const Arborist = npmRequire("@npmcli/arborist") as SLNpmArborist;
  const packlist = npmRequire("npm-packlist") as SLNpmPacklist;
  const tree = await new Arborist({ path: resolve(".") }).loadActual();
  return packlist(tree);
}

function findMutableActions(value: unknown, path = "workflow"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findMutableActions(item, `${path}[${index}]`),
    );
  }
  if (value === null || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`;
    if (
      key === "uses" &&
      typeof child === "string" &&
      !/^[^@\s]+@[0-9a-f]{40}$/.test(child)
    ) {
      return [`${childPath}: ${child}`];
    }
    return findMutableActions(child, childPath);
  });
}

function findFloatingRuntimeRefs(value: string): string[] {
  return value
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) =>
      /^\s*(?:-\s*)?ref:\s*(?:main|master|refs\/heads\/\S+|refs\/tags\/\S+)\s*$/i.test(
        line,
      ),
    );
}

describe("SL plugin package", () => {
  test("contains the manifest and all milestone skills", async () => {
    const manifest = JSON.parse(
      await readFile(resolve("SL-plugin/plugin.json"), "utf8"),
    ) as { name: string; version: string };

    expect(manifest).toEqual({
      name: "sl-repo",
      version: "0.3.0",
      description:
        "Repository-local capture, promotion, validation, and forgetting for GitHub Copilot agents",
      author: {
        name: "Fabrizio Fishkel",
      },
    });
    for (const skill of [
      "SL-bootstrap",
      "SL-lesson-curator",
      "SL-learning-audit",
    ]) {
      const content = await readFile(
        resolve("SL-plugin", "skills", skill, "SKILL.md"),
        "utf8",
      );
      expect(
        slParseMarkdown<{ name: string }>(content).frontmatter.name,
      ).toBe(skill);
    }
  });

  test("packages runtime, schemas, templates, plugin skills, and linked documentation", async () => {
    const packageManifest = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    ) as { files: string[] };
    expect(packageManifest.files).toEqual([
      "dist",
      "SL-docs",
      "SL-schemas",
      "SL-templates",
      "SL-plugin",
      "SL-tests",
      "CHANGELOG.md",
      "README.md",
      "SECURITY.md",
    ]);

    const requiredFiles = [
      "CHANGELOG.md",
      "SECURITY.md",
      "SL-docs/SL-azure-pipelines.md",
      "SL-docs/SL-install.md",
      "SL-docs/SL-migration-0.2.md",
      "SL-docs/SL-monorepo-operations.md",
      "SL-docs/SL-security.md",
      "SL-docs/SL-usage-events.md",
      "SL-docs/SL-validation-contracts.md",
      "SL-schemas/SL-lifecycle-event.schema.json",
      "SL-schemas/SL-usage-event.schema.json",
      "SL-schemas/SL-scope-catalog.schema.json",
      "SL-schemas/SL-scope-registry.schema.json",
      "SL-schemas/SL-state-catalog.schema.json",
      "SL-schemas/SL-usage-projection.schema.json",
      "SL-schemas/SL-validation-contract.schema.json",
      "SL-tests/SL-fixtures/SL-monorepo-fixture.ts",
      "SL-templates/SL-repository/.github/SL-learning/.gitattributes",
      "SL-templates/SL-repository/.github/workflows/SL-learning-validation.yml",
      "SL-templates/SL-repository/.github/workflows/SL-learning-forget.yml",
      "SL-templates/SL-repository/.azure-pipelines/SL-learning/SL-validation.yml",
      "SL-templates/SL-repository/.azure-pipelines/SL-learning/SL-retention.yml",
      "dist/SL-src/SL-core/SL-promotion-lifecycle.js",
      "dist/SL-src/SL-core/SL-usage.js",
      "dist/SL-src/SL-validation/SL-validation-contract.js",
    ];
    await Promise.all(requiredFiles.map((path) => access(resolve(path))));

    // npm pack runs prepare for local directories, so use npm's packlist
    // implementation directly to audit file selection without rebuilding.
    const packedPaths = new Set(
      (await slReadNpmPackageFileList()).map((path) =>
        path.replaceAll("\\", "/"),
      ),
    );
    for (const path of requiredFiles) {
      expect(packedPaths.has(path)).toBe(true);
    }

    const sourceInstallExamples = [
      await readFile(resolve("README.md"), "utf8"),
      await readFile(resolve("SL-docs/SL-install.md"), "utf8"),
    ].join("\n");
    expect(sourceInstallExamples).toContain(
      "github:fabri777/SL-Repo#3c6bb31d1f717595791e9a575d698b5593cbcf10",
    );
    expect(sourceInstallExamples).not.toMatch(
      /github:fabri777\/SL-Repo(?!#[0-9a-f]{40})/,
    );
  }, SL_PACKAGE_AUDIT_TIMEOUT_MS);

  test("compiles every schema and validates canonical clean-install templates", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const schemaNames = (await readdir(resolve("SL-schemas")))
      .filter((name) => name.endsWith(".schema.json"))
      .sort();
    const validators = new Map<string, ReturnType<typeof ajv.compile>>();
    const schemas = new Map<string, { $id: string }>();
    for (const schemaName of schemaNames) {
      const schema = JSON.parse(
        await readFile(resolve("SL-schemas", schemaName), "utf8"),
      ) as { $id: string };
      schemas.set(schemaName, schema);
      ajv.addSchema(schema);
    }
    for (const [schemaName, schema] of schemas) {
      const validator = ajv.getSchema(schema.$id);
      if (!validator) {
        throw new Error(`Schema did not compile: ${schemaName}`);
      }
      validators.set(schemaName, validator);
    }

    const config = parse(
      await readFile(
        resolve(
          "SL-templates/SL-repository/.github/SL-learning/SL-config.yml",
        ),
        "utf8",
      ),
    );
    const scopeCatalog = parse(
      await readFile(
        resolve(
          "SL-templates/SL-repository/.github/SL-learning/SL-scope-catalog.yml",
        ),
        "utf8",
      ),
    );
    const registry = JSON.parse(
      await readFile(
        resolve(
          "SL-templates/SL-repository/.github/SL-learning/SL-registry.json",
        ),
        "utf8",
      ),
    );
    expect(validators.get("SL-config.schema.json")!(config)).toBe(true);
    expect(
      validators.get("SL-scope-catalog.schema.json")!(scopeCatalog),
    ).toBe(true);
    expect(validators.get("SL-registry.schema.json")!(registry)).toBe(true);
  });

  test("keeps source workflow write credentials isolated from execution", async () => {
    const ciWorkflow = parse(
      await readFile(resolve(".github/workflows/SL-ci.yml"), "utf8"),
    ) as {
      permissions: { contents: string };
      jobs: {
        test: {
          steps: Array<{
            uses?: string;
            run?: string;
            with?: Record<string, unknown>;
          }>;
        };
      };
    };
    const forgettingWorkflow = parse(
      await readFile(resolve(".github/workflows/SL-forget.yml"), "utf8"),
    ) as {
      permissions: { contents: string };
      jobs: {
        plan: {
          permissions: { contents: string };
          steps: Array<{
            uses?: string;
            run?: string;
            with?: Record<string, unknown>;
          }>;
        };
        propose: {
          permissions: { contents: string; "pull-requests": string };
          steps: Array<{
            uses?: string;
            run?: string;
            with?: Record<string, unknown>;
          }>;
        };
      };
    };

    expect(ciWorkflow.permissions).toEqual({ contents: "read" });
    expect(
      (ciWorkflow as unknown as {
        jobs: { test: { strategy: { matrix: { os: string[] } } } };
      }).jobs.test.strategy.matrix.os,
    ).toEqual(["ubuntu-latest", "windows-latest", "macos-latest"]);
    expect(
      ciWorkflow.jobs.test.steps.some(
        (step) => step.run === "npm pack --dry-run --json",
      ),
    ).toBe(true);
    expect(forgettingWorkflow.permissions).toEqual({ contents: "read" });
    expect(forgettingWorkflow.jobs.plan.permissions).toEqual({
      contents: "read",
    });
    expect(forgettingWorkflow.jobs.propose.permissions).toEqual({
      contents: "write",
      "pull-requests": "write",
    });
    const checkouts = [
      ...ciWorkflow.jobs.test.steps,
      ...forgettingWorkflow.jobs.plan.steps,
      ...forgettingWorkflow.jobs.propose.steps,
    ].filter((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkouts).not.toHaveLength(0);
    for (const checkout of checkouts) {
      expect(checkout.with?.["persist-credentials"]).toBe(false);
    }
    expect(JSON.stringify(forgettingWorkflow.jobs.plan.steps)).not.toContain(
      "secrets.GITHUB_TOKEN",
    );
    expect(
      forgettingWorkflow.jobs.propose.steps.find((step) =>
        step.uses?.startsWith("peter-evans/create-pull-request@"),
      )?.uses,
    ).toBe(CREATE_PULL_REQUEST_ACTION);
    expect(
      [
        ...forgettingWorkflow.jobs.plan.steps,
        ...forgettingWorkflow.jobs.propose.steps,
      ].flatMap((step) => (step.uses === undefined ? [] : [step.uses])),
    ).toEqual([
      CHECKOUT_ACTION,
      UPLOAD_ARTIFACT_ACTION,
      CHECKOUT_ACTION,
      DOWNLOAD_ARTIFACT_ACTION,
      CREATE_PULL_REQUEST_ACTION,
    ]);
  });

  test("pins every action in source and consumer workflows", async () => {
    const workflowPaths = [
      ".github/workflows/SL-ci.yml",
      ".github/workflows/SL-forget.yml",
      "SL-templates/SL-repository/.github/workflows/SL-learning-validation.yml",
      "SL-templates/SL-repository/.github/workflows/SL-learning-forget.yml",
    ];

    for (const workflowPath of workflowPaths) {
      const workflow = parse(
        await readFile(resolve(workflowPath), "utf8"),
      ) as Workflow;
      expect(
        findMutableActions(workflow),
        workflowPath,
      ).toEqual([]);
    }

    expect(
      findMutableActions({
        permissions: { contents: "read" },
        jobs: {
          plan: {
            permissions: { contents: "read" },
            steps: [{ uses: "actions/checkout@v4" }],
          },
          propose: {
            permissions: {
              contents: "write",
              "pull-requests": "write",
            },
            steps: [{ uses: CHECKOUT_ACTION }],
          },
        },
      }),
    ).toEqual([
      "workflow.jobs.plan.steps[0].uses: actions/checkout@v4",
    ]);
  });

  test("retention workflows use trusted local runtimes and guard every PowerShell exit", async () => {
    const rootWorkflow = await readFile(
      resolve(".github/workflows/SL-forget.yml"),
      "utf8",
    );
    const templateWorkflow = await readFile(
      resolve(
        "SL-templates/SL-repository/.github/workflows/SL-learning-forget.yml",
      ),
      "utf8",
    );

    expect(rootWorkflow).toContain(
      "SL-templates/SL-repository/.github/SL-learning/SL-runtime/SL.ps1",
    );
    expect(rootWorkflow).toContain("--repo-root $env:GITHUB_WORKSPACE");
    expect(rootWorkflow).not.toContain(
      "pwsh .github/SL-learning/SL-runtime/SL.ps1",
    );
    for (const workflow of [rootWorkflow, templateWorkflow]) {
      const invocationCount = workflow.match(/& pwsh\b/g)?.length ?? 0;
      const exitGuardCount =
        workflow.match(/\$LASTEXITCODE -ne 0/g)?.length ?? 0;
      expect(invocationCount).toBeGreaterThan(0);
      expect(exitGuardCount).toBe(invocationCount);
      expect(workflow).not.toMatch(/\b(?:node|npm|npx)\b/);
    }
  });

  test("uses the committed local runtime in Azure Pipelines without embedded credentials", async () => {
    const templatePaths = [
      "SL-templates/SL-repository/.azure-pipelines/SL-learning/SL-validation.yml",
      "SL-templates/SL-repository/.azure-pipelines/SL-learning/SL-retention.yml",
    ];

    for (const templatePath of templatePaths) {
      const content = await readFile(resolve(templatePath), "utf8");
      const template = parse(content) as {
        parameters: Array<{ name: string }>;
        jobs: Array<{ steps: Array<Record<string, unknown>> }>;
      };
      expect(content).toContain(
        ".github/SL-learning/SL-runtime/SL.ps1",
      );
      expect(content).not.toMatch(/\b(?:pat|password|token)\s*:/i);
      expect(content).not.toMatch(
        /(?:dev\.azure\.com|github\.com)\/[A-Za-z0-9_.-]+/i,
      );
      expect(findFloatingRuntimeRefs(content)).toEqual([]);
      expect(content).not.toMatch(
        /\b(?:UseNode|npm|node\s+\$runtime|runtimeRepository|SL-tool)\b/,
      );
      expect(
        template.parameters.some(
          (parameter) => parameter.name === "runtimeCommit",
        ),
      ).toBe(false);
      expect(
        template.jobs[0]!.steps.some(
          (step) => step["persistCredentials"] === false,
        ),
      ).toBe(true);
    }

    expect(
      findFloatingRuntimeRefs("resources:\n  repositories:\n    - ref: main\n"),
    ).toEqual(["    - ref: main"]);
    expect(
      findFloatingRuntimeRefs(
        "resources:\n  repositories:\n    - ref: refs/heads/release\n",
      ),
    ).toEqual(["    - ref: refs/heads/release"]);
  });
});
