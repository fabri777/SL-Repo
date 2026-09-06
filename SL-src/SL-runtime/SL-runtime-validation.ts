import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SL_PATHS,
  SL_RUNTIME_MANIFEST_FILE,
  SL_RUNTIME_VERSION,
} from "../SL-core/SL-constants.js";
import type {
  SLRuntimeManifest,
  SLValidationIssue,
} from "../SL-core/SL-types.js";
import {
  slExists,
  slNormalizePath,
  slReadJson,
  slResolveInside,
} from "../SL-core/SL-utils.js";
import { slValidateRuntimeManifest } from "./SL-runtime-contract.js";

function slRuntimeHash(content: Buffer): string {
  const normalized = content
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function slPowerShellProbeIssue(probe: {
  errorCode?: string;
  status: number | null;
  stdout: string;
}): SLValidationIssue | undefined {
  if (probe.errorCode === "ENOENT") {
    return {
      severity: "error",
      code: "runtime-pwsh-missing",
      path: SL_PATHS.runtimePowerShellLauncher,
      message: "PowerShell 7 is required, but pwsh was not found.",
    };
  }
  if (probe.status !== 0) {
    return {
      severity: "error",
      code: "runtime-pwsh-check",
      path: SL_PATHS.runtimePowerShellLauncher,
      message: "Unable to determine the installed PowerShell version.",
    };
  }
  const major = Number.parseInt(probe.stdout.trim(), 10);
  if (!Number.isInteger(major) || major < 7) {
    return {
      severity: "error",
      code: "runtime-pwsh-version",
      path: SL_PATHS.runtimePowerShellLauncher,
      message: `PowerShell 7 or newer is required; detected major version ${probe.stdout.trim() || "unknown"}.`,
    };
  }
  return undefined;
}

export async function slLoadRuntimeManifest(
  path: string,
  enforceCurrentPayloadInventory = true,
): Promise<SLRuntimeManifest> {
  const manifest = await slReadJson<unknown>(path);
  slValidateRuntimeManifest(manifest, enforceCurrentPayloadInventory);
  return manifest;
}

export async function slVerifyRuntimeDirectory(
  runtimeRoot: string,
  expectedRuntimeVersion?: string,
  enforceCurrentPayloadInventory = true,
): Promise<SLValidationIssue[]> {
  const issues: SLValidationIssue[] = [];
  const manifestPath = resolve(runtimeRoot, SL_RUNTIME_MANIFEST_FILE);
  if (!(await slExists(manifestPath))) {
    return [
      {
        severity: "error",
        code: "runtime-manifest-missing",
        path: slNormalizePath(manifestPath),
        message: "SL runtime manifest is missing.",
      },
    ];
  }
  let manifest: SLRuntimeManifest;
  try {
    manifest = await slLoadRuntimeManifest(
      manifestPath,
      enforceCurrentPayloadInventory,
    );
  } catch (error) {
    return [
      {
        severity: "error",
        code: "runtime-manifest-invalid",
        path: slNormalizePath(manifestPath),
        message:
          error instanceof Error
            ? error.message
            : "SL runtime manifest is invalid.",
      },
    ];
  }
  if (
    expectedRuntimeVersion &&
    manifest.runtimeVersion !== expectedRuntimeVersion
  ) {
    issues.push({
      severity: "error",
      code: "runtime-mixed-version",
      path: slNormalizePath(manifestPath),
      message: `Installed runtime ${manifest.runtimeVersion} does not match expected runtime ${expectedRuntimeVersion}.`,
    });
  }
  const managedPaths = new Set(manifest.files.map((file) => file.path));
  for (const file of manifest.files) {
    const absolutePath = resolve(runtimeRoot, file.path);
    if (!(await slExists(absolutePath))) {
      issues.push({
        severity: "error",
        code: "runtime-file-missing",
        path: file.path,
        message: "Managed runtime file is missing.",
      });
      continue;
    }
    const actual = slRuntimeHash(await readFile(absolutePath));
    if (actual !== file.sha256) {
      issues.push({
        severity: "error",
        code: "runtime-hash-drift",
        path: file.path,
        message: `Managed runtime file hash differs from manifest (${actual}).`,
      });
    }
  }
  for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      entry.name !== SL_RUNTIME_MANIFEST_FILE &&
      !managedPaths.has(entry.name) &&
      (/^SL\.Runtime\..+\.(?:ps1|psm1)$/.test(entry.name) ||
        [
          "SL.ps1",
          "SL.sh",
          "SL-conformance-vectors.json",
          "SL-runtime-manifest.schema.json",
        ].includes(entry.name))
    ) {
      issues.push({
        severity: "error",
        code: "runtime-mixed-version",
        path: entry.name,
        message:
          "Runtime contains a contract file that is not declared by its manifest.",
      });
    }
  }
  const bashPath = resolve(runtimeRoot, "SL.sh");
  if (await slExists(bashPath)) {
    const bash = await readFile(bashPath, "utf8");
    if (
      !bash.includes("exec pwsh") ||
      /\b(?:node|npm|npx|sl-repo)\b/.test(bash)
    ) {
      issues.push({
        severity: "error",
        code: "runtime-bash-launcher",
        path: "SL.sh",
        message:
          "Bash launcher must delegate only to repository-local SL.ps1 through pwsh.",
      });
    }
  }
  return issues;
}

export async function slValidateInstalledRuntime(
  root: string,
  options: { checkPowerShell: boolean },
): Promise<SLValidationIssue[]> {
  const runtimeRoot = slResolveInside(root, SL_PATHS.runtimeRoot);
  if (!(await slExists(runtimeRoot))) {
    return [
      {
        severity: "error",
        code: "runtime-missing",
        path: SL_PATHS.runtimeRoot,
        message: "Repository-local SL PowerShell runtime is missing.",
      },
    ];
  }
  const issues = await slVerifyRuntimeDirectory(
    runtimeRoot,
    SL_RUNTIME_VERSION,
  );
  if (options.checkPowerShell) {
    const result = spawnSync(
      "pwsh",
      [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        "$PSVersionTable.PSVersion.Major",
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    const issue = slPowerShellProbeIssue({
      ...(result.error && "code" in result.error
        ? { errorCode: String(result.error.code) }
        : {}),
      status: result.status,
      stdout: result.stdout,
    });
    if (issue) {
      issues.push(issue);
    }
  }
  return issues;
}
