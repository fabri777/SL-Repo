import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function slCreateTestRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "SL-Repo-"));
  await mkdir(join(root, ".git"));
  return root;
}

export async function slRemoveTestRepository(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
