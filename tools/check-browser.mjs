// Browser smoke test. Serves the site on a throwaway port, drives headless
// Chrome over the DevTools protocol and reports console errors, uncaught
// exceptions, failed requests and horizontal overflow for every page at a
// desktop and a phone width. Screenshots land in work/shots/ (git ignored).
//
// Usage: node tools/check-browser.mjs [page ...] [--shots] [--eval "expr"]
// Needs Chrome or Edge installed; set CHROME=path to override.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = rootIdx >= 0 ? normalize(args[rootIdx + 1]) : repo;
const shots = args.includes("--shots");
const full = args.includes("--full");
const evalIdx = args.indexOf("--eval");
const extraEval = evalIdx >= 0 ? args[evalIdx + 1] : null;
const waitIdx = args.indexOf("--wait");
const settle = waitIdx >= 0 ? Number(args[waitIdx + 1]) : 4500;
const atIdx = args.indexOf("--at");
const scrollStops = atIdx >= 0 ? args[atIdx + 1].split(",").map(Number) : [];
const pages = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--eval" && args[i - 1] !== "--wait" && args[i - 1] !== "--at" && args[i - 1] !== "--pre" && args[i - 1] !== "--root");
const preIdx = args.indexOf("--pre");
const preScript = preIdx >= 0 ? args[preIdx + 1] : null;
const PAGES = pages.length ? pages : ["index.html", "app.html", "app.html#identity", "app.html#credentials", "app.html#policies", "app.html#delegation", "app.html?agent=MEI0842&action=pay&amount=1200#verify", "app.html#activity", "app.html#network"];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true }
];

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml" };

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  // Mirror vercel.json cleanUrls.
  if (!extname(path) && existsSync(join(root, path + ".html"))) path += ".html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const chromePath = process.env.CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
if (!chromePath) { console.error("No Chrome found. Set CHROME."); process.exit(2); }
const profile = join(tmpdir(), "scrim-check-" + Date.now());
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--hide-scrollbars", "--enable-unsafe-swiftshader", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", (d) => { buf += d; const mm = buf.match(/ws:\/\/[^\s]+/); if (mm) resolve(mm[0]); });
  setTimeout(() => reject(new Error("Chrome did not start")), 15000);
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
const handlers = new Set();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
  else handlers.forEach((h) => h(msg));
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
if (shots) await mkdir(join(repo, "work", "shots"), { recursive: true });

for (const vp of VIEWPORTS) {
  for (const page of PAGES) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const problems = [];
    const onMsg = (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.exceptionThrown") problems.push("exception: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split("\n")[0]);
      if (msg.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(msg.params.type)) problems.push("console: " + msg.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error" && !/favicon/.test(msg.params.entry.url || "")) problems.push("log: " + msg.params.entry.text.slice(0, 160) + " " + (msg.params.entry.url || ""));
      if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400 && msg.params.response.url.startsWith(base)) problems.push("http " + msg.params.response.status + ": " + msg.params.response.url.replace(base, ""));
      if (msg.method === "Network.loadingFailed" && !msg.params.canceled) problems.push("request failed: " + msg.params.errorText);
    };
    handlers.add(onMsg);
    await send("Runtime.enable", {}, sessionId);
    await send("Log.enable", {}, sessionId);
    await send("Network.enable", {}, sessionId);
    await send("Page.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile }, sessionId);
    if (vp.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
    if (preScript) await send("Page.addScriptToEvaluateOnNewDocument", { source: preScript }, sessionId);
    await send("Page.navigate", { url: base + page }, sessionId);
    await sleep(settle);
    const evalExpr = `(async () => {
      const d = document.documentElement;
      const over = d.scrollWidth - d.clientWidth;
      const hidden = [...document.querySelectorAll('[data-prevent-flicker="true"]')].filter(e => getComputedStyle(e).visibility === 'hidden' && e.getBoundingClientRect().height > 0 && !e.closest('[pop-up],[menu]')).length;
      return JSON.stringify({ title: document.title, overflowX: over, hidden, text: document.body.innerText.length ${extraEval ? ", extra: await (" + extraEval + ")" : ""} });
    })()`;
    const r = await send("Runtime.evaluate", { expression: evalExpr, returnByValue: true, awaitPromise: true }, sessionId);
    const info = JSON.parse(r.result.value || "{}");
    if (info.overflowX > 1) problems.push("horizontal overflow " + info.overflowX + "px");
    if (shots) {
      let shotOpts = { format: "png" };
      if (full) {
        const m = await send("Page.getLayoutMetrics", {}, sessionId);
        shotOpts = { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: vp.width, height: Math.min(m.cssContentSize.height, 16000), scale: 1 } };
      }
      const shot = await send("Page.captureScreenshot", shotOpts, sessionId);
      await writeFile(join(repo, "work", "shots", `${vp.name}-${page.replace(/[^a-z0-9]+/gi, "_")}.png`), Buffer.from(shot.data, "base64"));
    }
    for (const stop of scrollStops) {
      await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${stop} <= 1 ? document.documentElement.scrollHeight * ${stop} : ${stop})` }, sessionId);
      await sleep(1800);
      const s = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      await mkdir(join(repo, "work", "shots"), { recursive: true });
      await writeFile(join(repo, "work", "shots", `${vp.name}-${page.replace(/[^a-z0-9]+/gi, "_")}-at${String(stop).replace(".", "_")}.png`), Buffer.from(s.data, "base64"));
    }
    handlers.delete(onMsg);
    await send("Target.closeTarget", { targetId });
    const status = problems.length ? "FAIL" : "ok  ";
    if (problems.length) failures++;
    console.log(`${status} ${vp.name.padEnd(7)} ${page.padEnd(28)} ${info.title || ""}${info.extra !== undefined ? " | " + JSON.stringify(info.extra) : ""}`);
    [...new Set(problems)].forEach((p) => console.log("       " + p));
  }
}

ws.close();
chrome.kill();
server.close();
process.exit(failures ? 1 : 0);
