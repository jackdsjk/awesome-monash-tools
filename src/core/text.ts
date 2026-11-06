import { parse } from "node-html-parser";

/** Collapse runs of whitespace so scraped text is stable and cheap to diff. */
export function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** HTML (or Ed's XML-ish document markup) to plain text, without a DOM. */
export function htmlToText(html: string): string {
  if (!html) return "";
  if (!html.includes("<")) return compact(html);
  try {
    return compact(parse(html).text);
  } catch {
    return compact(html.replace(/<[^>]*>/g, " "));
  }
}

/** First `limit` characters of a text, with a breadcrumb that it was cut. */
export function excerpt(value: string, limit = 240): string {
  const text = compact(value);
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}
