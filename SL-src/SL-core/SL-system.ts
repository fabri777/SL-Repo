import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { slCompareOrdinal, slNormalizePath } from "./SL-utils.js";

export const SL_SCHEMA_BUNDLE_PATH =
  ".github/sl-learning/sl-schema-bundle.schema.json";
export const SL_SYSTEM_MANIFEST_PATH =
  ".github/sl-learning/sl-system.manifest.json";

export type SLSystemArtifactCategory = "core" | "github" | "azure";

export interface SLSystemManifestFile {
  path: string;
  category: SLSystemArtifactCategory;
  sha256: string;
}

export interface SLSystemManifest {
  schemaVersion: 1;
  layoutVersion: 1;
  runtimeVersion: string;
  files: SLSystemManifestFile[];
}

export function slSystemTextHash(value: string | Buffer): string {
  const content =
    typeof value === "string" ? value : value.toString("utf8");
  return createHash("sha256")
    .update(
      Buffer.from(
        content.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
        "utf8",
      ),
    )
    .digest("hex");
}

export function slValidateSystemManifest(
  value: unknown,
): asserts value is SLSystemManifest {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error("SL system manifest must be an object.");
  }
  const manifest = value as Partial<SLSystemManifest>;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.layoutVersion !== 1 ||
    typeof manifest.runtimeVersion !== "string" ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("SL system manifest header is invalid.");
  }
  let previous = "";
  for (const file of manifest.files) {
    if (
      typeof file !== "object" ||
      file === null ||
      !["core", "github", "azure"].includes(file.category) ||
      typeof file.path !== "string" ||
      slNormalizePath(file.path) !== file.path ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      (previous && slCompareOrdinal(previous, file.path) >= 0)
    ) {
      throw new Error("SL system manifest file inventory is invalid.");
    }
    previous = file.path;
  }
}

export async function slLoadSystemManifest(
  path: string,
): Promise<SLSystemManifest> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  slValidateSystemManifest(value);
  return value;
}
