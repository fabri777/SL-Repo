import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { slExists } from "./SL-utils.js";

export async function slFindPackageRoot(fromUrl: string): Promise<string> {
  let current = dirname(fileURLToPath(fromUrl));
  for (;;) {
    if (await slExists(resolve(current, "package.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate the SL Repo package root.");
    }
    current = parent;
  }
}
