import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SL_RUNTIME_CONFORMANCE_VERSION } from "../SL-core/SL-constants.js";
import { slFindPackageRoot } from "../SL-core/SL-package.js";
import type {
  SLRuntimeConformanceVectors,
} from "../SL-core/SL-types.js";
import {
  SLRuntimeContractError,
  slRunRuntimeVector,
  slRuntimeCanonicalJson,
} from "./SL-runtime-contract.js";

export interface SLRuntimeConformanceResult {
  conformanceVersion: number;
  passed: number;
  failed: number;
  failures: Array<{
    id: string;
    expected: string;
    actual: string;
  }>;
}

export async function slRunTypeScriptConformance(
  vectorsPath?: string,
): Promise<SLRuntimeConformanceResult> {
  const packageRoot = await slFindPackageRoot(import.meta.url);
  const sourcePath =
    vectorsPath ??
    resolve(
      packageRoot,
      "SL-templates",
      "SL-repository",
      ".github",
      "SL-learning",
      "SL-runtime",
      "SL-conformance-vectors.json",
    );
  const suite = JSON.parse(
    await readFile(sourcePath, "utf8"),
  ) as SLRuntimeConformanceVectors;
  if (
    suite.schemaVersion !== 1 ||
    suite.conformanceVersion !== SL_RUNTIME_CONFORMANCE_VERSION ||
    !Array.isArray(suite.vectors)
  ) {
    throw new Error("Unsupported SL runtime conformance vector format.");
  }
  const failures: SLRuntimeConformanceResult["failures"] = [];
  for (const vector of suite.vectors) {
    let actual: unknown;
    try {
      actual = slRunRuntimeVector(vector);
      if (vector.error) {
        failures.push({
          id: vector.id,
          expected: `error:${vector.error}`,
          actual: slRuntimeCanonicalJson(actual),
        });
        continue;
      }
    } catch (error) {
      if (
        vector.error &&
        error instanceof SLRuntimeContractError &&
        error.code === vector.error
      ) {
        continue;
      }
      failures.push({
        id: vector.id,
        expected: vector.error
          ? `error:${vector.error}`
          : slRuntimeCanonicalJson(vector.expected),
        actual:
          error instanceof SLRuntimeContractError
            ? `error:${error.code}`
            : `error:${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const expected = slRuntimeCanonicalJson(vector.expected);
    const normalizedActual = slRuntimeCanonicalJson(actual);
    if (normalizedActual !== expected) {
      failures.push({
        id: vector.id,
        expected,
        actual: normalizedActual,
      });
    }
  }
  return {
    conformanceVersion: suite.conformanceVersion,
    passed: suite.vectors.length - failures.length,
    failed: failures.length,
    failures,
  };
}

if (process.argv[1]) {
  if (pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const result = await slRunTypeScriptConformance(process.argv[2]);
    console.log(JSON.stringify(result));
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  }
}
