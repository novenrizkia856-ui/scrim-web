import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { TOKEN_ADDRESS, CONTRACTS, CHAIN, APP_CONFIG } from "../js/config.js";
import { tokenAddress } from "../js/token.js";

const root = fileURLToPath(new URL("..", import.meta.url));
function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (/node_modules|[\\/]work$|[\\/]\.git$|[\\/]vendor$|[\\/]webflow$|[\\/]assets$/.test(p)) return [];
    return statSync(p).isDirectory() ? files(p) : /\.(html|js|mjs|json)$/.test(p) ? [p] : [];
  });
}
const sources = files(root).filter((p) => !/[\\/]test[\\/]/.test(p)).map((p) => ({ path: relative(root, p), text: readFileSync(p, "utf8") }));

test("TOKEN_ADDRESS is declared exactly once, in js/config.js", () => {
  const hits = sources.filter((s) => /\bconst\s+TOKEN_ADDRESS\b/.test(s.text)).map((s) => s.path);
  assert.deepEqual(hits, [join("js", "config.js")]);
  const line = readFileSync(join(root, "js", "config.js"), "utf8").split("\n");
  const i = line.findIndex((l) => /export const TOKEN_ADDRESS/.test(l));
  assert.match(line[i - 1], /TOKEN CA .* CHANGE ONLY THIS LINE WHEN TOKEN LAUNCHES/);
});

test("the shipped token address is empty until launch", () => {
  assert.equal(TOKEN_ADDRESS, "");
  assert.equal(tokenAddress(TOKEN_ADDRESS), null);
});

test("empty, null and blank values mean coming soon; anything else shows as is", () => {
  for (const v of ["", "   ", null, undefined]) assert.equal(tokenAddress(v), null);
  assert.equal(tokenAddress("0xAbC123"), "0xAbC123");
  assert.equal(tokenAddress("  0xAbC123 "), "0xAbC123");
  assert.equal(tokenAddress("not an address yet"), "not an address yet");
});

test("no page hardcodes a token or contract address", () => {
  for (const s of sources.filter((x) => x.path.endsWith(".html"))) {
    assert.doesNotMatch(s.text, /0x[0-9a-fA-F]{40}/, s.path);
  }
});

test("contract addresses live only in CONTRACTS and are unset", () => {
  assert.deepEqual(Object.keys(CONTRACTS).sort(), ["credentialRegistry", "delegationRegistry", "machineIdentityRegistry", "policyRegistry"]);
  for (const [k, v] of Object.entries(CONTRACTS)) assert.equal(v, "", k);
  const leaks = sources.filter((s) => !s.path.endsWith("config.js") && !s.path.endsWith("preview.json") && /0x[0-9a-fA-F]{40}/.test(s.text)).map((s) => s.path);
  assert.deepEqual(leaks, []);
});

test("ships in preview mode on Robinhood Chain", () => {
  assert.equal(APP_CONFIG.mode, "preview");
  assert.equal(CHAIN.CHAIN_ID, 4663);
});

test("preview data never claims a transaction or block", () => {
  const data = JSON.parse(readFileSync(join(root, "data", "preview.json"), "utf8"));
  const text = JSON.stringify(data);
  assert.doesNotMatch(text, /"(tx|txHash|hash|block|blockNumber)"\s*:/);
  assert.doesNotMatch(text, /0x[0-9a-fA-F]{64}/);
});
