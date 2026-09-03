import { parse, stringify } from "yaml";

export interface SLMarkdown<T extends Record<string, unknown>> {
  frontmatter: T;
  body: string;
}

export function slParseMarkdown<T extends Record<string, unknown>>(
  content: string,
): SLMarkdown<T> {
  const normalized = content.replaceAll("\r\n", "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) {
    throw new Error("Markdown file is missing YAML frontmatter.");
  }

  const frontmatter = parse(match[1] ?? "") as T;
  if (!frontmatter || typeof frontmatter !== "object") {
    throw new Error("Markdown frontmatter must be an object.");
  }
  return { frontmatter, body: match[2] ?? "" };
}

export function slStringifyMarkdown(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const yaml = stringify(frontmatter, {
    lineWidth: 0,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
  }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.trimStart().trimEnd()}\n`;
}
