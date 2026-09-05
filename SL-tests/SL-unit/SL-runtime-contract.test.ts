import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  SL_RUNTIME_PAYLOAD_FILES,
  SL_RUNTIME_VERSION,
} from "../../SL-src/SL-core/SL-constants.js";
import {
  slNormalizeRuntimePath,
  slParseRuntimeYaml,
  slRuntimeGlobMatch,
  slValidateRuntimeManifest,
} from "../../SL-src/SL-runtime/SL-runtime-contract.js";
import { slBuildRuntimeManifest } from "../../SL-src/SL-runtime/SL-runtime-build.js";
import { slRunTypeScriptConformance } from "../../SL-src/SL-runtime/SL-runtime-conformance.js";
import { slPowerShellProbeIssue } from "../../SL-src/SL-runtime/SL-runtime-validation.js";

const runtimeRoot = resolve(
  "SL-templates",
  "SL-repository",
  ".github",
  "SL-learning",
  "SL-runtime",
);

describe("SL PowerShell runtime contract", () => {
  test("passes every shared TypeScript conformance vector", async () => {
    const result = await slRunTypeScriptConformance();

    expect(result).toEqual({
      conformanceVersion: 1,
      passed: 30,
      failed: 0,
      failures: [],
    });
  });

  test("parses the supported nested config and scope catalog YAML", async () => {
    const config = slParseRuntimeYaml(
      await readFile(
        resolve("SL-templates/SL-repository/.github/SL-learning/SL-config.yml"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const catalog = slParseRuntimeYaml(
      await readFile(
        resolve(
          "SL-templates/SL-repository/.github/SL-learning/SL-scope-catalog.yml",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(config).toMatchObject({
      schemaVersion: 1,
      scope: "repo",
      retention: { staleAfterDays: 90 },
      promotion: {
        mode: "single-repository",
        approvals: { requireTargetOwnerApproval: true },
      },
    });
    expect(catalog).toEqual({
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
  });

  test("normalizes Windows paths and enforces documented glob semantics", () => {
    expect(
      slNormalizeRuntimePath("services\\orders\\.\\src\\..\\README.md"),
    ).toBe("services/orders/README.md");
    expect(slRuntimeGlobMatch("services/**", "services\\orders\\api.ts")).toBe(
      true,
    );
    expect(slRuntimeGlobMatch("services/*.ts", "services/orders/api.ts")).toBe(
      false,
    );
    expect(() => slRuntimeGlobMatch("src/*.{ts,tsx}", "src/a.ts")).toThrow(
      "Unsupported glob syntax",
    );
  });

  test("generates a deterministic manifest covering every payload file", async () => {
    const first = await slBuildRuntimeManifest();
    const firstBytes = await readFile(
      resolve(runtimeRoot, "SL-runtime.manifest.json"),
      "utf8",
    );
    const second = await slBuildRuntimeManifest();
    const secondBytes = await readFile(
      resolve(runtimeRoot, "SL-runtime.manifest.json"),
      "utf8",
    );

    slValidateRuntimeManifest(first);
    expect(second).toEqual(first);
    expect(secondBytes).toBe(firstBytes);
    expect(first.runtimeVersion).toBe(SL_RUNTIME_VERSION);
    expect(first.sourceReleaseCommit).toBe("__SL_SOURCE_RELEASE_COMMIT__");
    expect(first.files.map((file) => file.path)).toEqual(
      SL_RUNTIME_PAYLOAD_FILES,
    );
  });

  test("classifies missing and unsupported PowerShell probes", () => {
    expect(
      slPowerShellProbeIssue({
        errorCode: "ENOENT",
        status: null,
        stdout: "",
      })?.code,
    ).toBe("runtime-pwsh-missing");
    expect(
      slPowerShellProbeIssue({ status: 0, stdout: "6\n" })?.code,
    ).toBe("runtime-pwsh-version");
    expect(slPowerShellProbeIssue({ status: 0, stdout: "7\n" })).toBeUndefined();
  });
});
