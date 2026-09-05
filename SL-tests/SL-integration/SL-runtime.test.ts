import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
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
      timeout: 30_000,
      ...(pathValue === undefined
        ? {}
        : { env: { ...process.env, PATH: pathValue } }),
    },
  );
}

describe("repository-local PowerShell runtime", () => {
  test("installs a self-contained runtime and runs exact conformance", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);

    await slInstall(root, "init", false);
    const runtimeRoot = join(root, ".github", "SL-learning", "SL-runtime");
    const scriptPath = join(runtimeRoot, "SL.ps1");
    const manifest = JSON.parse(
      await readFile(join(runtimeRoot, "SL-runtime.manifest.json"), "utf8"),
    ) as { runtimeVersion: string; files: Array<{ path: string }> };
    const bash = await readFile(join(runtimeRoot, "SL.sh"), "utf8");
    const registry = await slLoadRegistry(root);
    const nested = join(root, "services", "orders");
    await mkdir(nested, { recursive: true });

    expect(manifest.runtimeVersion).toBe("0.2.0");
    expect(manifest.files).toHaveLength(14);
    expect(
      registry.artifacts.filter((artifact) =>
        artifact.path?.startsWith(".github/SL-learning/SL-runtime/"),
      ),
    ).toHaveLength(15);
    expect(
      registry.artifacts
        .filter((artifact) =>
          artifact.path?.startsWith(".github/SL-learning/SL-runtime/"),
        )
        .every(
          (artifact) =>
            artifact.managedBy === "SL-Repo" &&
            artifact.classification === "system",
        ),
    ).toBe(true);
    expect(bash).toContain("exec pwsh");
    expect(bash).not.toMatch(/\b(?:node|npm|npx|sl-repo)\b/);

    const conformance = runPowerShell(
      scriptPath,
      ["--json", "conformance"],
      nested,
    );
    expect(conformance.status, conformance.stderr).toBe(0);
    expect(JSON.parse(conformance.stdout)).toMatchObject({
      command: "conformance",
      repositoryRoot: root,
      result: { conformanceVersion: 1, passed: 30, failed: 0 },
    });

    const doctor = runPowerShell(
      scriptPath,
      ["doctor", "--json", "--dry-run"],
      nested,
    );
    expect(doctor.status, doctor.stderr).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      command: "doctor",
      repositoryRoot: root,
      dryRun: true,
      healthy: true,
    });
  });

  test("keeps dry-run side-effect free", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);

    const changes = await slInstall(root, "init", true);

    expect(
      changes.some(
        (change) =>
          change.path === ".github/SL-learning/SL-runtime/SL.ps1" &&
          change.action === "create",
      ),
    ).toBe(true);
    await expect(
      access(join(root, ".github", "SL-learning", "SL-runtime")),
    ).rejects.toThrow();
  });

  test("rejects local runtime drift and preserves unrelated files", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const runtimeRoot = join(root, ".github", "SL-learning", "SL-runtime");
    const manualPath = join(runtimeRoot, "notes.txt");
    const managedPath = join(runtimeRoot, "SL.Runtime.Core.ps1");
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
    const runtimeRoot = join(root, ".github", "SL-learning", "SL-runtime");
    const manifestPath = join(runtimeRoot, "SL-runtime.manifest.json");
    const managedPath = join(runtimeRoot, "SL.Runtime.Core.ps1");
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
      (file) => file.path === "SL.Runtime.Core.ps1",
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
    ).toBe("0.2.0");
  });

  test("rejects a runtime without its previous manifest", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const runtimeRoot = join(root, ".github", "SL-learning", "SL-runtime");
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(join(runtimeRoot, "SL.ps1"), "manual\n", "utf8");

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
    const runtimeRoot = join(root, ".github", "SL-learning", "SL-runtime");
    const scriptPath = join(runtimeRoot, "SL.ps1");

    await writeFile(
      join(runtimeRoot, "SL-conformance-vectors.json"),
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
      "SL-learning",
      "SL-runtime",
    );
    const missingScriptPath = join(missingRuntimeRoot, "SL.ps1");
    await rm(join(missingRuntimeRoot, "SL-runtime.manifest.json"));
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
      "SL-learning",
      "SL-runtime",
    );
    const mixedManifestPath = join(
      mixedRuntimeRoot,
      "SL-runtime.manifest.json",
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
      join(mixedRuntimeRoot, "SL.ps1"),
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
      "SL-learning",
      "SL-runtime",
      "SL.sh",
    );
    const result = spawnSync("bash", [launcher, "version"], {
      cwd: dirname(launcher),
      encoding: "utf8",
      env: { ...process.env, PATH: resolve(root, "empty-bin") + delimiter },
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain("pwsh was not found");
  });
});
