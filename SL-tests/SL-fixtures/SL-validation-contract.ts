import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  SLExecutableValidationCheck,
  SLPromotedArtifactType,
  SLValidationContract,
  SLValidationDeclaration,
} from "../../SL-src/SL-validation/SL-validation-contract.js";

export const SL_TEST_CONTRACT_ROOT =
  ".github/sl-learning/sl-validation-contracts";

export function slTestContractPath(artifactId: string): string {
  return `${SL_TEST_CONTRACT_ROOT}/${artifactId.toLowerCase()}.validation.json`;
}

export function slCreateTestContract(options: {
  artifactId: string;
  artifactType: SLPromotedArtifactType;
  artifactPath: string;
  sourceIds: string[];
  declarations?: SLValidationDeclaration[];
  executableChecks?: SLExecutableValidationCheck[];
}): SLValidationContract {
  return {
    schemaVersion: 1,
    artifact: {
      id: options.artifactId,
      type: options.artifactType,
      path: options.artifactPath,
    },
    provenance: {
      sourceIds: options.sourceIds,
      summary: "Fixed test provenance.",
    },
    scope: {
      kind: "paths",
      paths: ["SL-src/**/*.ts"],
      description: "Fixed test scope.",
    },
    scenarios: [
      {
        id: "applies-expected-guidance",
        input: { request: "Use the promoted guidance." },
        expectedBehavior: "The agent follows the promoted repository guidance.",
        counterexamples: [
          {
            input: { request: "Unrelated request." },
            expectedBehavior:
              "The agent does not apply unrelated promoted guidance.",
          },
        ],
      },
    ],
    ...(options.declarations
      ? { declarations: options.declarations }
      : {}),
    ...(options.executableChecks
      ? { executableChecks: options.executableChecks }
      : {}),
  };
}

export async function slWriteTestJson(
  root: string,
  relativePath: string,
  value: unknown,
): Promise<void> {
  const absolutePath = join(root, ...relativePath.split("/"));
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

export async function slWriteTestPromotedArtifact(options: {
  root: string;
  artifactId: string;
  artifactType: SLPromotedArtifactType;
  artifactPath: string;
  contractPath: string;
  body?: string;
}): Promise<void> {
  const absolutePath = join(
    options.root,
    ...options.artifactPath.split("/"),
  );
  await mkdir(dirname(absolutePath), { recursive: true });
  const typeFrontmatter =
    options.artifactType === "instruction"
      ? 'applyTo: "SL-src/**/*.ts"'
      : `name: ${dirname(options.artifactPath).split(/[\\/]/).at(-1)}`;
  await writeFile(
    absolutePath,
    [
      "---",
      `id: ${options.artifactId}`,
      typeFrontmatter,
      `validationContract: "${options.contractPath}"`,
      "---",
      "",
      options.body ?? "# Promoted test artifact",
      "",
    ].join("\n"),
    "utf8",
  );
}
