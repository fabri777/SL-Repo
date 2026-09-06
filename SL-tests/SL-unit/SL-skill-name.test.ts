import { describe, expect, test } from "vitest";
import {
  slIsValidSkillName,
  slSkillFolderName,
  slSkillNameForArtifactId,
} from "../../SL-src/SL-core/SL-skill-name.js";

describe("SL skill names", () => {
  test("derives a deterministic external name without changing the artifact ID", () => {
    const artifactId = "SL-IMMUTABLE-ARTIFACT";

    expect(slSkillNameForArtifactId(artifactId)).toBe(
      "sl-immutable-artifact",
    );
    expect(artifactId).toBe("SL-IMMUTABLE-ARTIFACT");
  });

  test.each([
    "skill",
    "skill-name",
    "sl-skill-name-42",
  ])("accepts lowercase kebab-case name %s", (value) => {
    expect(slIsValidSkillName(value)).toBe(true);
  });

  test.each([
    "SL-UPPERCASE",
    "skill_name",
    "skill name",
    "",
    "-leading",
    "trailing-",
    "repeated--hyphen",
  ])("rejects invalid name %j", (value) => {
    expect(slIsValidSkillName(value)).toBe(false);
  });

  test("preserves an empty folder segment for validation", () => {
    expect(slSkillFolderName(".github/skills//SKILL.md")).toBe("");
  });
});
