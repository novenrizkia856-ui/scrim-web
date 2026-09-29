// Copy rules check for every string a visitor can read.
//   1. No hyphen, en dash or em dash.
//   2. No sentence longer than 15 words.
// Scans the HTML pages (text, aria labels, alt, titles, placeholders, meta),
// prose string literals in js/ (toasts, states, labels) and the visible text
// fields of the preview data.
// Usage: node tools/check-copy.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_WORDS = 15;
const DASHES = /[-‐‑‒–—―−]/;

const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&copy;/g, "©").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const strings = [];
const add = (source, text) => {
  const clean = decode(String(text)).replace(/\s+/g, " ").trim();
  if (clean) strings.push({ source, text: clean });
};

// ---- HTML pages
for (const file of readdirSync(root).filter((f) => f.endsWith(".html"))) {
  let html = readFileSync(join(root, file), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  for (const m of html.matchAll(/<meta[^>]+(?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)"[^>]*content="([^"]*)"/g)) add(`${file} meta`, m[1]);
  for (const m of html.matchAll(/<title>([\s\S]*?)<\/title>/g)) add(`${file} title`, m[1]);
  for (const m of html.matchAll(/\s(?:aria-label|alt|title|placeholder)="([^"]*)"/g)) add(`${file} attribute`, m[1]);
  const body = html.replace(/<head>[\s\S]*?<\/head>/, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "");
  const text = body.replace(/<(\/?)(p|h[1-6]|li|a|button|span|div|section|header|footer|nav|label|option|main|form|select|strong)\b[^>]*>/g, "\n").replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, " ");
  for (const line of text.split("\n")) add(`${file} text`, line);
}

// ---- JS prose strings: literals with a space and a capital letter or end punctuation,
// and nothing that looks like markup, selectors or code.
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (/[\\/](vendor|webflow)$/.test(p)) return []; // third party code, not visible copy
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
}
for (const file of walk(join(root, "js"))) {
  const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    const s = m[1];
    if (!/ /.test(s) || /[<>=;{}]|__|https?:|\\u|\$\{/.test(s)) continue;
    if (/^M[\d.]/.test(s)) continue; // SVG path data
    if (!/[A-Z]/.test(s) && !/[.!?]$/.test(s)) continue; // class lists and selectors are lowercase
    if (/^[a-z0-9_.-]+( [a-z0-9_.-]+)*$/.test(s)) continue;
    add(relative(root, file) + " string", s);
  }
}

// ---- preview data text
const data = JSON.parse(readFileSync(join(root, "data", "preview.json"), "utf8"));
const VISIBLE = new Set(["label", "application", "issuer", "reference", "detail", "note", "name", "symbol", "ref"]);
(function scan(node, path) {
  if (Array.isArray(node)) return node.forEach((n, i) => scan(n, path + "[" + i + "]"));
  if (node && typeof node === "object") return Object.entries(node).forEach(([k, v]) => (typeof v === "string" && VISIBLE.has(k) ? add("data " + path + "." + k, v) : scan(v, path + "." + k)));
})(data, "");

// ---- checks
const problems = [];
for (const { source, text } of strings) {
  if (DASHES.test(text)) problems.push(`[dash] ${source}: "${text}"`);
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    if (words.length > MAX_WORDS) problems.push(`[long ${words.length} words] ${source}: "${sentence}"`);
  }
}
console.log(`Checked ${strings.length} visible strings.`);
if (problems.length) {
  console.error([...new Set(problems)].join("\n"));
  process.exit(1);
}
console.log("Copy rules pass: no dashes, no sentence over 15 words.");
