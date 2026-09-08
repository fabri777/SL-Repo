import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import { slLoadStateCatalog } from "../../SL-src/SL-core/SL-state.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

function runPowerShell(
  scriptPath: string,
  argumentsList: string[],
  cwd: string,
  pathValue?: string,
) {
  return spawnSync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-File", scriptPath, ...argumentsList],
    {
      cwd,
      encoding: "utf8",
      timeout: process.platform === "win32" ? 90_000 : 60_000,
      ...(pathValue === undefined
        ? {}
        : { env: { ...process.env, PATH: pathValue } }),
    },
  );
}

function powerShellExecutable(): string {
  const probe = spawnSync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-Command", "(Get-Process -Id $PID).Path"],
    { encoding: "utf8" },
  );
  if (probe.status !== 0) {
    throw new Error(String(probe.stderr));
  }
  return String(probe.stdout).trim();
}

describe("repository-local PowerShell runtime", () => {
  test("installs a self-contained runtime and runs exact conformance", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const canonicalRoot = await realpath(root);

    await slInstall(root, "init", false);
    const runtimeRoot = join(root, ".github", "sl-learning", "sl-runtime");
    const scriptPath = join(runtimeRoot, "sl.ps1");
    const manifest = JSON.parse(
      await readFile(join(runtimeRoot, "sl-runtime.manifest.json"), "utf8"),
    ) as { runtimeVersion: string; files: Array<{ path: string }> };
    const bash = await readFile(join(runtimeRoot, "sl.sh"), "utf8");
    const registry = await slLoadRegistry(root);
    const nested = join(root, "services", "orders");
    await mkdir(nested, { recursive: true });

    expect(manifest.runtimeVersion).toBe("0.6.0");
    expect(manifest.files).toHaveLength(3);
    expect(
      registry.artifacts.filter((artifact) =>
        artifact.path?.startsWith(".github/sl-learning/sl-runtime/"),
      ),
    ).toHaveLength(4);
    expect(
      registry.artifacts
        .filter((artifact) =>
          artifact.path?.startsWith(".github/sl-learning/sl-runtime/"),
        )
        .every(
          (artifact) =>
            artifact.managedBy === "sl" &&
            artifact.classification === "system",
        ),
    ).toBe(true);
    expect(bash).toContain("exec pwsh");
    expect(bash).not.toMatch(/\b(?:node|npm|npx)\b/);

    const conformance = runPowerShell(
      scriptPath,
      ["--json", "conformance"],
      nested,
    );
    expect(conformance.status, conformance.stderr).toBe(0);
    expect(JSON.parse(conformance.stdout)).toMatchObject({
      command: "conformance",
      repositoryRoot: canonicalRoot,
      result: { conformanceVersion: 1, passed: 33, failed: 0 },
    });

    const doctor = runPowerShell(
      scriptPath,
      ["doctor", "--json", "--dry-run"],
      nested,
    );
    expect(doctor.status, doctor.stderr).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      command: "doctor",
      repositoryRoot: canonicalRoot,
      dryRun: true,
      healthy: true,
    });
  });

  test("smokes an empty repository through the committed PowerShell runtime", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const canonicalRoot = await realpath(root);
    await slInstall(root, "init", false);
    const scriptPath = join(
      root,
      ".github",
      "sl-learning",
      "sl-runtime",
      "sl.ps1",
    );

    const project = runPowerShell(scriptPath, ["--json", "project"], root);
    const projectOutput = JSON.parse(project.stdout) as { changes: unknown };

    const catalog = await slLoadStateCatalog(root);
    const scope = catalog.scopes[0]!;
    const usageProjectionPath = join(
      root,
      ...scope.projectionPath.split("/"),
    );
    const resourceProjectionPath = join(
      root,
      ...scope.resourceProjectionPath!.split("/"),
    );

    const doctor = runPowerShell(scriptPath, ["--json", "doctor"], root);
    const doctorOutput = JSON.parse(doctor.stdout) as {
      command: string;
      repositoryRoot: string;
      healthy: boolean;
      issueCount: number;
      issues: unknown;
    };

    const validate = runPowerShell(scriptPath, ["--json", "validate"], root);
    const validateOutput = JSON.parse(validate.stdout) as {
      valid: boolean;
      issues: unknown;
    };

    expect({
      scopeCount: catalog.scopes.length,
      projectStatus: project.status,
      projectError: project.stderr,
      projectChangesAreArray: Array.isArray(projectOutput.changes),
      usageProjectionExists: await access(usageProjectionPath)
        .then(() => true)
        .catch(() => false),
      resourceProjectionExists: await access(resourceProjectionPath)
        .then(() => true)
        .catch(() => false),
      doctorStatus: doctor.status,
      doctorError: doctor.stderr,
      doctorCommand: doctorOutput.command,
      doctorRepositoryRoot: doctorOutput.repositoryRoot,
      doctorHealthy: doctorOutput.healthy,
      doctorIssueCount: doctorOutput.issueCount,
      doctorIssues: doctorOutput.issues,
      validateStatus: validate.status,
      validateError: validate.stderr,
      validateValid: validateOutput.valid,
      validateIssues: validateOutput.issues,
    }).toEqual({
      scopeCount: 1,
      projectStatus: 0,
      projectError: "",
      projectChangesAreArray: true,
      usageProjectionExists: false,
      resourceProjectionExists: false,
      doctorStatus: 0,
      doctorError: "",
      doctorCommand: "doctor",
      doctorRepositoryRoot: canonicalRoot,
      doctorHealthy: true,
      doctorIssueCount: 0,
      doctorIssues: [],
      validateStatus: 0,
      validateError: "",
      validateValid: true,
      validateIssues: [],
    });
  });

  test("keeps dry-run side-effect free", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);

    const changes = await slInstall(root, "init", true);

    expect(
      changes.some(
        (change) =>
          change.path === ".github/sl-learning/sl-runtime/sl.ps1" &&
          change.action === "create",
      ),
    ).toBe(true);
    await expect(
      access(join(root, ".github", "sl-learning", "sl-runtime")),
    ).rejects.toThrow();
  });

  test("runs end to end with no Node executable available", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const runtimeRoot = join(root, ".github", "sl-learning", "sl-runtime");
    const emptyPath = join(root, "empty-path");
    await mkdir(emptyPath);

    const result = spawnSync(
      powerShellExecutable(),
      [
        "-NoLogo",
        "-NoProfile",
        "-File",
        join(runtimeRoot, "sl.ps1"),
        "--json",
        "--repo-root",
        root,
        "conformance",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: emptyPath },
      },
    );

    expect(result.status, String(result.stderr)).toBe(0);
    expect(JSON.parse(String(result.stdout))).toMatchObject({
      command: "conformance",
      result: { passed: 33, failed: 0 },
    });
  });

  test("verifies executable payloads before importing the runtime module", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const runtimeRoot = join(root, ".github", "sl-learning", "sl-runtime");
    const scriptPath = join(runtimeRoot, "sl.ps1");
    const markerPath = join(root, "corrupt-module-executed.txt");
    const modulePath = join(runtimeRoot, "sl.runtime.psm1");
    const original = await readFile(modulePath, "utf8");
    await writeFile(
      modulePath,
      `Set-Content -LiteralPath '${markerPath.replaceAll("'", "''")}' -Value 'executed'\n${original}`,
      "utf8",
    );

    const result = runPowerShell(scriptPath, ["version", "--json"], root);

    expect(result.status).toBe(6);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "bootstrap",
      healthy: false,
      checks: [
        expect.objectContaining({
          code: "runtime-hash-drift",
          message: "Runtime file hash drift: sl.runtime.psm1",
        }),
      ],
    });
    await expect(access(markerPath)).rejects.toThrow();
  });

  test("fails bootstrap when a declared executable payload is missing", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const runtimeRoot = join(root, ".github", "sl-learning", "sl-runtime");
    const scriptPath = join(runtimeRoot, "sl.ps1");
    await rm(join(runtimeRoot, "sl.runtime.psm1"));

    const result = runPowerShell(scriptPath, ["doctor", "--json"], root);

    expect(result.status).toBe(6);
    expect(JSON.parse(result.stdout).checks).toContainEqual(
      expect.objectContaining({
        code: "runtime-file-missing",
        message: "Runtime file is missing: sl.runtime.psm1",
      }),
    );
  });

  test("rejects local runtime drift and preserves unrelated files", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const runtimeRoot = join(root, ".github", "sl-learning", "sl-runtime");
    const manualPath = join(runtimeRoot, "notes.txt");
    const managedPath = join(runtimeRoot, "sl.runtime.psm1");
    await writeFile(manualPath, "manual\n", "utf8");
    await writeFile(managedPath, "locally modified\n", "utf8");

    await expect(slInstall(root, "update", false)).rejects.toThrow(
      "locally modified or mixed-version",
    );
    expect(await readFile(manualPath, "utf8")).toBe("manual\n");
    expect(await readFile(managedPath, "utf8")).toBe("locally modified\n");
  });

  test("updates only a runtime that still matches its previous manifest", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const runtimeRoot = join(root, ".github", "sl-learning", "sl-runtime");
    const manifestPath = join(runtimeRoot, "sl-runtime.manifest.json");
    const managedPath = join(runtimeRoot, "sl.runtime.psm1");
    const manualPath = join(runtimeRoot, "manual-notes.txt");
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as {
      runtimeVersion: string;
      files: Array<{ path: string; sha256: string }>;
    };
    const previousContent = "# prior reviewed runtime\n";
    await writeFile(managedPath, previousContent, "utf8");
    manifest.runtimeVersion = "0.0.9";
    manifest.files.find(
      (file) => file.path === "sl.runtime.psm1",
    )!.sha256 = createHash("sha256")
      .update(previousContent, "utf8")
      .digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(manualPath, "preserve\n", "utf8");

    await slInstall(root, "update", false);

    expect(await readFile(managedPath, "utf8")).toContain(
      "function ConvertTo-SLCanonicalJson",
    );
    expect(await readFile(manualPath, "utf8")).toBe("preserve\n");
    expect(
      JSON.parse(await readFile(manifestPath, "utf8")).runtimeVersion,
    ).toBe("0.6.0");
  });

  test("rejects a runtime without its previous manifest", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const runtimeRoot = join(root, ".github", "sl-learning", "sl-runtime");
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(join(runtimeRoot, "sl.ps1"), "manual\n", "utf8");

    await expect(slInstall(root, "update", false)).rejects.toThrow(
      "without a previous manifest",
    );
  });

  test("returns stable doctor exit codes for manifest failures", async () => {
    const root = await slCreateTestRepository();
    const missingRoot = await slCreateTestRepository();
    const mixedRoot = await slCreateTestRepository();
    repositories.push(root, missingRoot, mixedRoot);
    await slInstall(root, "init", false);
    const runtimeRoot = join(root, ".github", "sl-learning", "sl-runtime");
    const scriptPath = join(runtimeRoot, "sl.ps1");

    await writeFile(
      join(runtimeRoot, "sl.runtime.psm1"),
      '{"drift":true}\n',
      "utf8",
    );
    const drift = runPowerShell(
      scriptPath,
      ["validate-runtime", "--json"],
      root,
    );
    expect(drift.status).toBe(6);
    expect(JSON.parse(drift.stdout).checks).toContainEqual(
      expect.objectContaining({ code: "runtime-hash-drift" }),
    );

    await slInstall(missingRoot, "init", false);
    const missingRuntimeRoot = join(
      missingRoot,
      ".github",
      "sl-learning",
      "sl-runtime",
    );
    const missingScriptPath = join(missingRuntimeRoot, "sl.ps1");
    await rm(join(missingRuntimeRoot, "sl-runtime.manifest.json"));
    const missing = runPowerShell(
      missingScriptPath,
      ["doctor", "--json"],
      missingRoot,
    );
    expect(missing.status).toBe(5);
    expect(JSON.parse(missing.stdout).checks).toContainEqual(
      expect.objectContaining({ code: "runtime-manifest-missing" }),
    );

    await slInstall(mixedRoot, "init", false);
    const mixedRuntimeRoot = join(
      mixedRoot,
      ".github",
      "sl-learning",
      "sl-runtime",
    );
    const mixedManifestPath = join(
      mixedRuntimeRoot,
      "sl-runtime.manifest.json",
    );
    const mixedManifest = JSON.parse(
      await readFile(mixedManifestPath, "utf8"),
    ) as { runtimeVersion: string };
    mixedManifest.runtimeVersion = "0.0.9";
    await writeFile(
      mixedManifestPath,
      `${JSON.stringify(mixedManifest, null, 2)}\n`,
    );
    const mixed = runPowerShell(
      join(mixedRuntimeRoot, "sl.ps1"),
      ["doctor", "--json"],
      mixedRoot,
    );
    expect(mixed.status).toBe(7);
    expect(JSON.parse(mixed.stdout).checks).toContainEqual(
      expect.objectContaining({ code: "runtime-mixed-version" }),
    );
  });

  test("Bash launcher reports missing pwsh with the stable version exit code", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const launcher = join(
      root,
      ".github",
      "sl-learning",
      "sl-runtime",
      "sl.sh",
    );
    const result = spawnSync("/bin/bash", [launcher, "version"], {
      cwd: dirname(launcher),
      encoding: "utf8",
      env: { ...process.env, PATH: resolve(root, "empty-bin") + delimiter },
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain("pwsh was not found");
  });
});
