import { describe, expect, test } from "vitest";
import {
  slAgeDays,
  slCanonicalJson,
  slCompareOrdinal,
  slResolveInside,
  slSlugify,
} from "../../SL-src/SL-core/SL-utils.js";

describe("SL utilities", () => {
  test("creates stable lowercase slugs", () => {
    expect(slSlugify("SQLite busy_timeout / command timeout")).toBe(
      "sqlite-busy-timeout-command-timeout",
    );
  });

  test("rejects paths outside the repository", () => {
    expect(() => slResolveInside("repository", "../secret.txt")).toThrow(
      "Path escapes repository root",
    );
  });

  test("uses whole UTC days for retention", () => {
    expect(
      slAgeDays(
        new Date("2026-04-02T00:00:00.000Z"),
        "2026-01-01T00:00:00.000Z",
      ),
    ).toBe(91);
  });

  test("orders Unicode strings by locale-independent UTF-16 code units", () => {
    expect(
      ["é", "a", "😀", "Z"].sort(slCompareOrdinal),
    ).toEqual(["Z", "a", "é", "😀"]);
  });

  test("canonicalizes Unicode object keys in ordinal order", () => {
    expect(
      slCanonicalJson({
        "é": 1,
        a: 2,
        "😀": 3,
        Z: 4,
      }),
    ).toBe('{"Z":4,"a":2,"é":1,"😀":3}');
  });
});
