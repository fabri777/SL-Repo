import { createHash } from "node:crypto";
import type {
  SLRuntimeConformanceVector,
  SLRuntimeManifest,
} from "../SL-core/SL-types.js";
import {
  SL_RUNTIME_PAYLOAD_FILES,
  SL_SECRET_PATTERNS,
  SL_USER_PATH_PATTERN,
} from "../SL-core/SL-constants.js";
import {
  slCanonicalJson,
  slCompareOrdinal,
  slSlugify,
} from "../SL-core/SL-utils.js";

export const SL_RUNTIME_EXIT_CODES = {
  success: 0,
  usage: 2,
  powerShellVersion: 3,
  repositoryRoot: 4,
  manifest: 5,
  integrity: 6,
  mixedVersion: 7,
  validation: 8,
  io: 9,
  internal: 10,
} as const;

export class SLRuntimeContractError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SLRuntimeContractError";
  }
}

interface SLYamlLine {
  indent: number;
  content: string;
  lineNumber: number;
}

interface SLYamlParseResult {
  value: unknown;
  nextIndex: number;
}

function slContractError(code: string, message: string): never {
  throw new SLRuntimeContractError(code, message);
}

function slRuntimeJsonString(value: string): string {
  return JSON.stringify(value);
}

export function slRuntimeCanonicalJson(value: unknown): string {
  function serialize(entry: unknown): string {
    if (entry === null) {
      return "null";
    }
    if (typeof entry === "string") {
      return slRuntimeJsonString(entry);
    }
    if (typeof entry === "boolean") {
      return entry ? "true" : "false";
    }
    if (typeof entry === "number") {
      if (!Number.isSafeInteger(entry)) {
        return slContractError(
          "canonical-json-number",
          "Canonical JSON supports safe integers only.",
        );
      }
      return Object.is(entry, -0) ? "0" : String(entry);
    }
    if (Array.isArray(entry)) {
      return `[${entry.map(serialize).join(",")}]`;
    }
    if (typeof entry === "object") {
      const objectValue = entry as Record<string, unknown>;
      return `{${Object.keys(objectValue)
        .sort(slCompareOrdinal)
        .map(
          (key) =>
            `${slRuntimeJsonString(key)}:${serialize(objectValue[key])}`,
        )
        .join(",")}}`;
    }
    return slContractError(
      "canonical-json-type",
      `Canonical JSON does not support ${typeof entry}.`,
    );
  }

  return serialize(value);
}

export function slRuntimeSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function slNormalizeRuntimePath(value: string): string {
  if (value.includes("\0")) {
    return slContractError("path-nul", "Paths cannot contain NUL.");
  }
  let normalized = value.trim().replaceAll("\\", "/").replace(/\/+/g, "/");
  if (/^[A-Za-z]:/.test(normalized) || normalized.startsWith("/")) {
    return slContractError(
      "path-absolute",
      `Path must be repository-relative: ${value}`,
    );
  }
  normalized = normalized.replace(/^\.\/+/, "").replace(/\/+$/, "");
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return slContractError(
          "path-escape",
          `Path escapes repository root: ${value}`,
        );
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/") || ".";
}

function slParseDoubleQuoted(value: string, lineNumber: number): string {
  if (!/^"(?:[^"\\\r\n]|\\["\\nrt])*"$/.test(value)) {
    return slContractError(
      "yaml-string",
      `Unsupported double-quoted string at line ${lineNumber}.`,
    );
  }
  return JSON.parse(value) as string;
}

function slParseSingleQuoted(value: string, lineNumber: number): string {
  if (!/^'(?:[^'\r\n]|'')*'$/.test(value)) {
    return slContractError(
      "yaml-string",
      `Unsupported single-quoted string at line ${lineNumber}.`,
    );
  }
  return value.slice(1, -1).replaceAll("''", "'");
}

function slSplitInlineList(value: string, lineNumber: number): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote === '"') {
      current += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (quote === "'") {
      current += character;
      if (character === quote) {
        if (value[index + 1] === "'") {
          current += value[index + 1];
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
    } else if (character === ",") {
      if (!current.trim()) {
        return slContractError(
          "yaml-list",
          `Empty inline-list item at line ${lineNumber}.`,
        );
      }
      result.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (quote) {
    return slContractError(
      "yaml-string",
      `Unterminated quoted string at line ${lineNumber}.`,
    );
  }
  if (current.trim()) {
    result.push(current.trim());
  } else if (value.trim()) {
    return slContractError(
      "yaml-list",
      `Empty inline-list item at line ${lineNumber}.`,
    );
  }
  return result;
}

function slParseYamlScalar(value: string, lineNumber: number): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return slContractError(
      "yaml-value",
      `Missing YAML value at line ${lineNumber}.`,
    );
  }
  if (trimmed === "[]") {
    return [];
  }
  if (trimmed === "{}") {
    return {};
  }
  if (trimmed.startsWith("[") || trimmed.endsWith("]")) {
    if (!(trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      return slContractError(
        "yaml-list",
        `Malformed inline list at line ${lineNumber}.`,
      );
    }
    const inner = trimmed.slice(1, -1).trim();
    return inner
      ? slSplitInlineList(inner, lineNumber).map((entry) =>
          slParseYamlScalar(entry, lineNumber),
        )
      : [];
  }
  if (trimmed.startsWith('"')) {
    return slParseDoubleQuoted(trimmed, lineNumber);
  }
  if (trimmed.startsWith("'")) {
    return slParseSingleQuoted(trimmed, lineNumber);
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (/^-?(?:0|[1-9][0-9]*)$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed)) {
      return slContractError(
        "yaml-integer",
        `YAML integer is outside the safe range at line ${lineNumber}.`,
      );
    }
    return Object.is(parsed, -0) ? 0 : parsed;
  }
  if (
    /^[&*!>|%@`]/.test(trimmed) ||
    /^(?:yes|no|on|off|~)$/i.test(trimmed) ||
    /:\s/.test(trimmed) ||
    /\s#/.test(trimmed)
  ) {
    return slContractError(
      "yaml-syntax",
      `Unsupported YAML syntax at line ${lineNumber}.`,
    );
  }
  return trimmed;
}

function slParseYamlKey(
  content: string,
  lineNumber: number,
): { key: string; valueText: string } {
  const match = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(content);
  if (!match) {
    return slContractError(
      "yaml-key",
      `Invalid YAML mapping key at line ${lineNumber}.`,
    );
  }
  const suffix = match[2] ?? "";
  if (suffix && !suffix.startsWith(" ")) {
    return slContractError(
      "yaml-spacing",
      `A YAML mapping colon must be followed by a space at line ${lineNumber}.`,
    );
  }
  return { key: match[1]!, valueText: suffix.trimStart() };
}

function slParseYamlMapping(
  lines: SLYamlLine[],
  startIndex: number,
  indent: number,
): SLYamlParseResult {
  const value: Record<string, unknown> = {};
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      return slContractError(
        "yaml-indent",
        `Unexpected indentation at line ${line.lineNumber}.`,
      );
    }
    if (line.content.startsWith("-")) {
      break;
    }
    const entry = slParseYamlKey(line.content, line.lineNumber);
    if (Object.hasOwn(value, entry.key)) {
      return slContractError(
        "yaml-duplicate-key",
        `Duplicate YAML key '${entry.key}' at line ${line.lineNumber}.`,
      );
    }
    index += 1;
    if (entry.valueText) {
      value[entry.key] = slParseYamlScalar(entry.valueText, line.lineNumber);
      continue;
    }
    const child = lines[index];
    if (!child || child.indent <= indent) {
      return slContractError(
        "yaml-value",
        `Missing nested YAML value for '${entry.key}' at line ${line.lineNumber}.`,
      );
    }
    if (child.indent !== indent + 2) {
      return slContractError(
        "yaml-indent",
        `Nested YAML must use two-space indentation at line ${child.lineNumber}.`,
      );
    }
    const nested = slParseYamlBlock(lines, index, indent + 2);
    value[entry.key] = nested.value;
    index = nested.nextIndex;
  }
  return { value, nextIndex: index };
}

function slParseYamlSequence(
  lines: SLYamlLine[],
  startIndex: number,
  indent: number,
): SLYamlParseResult {
  const value: unknown[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) {
      break;
    }
    if (line.indent !== indent || !line.content.startsWith("-")) {
      break;
    }
    if (line.content !== "-" && !line.content.startsWith("- ")) {
      return slContractError(
        "yaml-sequence",
        `A YAML sequence marker must be followed by a space at line ${line.lineNumber}.`,
      );
    }
    const itemText = line.content.slice(1).trimStart();
    index += 1;
    if (!itemText) {
      const child = lines[index];
      if (!child || child.indent !== indent + 2) {
        return slContractError(
          "yaml-indent",
          `Nested YAML sequence values must use two-space indentation at line ${line.lineNumber}.`,
        );
      }
      const nested = slParseYamlBlock(lines, index, indent + 2);
      value.push(nested.value);
      index = nested.nextIndex;
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(itemText)) {
      const first = slParseYamlKey(itemText, line.lineNumber);
      const objectValue: Record<string, unknown> = {};
      if (first.valueText) {
        objectValue[first.key] = slParseYamlScalar(
          first.valueText,
          line.lineNumber,
        );
      } else {
        const child = lines[index];
        if (!child || child.indent !== indent + 2) {
          return slContractError(
            "yaml-indent",
            `Nested YAML values must use two-space indentation at line ${line.lineNumber}.`,
          );
        }
        const nested = slParseYamlBlock(lines, index, indent + 2);
        objectValue[first.key] = nested.value;
        index = nested.nextIndex;
      }
      if (
        index < lines.length &&
        lines[index]!.indent === indent + 2 &&
        !lines[index]!.content.startsWith("-")
      ) {
        const continuation = slParseYamlMapping(lines, index, indent + 2);
        for (const [key, child] of Object.entries(
          continuation.value as Record<string, unknown>,
        )) {
          if (Object.hasOwn(objectValue, key)) {
            return slContractError(
              "yaml-duplicate-key",
              `Duplicate YAML key '${key}' at line ${lines[index]!.lineNumber}.`,
            );
          }
          objectValue[key] = child;
        }
        index = continuation.nextIndex;
      }
      value.push(objectValue);
      continue;
    }
    value.push(slParseYamlScalar(itemText, line.lineNumber));
  }
  return { value, nextIndex: index };
}

function slParseYamlBlock(
  lines: SLYamlLine[],
  startIndex: number,
  indent: number,
): SLYamlParseResult {
  const first = lines[startIndex];
  if (!first || first.indent !== indent) {
    return slContractError(
      "yaml-indent",
      `Invalid YAML indentation at line ${first?.lineNumber ?? 1}.`,
    );
  }
  return first.content.startsWith("-")
    ? slParseYamlSequence(lines, startIndex, indent)
    : slParseYamlMapping(lines, startIndex, indent);
}

export function slParseRuntimeYaml(content: string): unknown {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalized.includes("\t")) {
    return slContractError("yaml-tab", "YAML tabs are not supported.");
  }
  const lines = normalized
    .split("\n")
    .map((line, index) => ({
      indent: line.length - line.trimStart().length,
      content: line.trimStart(),
      lineNumber: index + 1,
    }))
    .filter((line) => line.content && !line.content.startsWith("#"));
  if (lines.length === 0) {
    return slContractError("yaml-empty", "YAML content cannot be empty.");
  }
  for (const line of lines) {
    if (line.indent % 2 !== 0) {
      return slContractError(
        "yaml-indent",
        `YAML indentation must use multiples of two spaces at line ${line.lineNumber}.`,
      );
    }
    if (line.content === "---" || line.content === "...") {
      return slContractError(
        "yaml-document",
        `YAML document markers are not supported at line ${line.lineNumber}.`,
      );
    }
  }
  if (lines[0]!.indent !== 0) {
    return slContractError(
      "yaml-indent",
      "The YAML document must start at indentation zero.",
    );
  }
  const parsed = slParseYamlBlock(lines, 0, 0);
  if (parsed.nextIndex !== lines.length) {
    return slContractError(
      "yaml-structure",
      `Unexpected YAML content at line ${lines[parsed.nextIndex]!.lineNumber}.`,
    );
  }
  if (
    parsed.value === null ||
    Array.isArray(parsed.value) ||
    typeof parsed.value !== "object"
  ) {
    return slContractError(
      "yaml-root",
      "The YAML document root must be a mapping.",
    );
  }
  return parsed.value;
}

export function slParseRuntimeFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    return slContractError(
      "frontmatter-open",
      "Markdown must start with a YAML frontmatter delimiter.",
    );
  }
  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex < 0) {
    return slContractError(
      "frontmatter-close",
      "Markdown frontmatter is missing its closing delimiter.",
    );
  }
  const parsed = slParseRuntimeYaml(lines.slice(1, closingIndex).join("\n"));
  return {
    frontmatter: parsed as Record<string, unknown>,
    body: lines.slice(closingIndex + 1).join("\n"),
  };
}

function slRuntimeValuesEqual(left: unknown, right: unknown): boolean {
  return slRuntimeCanonicalJson(left) === slRuntimeCanonicalJson(right);
}

function slRuntimePattern(pattern: string, path: string): RegExp {
  if (/\(\?/.test(pattern) || /\\(?:[1-9k]|[pP]\{)/.test(pattern)) {
    return slContractError(
      "validation-pattern-contract",
      `pattern uses syntax outside the cross-runtime subset at ${path}.`,
    );
  }
  try {
    return new RegExp(pattern, "u");
  } catch {
    return slContractError(
      "validation-contract",
      `pattern is invalid at ${path}.`,
    );
  }
}

export function slValidateRuntimeValue(
  value: unknown,
  contractValue: unknown,
  path = "$",
): void {
  const contract = slRequireObject(contractValue, "validation-contract");
  const supportedKeywords = new Set([
    "additionalProperties",
    "const",
    "enum",
    "items",
    "minItems",
    "minLength",
    "minimum",
    "pattern",
    "properties",
    "required",
    "type",
  ]);
  for (const keyword of Object.keys(contract)) {
    if (!supportedKeywords.has(keyword)) {
      return slContractError(
        "validation-keyword",
        `Unsupported validation keyword '${keyword}' at ${path}.`,
      );
    }
  }
  if (typeof contract.type !== "string") {
    return slContractError(
      "validation-contract",
      `Validation contract type is required at ${path}.`,
    );
  }
  const validType = (() => {
    switch (contract.type) {
      case "object":
        return value !== null && typeof value === "object" && !Array.isArray(value);
      case "array":
        return Array.isArray(value);
      case "string":
        return typeof value === "string";
      case "integer":
        return typeof value === "number" && Number.isSafeInteger(value);
      case "boolean":
        return typeof value === "boolean";
      case "null":
        return value === null;
      default:
        return slContractError(
          "validation-type-contract",
          `Unsupported validation type '${contract.type}' at ${path}.`,
        );
    }
  })();
  if (!validType) {
    return slContractError(
      "validation-type",
      `Expected ${contract.type} at ${path}.`,
    );
  }
  if (Object.hasOwn(contract, "const") && !slRuntimeValuesEqual(value, contract.const)) {
    return slContractError(
      "validation-const",
      `Value does not match const at ${path}.`,
    );
  }
  if (Object.hasOwn(contract, "enum")) {
    if (
      !Array.isArray(contract.enum) ||
      !contract.enum.some((candidate) => slRuntimeValuesEqual(value, candidate))
    ) {
      return slContractError(
        "validation-enum",
        `Value is not in enum at ${path}.`,
      );
    }
  }
  if (typeof value === "string") {
    if (
      Object.hasOwn(contract, "minLength") &&
      (!Number.isSafeInteger(contract.minLength) ||
        (contract.minLength as number) < 0 ||
        value.length < (contract.minLength as number))
    ) {
      return slContractError(
        "validation-min-length",
        `String is shorter than minLength at ${path}.`,
      );
    }
    if (Object.hasOwn(contract, "pattern")) {
      if (typeof contract.pattern !== "string") {
        return slContractError(
          "validation-contract",
          `pattern must be a string at ${path}.`,
        );
      }
      const expression = slRuntimePattern(contract.pattern, path);
      if (!expression.test(value)) {
        return slContractError(
          "validation-pattern",
          `String does not match pattern at ${path}.`,
        );
      }
    }
  }
  if (typeof value === "number" && Object.hasOwn(contract, "minimum")) {
    if (
      typeof contract.minimum !== "number" ||
      !Number.isSafeInteger(contract.minimum)
    ) {
      return slContractError(
        "validation-contract",
        `minimum must be a safe integer at ${path}.`,
      );
    }
    if (value < contract.minimum) {
      return slContractError(
        "validation-minimum",
        `Integer is below minimum at ${path}.`,
      );
    }
  }
  if (Array.isArray(value)) {
    if (Object.hasOwn(contract, "minItems")) {
      if (
        !Number.isSafeInteger(contract.minItems) ||
        (contract.minItems as number) < 0
      ) {
        return slContractError(
          "validation-contract",
          `minItems must be a non-negative integer at ${path}.`,
        );
      }
      if (value.length < (contract.minItems as number)) {
        return slContractError(
          "validation-min-items",
          `Array is shorter than minItems at ${path}.`,
        );
      }
    }
    if (Object.hasOwn(contract, "items")) {
      value.forEach((entry, index) =>
        slValidateRuntimeValue(entry, contract.items, `${path}[${index}]`),
      );
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>;
    const required = Object.hasOwn(contract, "required")
      ? contract.required
      : [];
    if (
      !Array.isArray(required) ||
      required.some((entry) => typeof entry !== "string")
    ) {
      return slContractError(
        "validation-contract",
        `required must be an array of strings at ${path}.`,
      );
    }
    for (const name of required as string[]) {
      if (!Object.hasOwn(objectValue, name)) {
        return slContractError(
          "validation-required",
          `Missing required property '${name}' at ${path}.`,
        );
      }
    }
    const properties = Object.hasOwn(contract, "properties")
      ? slRequireObject(contract.properties, "validation-contract")
      : {};
    for (const [name, child] of Object.entries(properties)) {
      if (Object.hasOwn(objectValue, name)) {
        slValidateRuntimeValue(objectValue[name], child, `${path}.${name}`);
      }
    }
    if (contract.additionalProperties === false) {
      for (const name of Object.keys(objectValue)) {
        if (!Object.hasOwn(properties, name)) {
          return slContractError(
            "validation-additional-property",
            `Unexpected property '${name}' at ${path}.`,
          );
        }
      }
    } else if (
      Object.hasOwn(contract, "additionalProperties") &&
      contract.additionalProperties !== true
    ) {
      return slContractError(
        "validation-contract",
        `additionalProperties must be a boolean at ${path}.`,
      );
    }
  }
}

function slEscapeRegexCharacter(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character)
    ? `\\${character}`
    : character;
}

export function slNormalizeRuntimeGlob(pattern: string): string {
  const normalized = pattern.trim().replaceAll("\\", "/").replace(/\/+/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.startsWith("!") ||
    normalized.startsWith("#") ||
    normalized.endsWith("/") ||
    normalized.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    return slContractError(
      "glob-path",
      `Glob must be a normalized repository-relative pattern: ${pattern}`,
    );
  }
  if (
    /[\[\]{}()|+@]/.test(normalized) ||
    normalized.includes("***") ||
    normalized.includes("\\")
  ) {
    return slContractError(
      "glob-syntax",
      `Unsupported glob syntax: ${pattern}`,
    );
  }
  return normalized;
}

export function slRuntimeGlobMatch(pattern: string, pathValue: string): boolean {
  const normalizedPattern = slNormalizeRuntimeGlob(pattern);
  const normalizedPath = slNormalizeRuntimePath(pathValue);
  if (normalizedPath === ".") {
    return normalizedPattern === "**";
  }
  let expression = "^";
  let index = 0;
  const trailingGlobstar = normalizedPattern.endsWith("/**");
  const scanLimit = trailingGlobstar
    ? normalizedPattern.length - 3
    : normalizedPattern.length;
  while (index < scanLimit) {
    if (normalizedPattern.startsWith("**/", index)) {
      expression += "(?:.*/)?";
      index += 3;
      continue;
    }
    const character = normalizedPattern[index]!;
    if (character === "*") {
      if (normalizedPattern[index + 1] === "*") {
        expression += ".*";
        index += 2;
      } else {
        expression += "[^/]*";
        index += 1;
      }
    } else if (character === "?") {
      expression += "[^/]";
      index += 1;
    } else {
      expression += slEscapeRegexCharacter(character);
      index += 1;
    }
  }
  if (trailingGlobstar) {
    expression += "(?:/.*)?";
  }
  expression += "$";
  return new RegExp(expression, "u").test(normalizedPath);
}

function slRequireObject(
  value: unknown,
  code: string,
): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return slContractError(code, "Expected an object.");
  }
  return value as Record<string, unknown>;
}

export function slValidateRuntimeManifest(
  value: unknown,
): asserts value is SLRuntimeManifest {
  const manifest = slRequireObject(value, "manifest-type");
  const expectedKeys = [
    "configContractVersion",
    "conformanceVersion",
    "files",
    "minimumPowerShellVersion",
    "runtimeVersion",
    "schemaVersion",
    "sourceReleaseCommit",
  ];
  const actualKeys = Object.keys(manifest).sort(slCompareOrdinal);
  if (slCanonicalJson(actualKeys) !== slCanonicalJson(expectedKeys)) {
    return slContractError(
      "manifest-properties",
      "Runtime manifest properties do not match the contract.",
    );
  }
  if (manifest.schemaVersion !== 1) {
    return slContractError(
      "manifest-schema-version",
      "Unsupported runtime manifest schemaVersion.",
    );
  }
  if (
    typeof manifest.runtimeVersion !== "string" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.runtimeVersion)
  ) {
    return slContractError(
      "manifest-runtime-version",
      "runtimeVersion must be a semantic version.",
    );
  }
  if (
    typeof manifest.sourceReleaseCommit !== "string" ||
    !/^(?:[0-9a-f]{40}|__SL_SOURCE_RELEASE_COMMIT__)$/.test(
      manifest.sourceReleaseCommit,
    )
  ) {
    return slContractError(
      "manifest-source-release",
      "sourceReleaseCommit must be a full commit or the staging placeholder.",
    );
  }
  if (
    !Number.isSafeInteger(manifest.configContractVersion) ||
    (manifest.configContractVersion as number) < 1 ||
    !Number.isSafeInteger(manifest.conformanceVersion) ||
    (manifest.conformanceVersion as number) < 1
  ) {
    return slContractError(
      "manifest-contract-version",
      "Manifest contract versions must be positive integers.",
    );
  }
  if (manifest.minimumPowerShellVersion !== "7.0.0") {
    return slContractError(
      "manifest-powershell-version",
      "minimumPowerShellVersion must be 7.0.0.",
    );
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    return slContractError(
      "manifest-files",
      "Runtime manifest files must be a non-empty array.",
    );
  }
  const seen = new Set<string>();
  let previous = "";
  for (const fileValue of manifest.files) {
    const file = slRequireObject(fileValue, "manifest-file-type");
    if (
      Object.keys(file).sort(slCompareOrdinal).join(",") !== "path,sha256" ||
      typeof file.path !== "string" ||
      typeof file.sha256 !== "string"
    ) {
      return slContractError(
        "manifest-file",
        "Each runtime manifest file requires only path and sha256 strings.",
      );
    }
    const normalizedPath = slNormalizeRuntimePath(file.path);
    if (
      normalizedPath !== file.path ||
      file.path === "SL-runtime.manifest.json"
    ) {
      return slContractError(
        "manifest-file-path",
        `Invalid runtime manifest path: ${file.path}`,
      );
    }
    if (!/^[0-9a-f]{64}$/.test(file.sha256)) {
      return slContractError(
        "manifest-file-hash",
        `Invalid SHA-256 for runtime file: ${file.path}`,
      );
    }
    if (seen.has(file.path) || (previous && previous >= file.path)) {
      return slContractError(
        "manifest-file-order",
        "Runtime manifest files must be unique and ordinally sorted.",
      );
    }
    seen.add(file.path);
    previous = file.path;
  }
  if (
    slCanonicalJson([...seen]) !== slCanonicalJson(SL_RUNTIME_PAYLOAD_FILES)
  ) {
    return slContractError(
      "manifest-files",
      "Runtime manifest payload inventory does not match the contract.",
    );
  }
}

export function slRunRuntimeVector(
  vector: SLRuntimeConformanceVector,
): unknown {
  switch (vector.operation) {
    case "canonical-json":
      return slRuntimeCanonicalJson(vector.input);
    case "sha256":
      if (typeof vector.input !== "string") {
        return slContractError("vector-input", "sha256 input must be a string.");
      }
      return slRuntimeSha256(vector.input);
    case "normalize-path":
      if (typeof vector.input !== "string") {
        return slContractError(
          "vector-input",
          "normalize-path input must be a string.",
        );
      }
      return slNormalizeRuntimePath(vector.input);
    case "parse-yaml":
      if (typeof vector.input !== "string") {
        return slContractError(
          "vector-input",
          "parse-yaml input must be a string.",
        );
      }
      return slParseRuntimeYaml(vector.input);
    case "parse-frontmatter":
      if (typeof vector.input !== "string") {
        return slContractError(
          "vector-input",
          "parse-frontmatter input must be a string.",
        );
      }
      return slParseRuntimeFrontmatter(vector.input);
    case "validate-value": {
      const input = slRequireObject(vector.input, "vector-input");
      if (!Object.hasOwn(input, "value") || !Object.hasOwn(input, "contract")) {
        return slContractError(
          "vector-input",
          "validate-value input requires value and contract.",
        );
      }
      slValidateRuntimeValue(input.value, input.contract);
      return true;
    }
    case "glob-match": {
      const input = slRequireObject(vector.input, "vector-input");
      if (typeof input.pattern !== "string" || typeof input.path !== "string") {
        return slContractError(
          "vector-input",
          "glob-match input requires pattern and path strings.",
        );
      }
      return slRuntimeGlobMatch(input.pattern, input.path);
    }
    case "slugify":
      if (typeof vector.input !== "string") {
        return slContractError("vector-input", "slugify input must be a string.");
      }
      return slSlugify(vector.input);
    case "scope-shard": {
      const input = slRequireObject(vector.input, "vector-input");
      if (typeof input.id !== "string" || typeof input.path !== "string") {
        return slContractError(
          "vector-input",
          "scope-shard input requires id and path strings.",
        );
      }
      const key = `${input.id}\0${slNormalizeRuntimePath(input.path)}`;
      const slug =
        slSlugify(
          slNormalizeRuntimePath(input.path) === "."
            ? input.id
            : `${input.id}-${slNormalizeRuntimePath(input.path)}`,
        ).slice(0, 40) || "scope";
      return `SL-${slug}-${slRuntimeSha256(key).slice(0, 12)}`;
    }
    case "usage-event-id":
      if (typeof vector.input !== "string" || vector.input.trim().length === 0) {
        return slContractError(
          "vector-input",
          "usage-event-id input must be a non-empty string.",
        );
      }
      return `SL-USE-${slRuntimeSha256(vector.input.trim())
        .slice(0, 32)
        .toUpperCase()}`;
    case "lifecycle-event-id": {
      const input = slRequireObject(vector.input, "vector-input");
      return `SL-EVENT-${slRuntimeSha256(JSON.stringify(input))
        .slice(0, 32)
        .toUpperCase()}`;
    }
    case "retention-deadline": {
      const input = slRequireObject(vector.input, "vector-input");
      if (
        typeof input.timestamp !== "string" ||
        typeof input.days !== "number" ||
        !Number.isSafeInteger(input.days)
      ) {
        return slContractError(
          "vector-input",
          "retention-deadline requires timestamp and integer days.",
        );
      }
      const timestamp = new Date(input.timestamp);
      if (Number.isNaN(timestamp.getTime())) {
        return slContractError(
          "vector-input",
          "retention-deadline timestamp is invalid.",
        );
      }
      return new Date(timestamp.getTime() + input.days * 86_400_000).toISOString();
    }
    case "promotion-owner-set": {
      const input = slRequireObject(vector.input, "vector-input");
      if (
        !Array.isArray(input.ownerAliases) ||
        input.ownerAliases.some((value) => typeof value !== "string")
      ) {
        return slContractError(
          "vector-input",
          "promotion-owner-set requires ownerAliases strings.",
        );
      }
      return `SL-OWNERS-${slRuntimeSha256(
        JSON.stringify([...input.ownerAliases].sort(slCompareOrdinal)),
      )
        .slice(0, 16)
        .toUpperCase()}`;
    }
    case "safe-reference": {
      if (typeof vector.input !== "string") {
        return slContractError(
          "vector-input",
          "safe-reference input must be a string.",
        );
      }
      const reference = vector.input;
      return /^(?:[A-Za-z][A-Za-z0-9+.-]*:[^\s@\\]{1,240}|[A-Za-z0-9][A-Za-z0-9._/#:-]{0,255})$/.test(
        reference,
      ) &&
        !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(reference) &&
        !/(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?:$|[^0-9])|(?:^|[^A-F0-9])(?:[A-F0-9]{0,4}:){2,7}[A-F0-9]{0,4}(?:$|[^A-F0-9])/i.test(
          reference,
        ) &&
        !SL_USER_PATH_PATTERN.test(reference) &&
        !SL_SECRET_PATTERNS.some(({ pattern }) => pattern.test(reference));
    }
    case "resource-receipt-id":
      if (typeof vector.input !== "string" || vector.input.trim().length === 0) {
        return slContractError(
          "vector-input",
          "resource-receipt-id input must be a non-empty string.",
        );
      }
      return `SL-RESOURCE-${slRuntimeSha256(vector.input.trim())
        .slice(0, 32)
        .toUpperCase()}`;
    case "resource-total-tokens": {
      const input = slRequireObject(vector.input, "vector-input");
      const names = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
      let total = 0;
      for (const name of names) {
        const value = input[name] ?? 0;
        if (
          typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 0
        ) {
          return slContractError(
            "vector-input",
            "resource-total-tokens values must be non-negative safe integers.",
          );
        }
        total += value;
      }
      return total;
    }
    case "resource-cost-add": {
      const input = slRequireObject(vector.input, "vector-input");
      if (
        typeof input.left !== "string" ||
        typeof input.right !== "string" ||
        !/^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$/.test(input.left) ||
        !/^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$/.test(input.right)
      ) {
        return slContractError(
          "vector-input",
          "resource-cost-add requires decimal strings.",
        );
      }
      const scaled = (value: string): bigint => {
        const [whole, fraction = ""] = value.split(".");
        return BigInt(`${whole}${fraction.padEnd(12, "0")}`);
      };
      const total = scaled(input.left) + scaled(input.right);
      const digits = total.toString().padStart(13, "0");
      const whole = digits.slice(0, -12);
      const fraction = digits.slice(-12).replace(/0+$/, "");
      return fraction ? `${whole}.${fraction}` : whole;
    }
  }
}
