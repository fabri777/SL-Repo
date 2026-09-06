export const SL_SKILL_NAME_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slSkillNameForArtifactId(artifactId: string): string {
  return artifactId.toLowerCase();
}

export function slSkillFolderName(artifactPath: string): string {
  return artifactPath.split("/").at(-2) ?? "";
}

export function slIsValidSkillName(value: unknown): value is string {
  return typeof value === "string" && SL_SKILL_NAME_PATTERN.test(value);
}
