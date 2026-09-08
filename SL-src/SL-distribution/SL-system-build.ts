import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SL_RUNTIME_VERSION } from "../SL-core/SL-constants.js";
import {
  SL_SCHEMA_BUNDLE_PATH,
  SL_SYSTEM_MANIFEST_PATH,
  slSystemTextHash,
  slValidateSystemManifest,
  type SLSystemArtifactCategory,
  type SLSystemManifest,
  type SLSystemManifestFile,
} from "../SL-core/SL-system.js";
import { slCompareOrdinal } from "../SL-core/SL-utils.js";

const SL_CURRENT_SYSTEM_FILES: Array<{
  path: string;
  category: SLSystemArtifactCategory;
}> = [
  {
    path: ".github/sl-learning/.gitattributes",
    category: "core",
  },
  {
    path: SL_SCHEMA_BUNDLE_PATH,
    category: "core",
  },
  {
    path: ".github/skills/sl-learning-audit/SKILL.md",
    category: "core",
  },
  {
    path: ".github/skills/sl-lesson-curator/SKILL.md",
    category: "core",
  },
  {
    path: ".github/workflows/sl-learning-forget.yml",
    category: "github",
  },
  {
    path: ".github/workflows/sl-learning-validation.yml",
    category: "github",
  },
  {
    path: ".azure-pipelines/sl-learning/sl-retention.yml",
    category: "azure",
  },
  {
    path: ".azure-pipelines/sl-learning/sl-validation.yml",
    category: "azure",
  },
];

function slNormalizeText(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

async function slWriteIfChanged(path: string, content: string): Promise<void> {
  let existing: string | undefined;
  try {
    existing = await readFile(path, "utf8");
  } catch {
    existing = undefined;
  }
  if (existing === content) {
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

interface SLGeneratedFileSnapshot {
  path: string;
  content?: Buffer;
}

async function slSnapshotGeneratedFile(
  path: string,
): Promise<SLGeneratedFileSnapshot> {
  try {
    return { path, content: await readFile(path) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path };
    }
    throw error;
  }
}

async function slRestoreGeneratedFiles(
  snapshots: SLGeneratedFileSnapshot[],
): Promise<void> {
  for (const snapshot of [...snapshots].reverse()) {
    if (snapshot.content === undefined) {
      await rm(snapshot.path, { force: true });
      continue;
    }
    await mkdir(dirname(snapshot.path), { recursive: true });
    await writeFile(snapshot.path, snapshot.content);
  }
}

export async function slBuildSystemArtifacts(
  packageRoot: string,
): Promise<SLSystemManifest> {
  const schemaRoot = resolve(packageRoot, "SL-schemas");
  const templateRoot = resolve(packageRoot, "SL-templates", "SL-repository");
  const schemaNames = (await readdir(schemaRoot))
    .filter((name) => name.endsWith(".schema.json"))
    .sort(slCompareOrdinal);
  if (schemaNames.length === 0) {
    throw new Error("No SL schemas were found for the compound bundle.");
  }
  const schemas = await Promise.all(
    schemaNames.map(async (name) => {
      const content = slNormalizeText(
        await readFile(resolve(schemaRoot, name), "utf8"),
      );
      return {
        name,
        content,
        schema: JSON.parse(content) as Record<string, unknown>,
      };
    }),
  );
  const firstSchemaId = schemas[0]?.schema.$id;
  if (typeof firstSchemaId !== "string") {
    throw new Error("SL schemas require canonical $id values.");
  }
  const bundleId = new URL("sl-schema-bundle.schema.json", firstSchemaId).href;
  const bundle = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: bundleId,
    title: "SL Repo compound schema bundle",
    $defs: Object.fromEntries(
      schemas.map(({ name, schema }) => [name, schema]),
    ),
  };
  const bundleContent = `${JSON.stringify(bundle)}\n`;
  const bundleTarget = resolve(templateRoot, SL_SCHEMA_BUNDLE_PATH);
  const manifestTarget = resolve(templateRoot, SL_SYSTEM_MANIFEST_PATH);
  const snapshots = await Promise.all([
    slSnapshotGeneratedFile(bundleTarget),
    slSnapshotGeneratedFile(manifestTarget),
  ]);
  try {
    await slWriteIfChanged(bundleTarget, bundleContent);
    const files: SLSystemManifestFile[] = [];
    for (const file of [...SL_CURRENT_SYSTEM_FILES].sort((left, right) =>
      slCompareOrdinal(left.path, right.path),
    )) {
      const content =
        file.path === SL_SCHEMA_BUNDLE_PATH
          ? bundleContent
          : await readFile(resolve(templateRoot, file.path), "utf8");
      files.push({
        ...file,
        sha256: slSystemTextHash(content),
      });
    }
    const manifest: SLSystemManifest = {
      schemaVersion: 1,
      layoutVersion: 1,
      runtimeVersion: SL_RUNTIME_VERSION,
      files,
    };
    slValidateSystemManifest(manifest);
    await slWriteIfChanged(
      manifestTarget,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return manifest;
  } catch (error) {
    await slRestoreGeneratedFiles(snapshots);
    throw error;
  }
}
