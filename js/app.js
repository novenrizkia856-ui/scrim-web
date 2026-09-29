/* SCRIM console: the dapp screens. Reads and writes go through js/contracts.js;
   authorization verdicts come from js/policy.js; wallet state from js/web3.js.
   All markup reuses the reference classes plus the app_* additions in css/scrim.css. */
import { CHAIN } from "./config.js";
import { wallet, onWallet, connect, disconnect, switchNetwork, isCorrectChain, shortAddress, shortHash, explorer, readableError } from "./web3.js";
import { getSource, loadAgent, writeAvailability, OPERATIONS, BINDINGS, PreviewWriteError, NotConfiguredError, NotBoundError, WalletRequiredError } from "./contracts.js";
import {
  evaluate, summarizePolicy, parseAgentId, formatAgentId, isAddress, sameAddress, credentialState, delegationState, policyState,
  activeCredentials, activeDelegations, ACTIONS, ACTION_LABEL, CREDENTIAL_LABEL
} from "./policy.js";
import { copyText } from "./token.js";

const TABS = ["dashboard", "identity", "credentials", "policies", "delegation", "verify", "activity", "network"];
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const app = { ctx: null, agent: null, agentRef: null, agents: [], loading: false, activityFilter: "all" };

/* ---------- small render helpers ---------- */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ESC[c]); }

function fmtDate(value) {
  if (value == null || value === "") return null;
  const d = typeof value === "number" ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
function fmtDateTime(value) {
  if (value == null || value === "") return null;
  const d = typeof value === "number" ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}
function usd(n) { return n == null || n === "" ? "Not set" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function usdShort(n) {
  const v = Number(n);
  if (!isFinite(v)) return "Not set";
  if (v >= 1e6) return "$" + (v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "K";
  return "$" + v.toLocaleString("en-US");
}
function muted(text) { return '<span class="app_muted">' + esc(text) + "</span>"; }
function badge(state, text) { return '<span class="app_badge" data-state="' + esc(state) + '">' + esc(text || state) + "</span>"; }
function previewBadge() { return app.ctx && app.ctx.source.kind === "preview" ? badge("preview", "Preview data") : badge("live", "Chain state"); }
function copyBtn(value, label) {
  return '<button type="button" class="app_copy" data-copy="' + esc(value) + '" aria-label="' + esc(label || "Copy") + '">[ copy ]</button>';
}
function addr(value, opts) {
  if (!value) return muted((opts && opts.empty) || "Not recorded");
  const url = explorer("address", value);
  const text = esc(shortAddress(value));
  const link = url && app.ctx && app.ctx.source.kind === "live" ? '<a class="app_a" href="' + esc(url) + '" target="_blank" rel="noopener" title="' + esc(value) + '">' + text + "</a>" : '<span title="' + esc(value) + '">' + text + "</span>";
  return '<span class="app_addr">' + link + copyBtn(value, "Copy address") + "</span>";
}
function txCell(item) {
  if (item && item.tx) {
    const url = explorer("tx", item.tx);
    return url ? '<a class="app_a" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(shortHash(item.tx)) + "</a>" : esc(shortHash(item.tx));
  }
  return muted(item && item.preview ? "No transaction in preview" : "Not recorded");
}
function row(label, valueHtml) {
  return '<div class="app_row"><p class="app_row-label">' + esc(label) + '</p><div class="app_row-value">' + valueHtml + "</div></div>";
}
function stateText(s) { return { active: "Active", expired: "Expired", revoked: "Revoked", suspended: "Suspended", paused: "Paused", missing: "Missing" }[s] || s; }
function linkBtn(text, attrs) {
  return '<button type="button" class="link-block app_link" ' + attrs + '><span class="overflow-hidden"><span line-mask-text="">[ ' + esc(text) + " ]</span></span></button>";
}
function emptySheet(title, text, extra) {
  return '<div class="app_sheet app_empty"><p class="text-color-lemon">' + esc(title) + '</p><p class="text-size-space-grotesk-15">' + esc(text) + "</p>" + (extra || "") + "</div>";
}

/* ---------- tabs ---------- */
function currentTab() {
  const t = (location.hash || "").replace("#", "");
  return TABS.indexOf(t) >= 0 ? t : "dashboard";
}
function showTab(tab) {
  $$(".app_tab").forEach((a) => {
    const on = a.getAttribute("data-tab") === tab;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  $$(".app_panel").forEach((p) => { p.hidden = p.getAttribute("data-panel") !== tab; });
  const indicator = document.getElementById("section-indicator");
  if (indicator) indicator.textContent = "scrim // " + tab;
  if (window.ScrollTrigger) window.ScrollTrigger.refresh();
}

/* ---------- notice bar ---------- */
function renderNotice() {
  const el = $("[data-notice]");
  if (!app.ctx) return;
  const notes = [];
  if (app.ctx.state.mode === "preview") notes.push("Preview mode. The SCRIM contracts are not deployed yet. Agents shown are sample data, and nothing is sent onchain.");
  if (wallet.status === "connected" && !isCorrectChain(wallet.chainId)) notes.push("Wrong network. Switch your wallet to " + CHAIN.CHAIN_NAME + " to send transactions.");
  el.hidden = !notes.length;
  el.innerHTML = notes.map((n) => "<p>" + esc(n) + "</p>").join("");
  $("[data-mode-label]").textContent = app.ctx.state.mode === "live" ? "MODE: LIVE" : "MODE: PREVIEW";
}

/* ---------- wallet panel ---------- */
function renderWallet() {
  const label = $("[data-wallet-label]");
  const net = $("[data-net-label]");
  const cta = $("[data-wallet-cta]");
  const connectBtn = $("[data-wallet-connect]");
  const connected = wallet.status === "connected";
  const right = connected && isCorrectChain(wallet.chainId);
  if (wallet.status === "connecting") label.textContent = "CONNECTING";
  else if (connected) label.textContent = shortAddress(wallet.address);
  else if (wallet.status === "unavailable") label.textContent = "NO WALLET FOUND";
  else label.textContent = "NOT CONNECTED";
  net.textContent = !connected ? CHAIN.CHAIN_NAME.toUpperCase() : right ? CHAIN.CHAIN_NAME.toUpperCase() : "WRONG NETWORK";
  net.classList.toggle("is-warn", connected && !right);
  cta.textContent = connected ? (right ? "CONNECTED" : "SWITCH") : wallet.status === "connecting" ? "WAIT" : "CONNECT";
  connectBtn.classList.toggle("is-connected", connected && right);
  $("[data-wallet-switch]").hidden = !(connected && !right);
  $("[data-wallet-copy]").hidden = !connected;
  $("[data-wallet-disconnect]").hidden = !connected;
  $$("[data-delegation-controller]").forEach((el) => { el.textContent = connected ? shortAddress(wallet.address) : "connect a wallet"; });
  const ctl = $("#reg-controller");
  if (ctl && connected && !ctl.value) { ctl.value = wallet.address; }
  renderNotice();
  renderAvailability();
}

function renderAvailability() {
  if (!app.ctx) return;
  $$("[data-availability]").forEach((el) => {
    const a = writeAvailability(el.getAttribute("data-availability"), app.ctx);
    el.textContent = a.reason;
    el.setAttribute("data-code", a.code);
  });
}

/* ---------- agents list and lookup ---------- */
async function renderAgentList() {
  const box = $("[data-agent-list]");
  const src = app.ctx.source;
  let items = [];
  if (src.kind === "preview") {
    items = await Promise.all(src.agentIds().map((id) => src.read("getAgent", { agent: id })));
  } else if (wallet.status === "connected") {
    try { items = (await src.read("listAgentsByController", { controller: wallet.address })) || []; }
    catch (e) { box.innerHTML = muted(e.message); return; }
  } else {
    box.innerHTML = muted("Connect a wallet to list the agents you control, or look one up.");
    return;
  }
  app.agents = items.filter(Boolean);
  if (!app.agents.length) { box.innerHTML = muted("No agents registered to this wallet yet."); return; }
  box.innerHTML = app.agents.map((a) => {
    const on = app.agent && app.agent.id === a.id;
    return '<button type="button" class="app_agent' + (on ? " is-on" : "") + '" data-pick="' + esc(a.id) + '"><span class="app_agent-id">' + esc(formatAgentId(a.id)) + '</span><span class="app_agent-name">' + esc(a.label || "") + "</span></button>";
  }).join("");
}

async function selectAgent(ref, opts) {
  app.agentRef = ref;
  app.loading = true;
  const err = $("[data-lookup-error]");
  err.hidden = true;
  renderAll();
  try {
    const agent = await loadAgent(app.ctx, ref);
    app.loading = false;
    if (!agent) {
      app.agent = null;
      if (!(opts && opts.quiet)) { err.textContent = "No identity found for " + ref + "."; err.hidden = false; }
    } else {
      app.agent = agent;
      try { localStorage.setItem("scrim.agent", String(agent.id)); } catch (e) { /* storage blocked */ }
    }
  } catch (e) {
    app.loading = false;
    app.agent = null;
    err.textContent = readableError(e);
    err.hidden = false;
  }
  renderAll();
  renderAgentList();
}

/* ---------- views ---------- */
function identityStatus(agent) {
  if (!agent) return { state: "missing", text: "Unknown" };
  if (agent.status !== "active") return { state: agent.status, text: stateText(agent.status) };
  const now = Date.now();
  const verified = (agent.credentials || []).some((c) => c.type === "controller" && credentialState(c, now) === "active");
  return verified ? { state: "active", text: "Verified" } : { state: "expired", text: "Unverified" };
}

function noAgent(what) {
  if (app.loading) return '<p class="app_muted">Loading</p>';
  return emptySheet("NO AGENT SELECTED", "Pick or look up an agent to see its " + what + ".");
}

function renderDashboard() {
  const el = $('[data-view="dashboard"]');
  const a = app.agent;
  if (!a) { el.innerHTML = noAgent("identity"); return; }
  const now = Date.now();
  const st = identityStatus(a);
  const p = a.policy;
  const creds = activeCredentials(a, now).length;
  const dels = activeDelegations(a, now);
  const verifiedActions = a.verifiedActions != null ? a.verifiedActions : (a.activity || []).filter((e) => e.type === "tx_authorized").length;
  const perms = p ? (p.actions || []).map((x) => '<span class="app_tag">' + esc(x.toUpperCase()) + "</span>").join("") : muted("No policy");
  const assets = p && p.assets && p.assets.length ? p.assets.map((x) => esc(x.symbol || x)).join(", ") : "None approved";
  const del = dels[0];
  el.innerHTML =
    '<div class="app_sheet app_dash">' +
      '<div class="app_dash-top">' +
        '<div><p class="text-color-pastel-pink-main">AGENT</p><h3 class="app_agent-big text-color-lemon">' + esc(formatAgentId(a.id)) + "</h3>" +
        '<p class="app_dash-sub">' + esc(a.label || "Unnamed agent") + (a.application ? " // " + esc(a.application) : "") + "</p></div>" +
        '<div class="app_badges">' + previewBadge() + badge(st.state, st.text) + "</div>" +
      "</div>" +
      '<div class="app_dash-grid">' +
        cell("ECONOMIC IDENTITY", '<p class="app_big">' + esc(st.text) + "</p>" + muted("Since " + (fmtDate(a.createdAt) || "unknown"))) +
        cell("CONTROLLER", addr(a.controller)) +
        cell("AUTHORITY", p ? '<p class="app_big">' + esc(usdShort(p.dailyLimit)) + ' daily</p><p class="app_big">' + esc(usdShort(p.maxTransaction)) + " per tx max</p>" : muted("No policy")) +
        cell("ASSETS", '<p class="app_big">' + esc(assets) + "</p>") +
        cell("PERMISSIONS", '<div class="app_tags">' + perms + "</div>") +
        cell("CREDENTIALS", '<p class="app_big">' + creds + " ACTIVE</p>" + muted((a.credentials || []).length + " issued in total")) +
        cell("ACTIVITY", '<p class="app_big">' + esc(verifiedActions) + " VERIFIED ACTIONS</p>") +
        cell("DELEGATION", del ? '<p class="app_big">' + esc(del.ref || "Active") + " active</p>" + muted(del.expiresAt ? "Until " + fmtDate(del.expiresAt) : "Until revoked") : '<p class="app_big">None active</p>') +
      "</div>" +
      '<div class="app_summary"><p class="text-color-pastel-pink-main">POLICY IN WORDS</p><p class="text-size-space-grotesk-15">' + esc(summarizePolicy(a, now)) + "</p></div>" +
      gapsNote(a) +
    "</div>";
}
function cell(label, html) { return '<div class="app_cell"><p class="app_cell-label">' + esc(label) + '</p><div class="app_cell-value">' + html + "</div></div>"; }
function gapsNote(a) {
  if (!a.gaps || !a.gaps.length) return "";
  return '<div class="app_gaps">' + a.gaps.map((g) => "<p>" + esc(g.message) + "</p>").join("") + "</div>";
}

function renderIdentity() {
  const el = $('[data-view="identity"]');
  const a = app.agent;
  if (!a) { el.innerHTML = noAgent("identity record"); return; }
  const st = identityStatus(a);
  const suspended = a.status !== "active";
  el.innerHTML =
    '<div class="app_sheet">' +
      '<div class="app_sheet-head"><div><p class="text-color-pastel-pink-main">IDENTITY RECORD</p><h4 class="app_sheet-title text-color-lemon">' + esc(formatAgentId(a.id)) + "</h4></div>" +
      '<div class="app_badges">' + previewBadge() + badge(st.state, st.text) + "</div></div>" +
      row("Agent ID", esc(formatAgentId(a.id)) + muted(" onchain " + a.id)) +
      row("Agent key", addr(a.agentKey)) +
      row("Controller", addr(a.controller)) +
      row("Name", esc(a.label || "Not set")) +
      row("Application", esc(a.application || "Not set")) +
      row("Metadata", a.metadataURI ? '<span class="app_wrap">' + esc(a.metadataURI) + "</span>" : muted("None")) +
      row("Created", esc(fmtDateTime(a.createdAt) || "Unknown")) +
      row("Status", badge(a.status, stateText(a.status))) +
      row("Record", txCell(a)) +
      '<div class="app_actions">' + linkBtn(suspended ? "reactivate identity" : "suspend identity", 'data-action="setAgentStatus" data-status="' + (suspended ? "active" : "suspended") + '"') + "</div>" +
    "</div>";
}

function renderCredentials() {
  const el = $('[data-view="credentials"]');
  const a = app.agent;
  if (!a) { el.innerHTML = noAgent("credentials"); return; }
  const now = Date.now();
  const list = a.credentials || [];
  if (!list.length) { el.innerHTML = emptySheet("NO CREDENTIALS", formatAgentId(a.id) + " holds no credentials yet. Issue one with the form."); return; }
  el.innerHTML = '<div class="app_sheet"><div class="app_sheet-head"><div><p class="text-color-pastel-pink-main">CREDENTIALS</p><h4 class="app_sheet-title text-color-lemon">' +
    activeCredentials(a, now).length + " active of " + list.length + '</h4></div><div class="app_badges">' + previewBadge() + "</div></div>" +
    '<div class="app_list">' + list.map((c) => {
      const s = credentialState(c, now);
      return '<div class="app_item">' +
        '<div class="app_item-head"><p class="app_item-title">' + esc(CREDENTIAL_LABEL[c.type] || c.type) + '</p>' + badge(s, s === "active" ? "Active" : stateText(s)) + "</div>" +
        '<p class="text-size-space-grotesk-15 app_item-text">' + esc(c.reference || "") + "</p>" +
        '<div class="app_item-grid">' +
          mini("ID", "C" + String(c.id).padStart(3, "0")) +
          mini("ISSUER", esc(c.issuer || "Unknown")) +
          mini("ISSUER ADDRESS", addr(c.issuerAddress)) +
          mini("ISSUED", esc(fmtDate(c.issuedAt) || "Unknown")) +
          mini("EXPIRES", esc(c.expiresAt ? fmtDate(c.expiresAt) : "Never")) +
          mini("REVOKED", c.revoked ? "Yes" : "No") +
        "</div>" +
        (s === "active" ? '<div class="app_actions">' + linkBtn("revoke credential", 'data-action="revokeCredential" data-id="' + esc(c.id) + '"') + "</div>" : "") +
      "</div>";
    }).join("") + "</div></div>";
}
function mini(label, html) { return '<div class="app_mini"><p class="app_mini-label">' + esc(label) + '</p><div class="app_mini-value">' + html + "</div></div>"; }

function renderPolicies() {
  const el = $('[data-view="policies"]');
  const a = app.agent;
  if (!a) { el.innerHTML = noAgent("policy"); return; }
  const now = Date.now();
  const p = a.policy;
  if (!p) { el.innerHTML = emptySheet("NO POLICY", formatAgentId(a.id) + " has no policy, so it may not act. Set one with the form."); return; }
  const s = policyState(p, now);
  const remaining = Math.max(Number(p.dailyLimit) - Number(p.spentToday || 0), 0);
  el.innerHTML = '<div class="app_sheet">' +
    '<div class="app_sheet-head"><div><p class="text-color-pastel-pink-main">ACTIVE POLICY</p><h4 class="app_sheet-title text-color-lemon">' + esc(formatAgentId(a.id)) + '</h4></div><div class="app_badges">' + previewBadge() + badge(s, stateText(s)) + "</div></div>" +
    '<p class="text-size-space-grotesk-15 app_policy-words">' + esc(summarizePolicy(a, now)) + "</p>" +
    row("Allowed actions", '<div class="app_tags">' + ACTIONS.map((x) => '<span class="app_tag' + ((p.actions || []).indexOf(x) >= 0 ? "" : " is-off") + '">' + esc(x.toUpperCase()) + "</span>").join("") + "</div>") +
    row("Approved assets", (p.assets || []).length ? (p.assets || []).map((x) => '<span class="app_line">' + esc(x.symbol || x) + " " + (x.address ? addr(x.address) : "") + "</span>").join("") : muted("None")) +
    row("Approved protocols", (p.protocols || []).length ? (p.protocols || []).map((x) => '<span class="app_line">' + esc(x.name || "Protocol") + " " + (x.address ? addr(x.address) : "") + "</span>").join("") : muted("Any protocol is refused")) +
    row("Max per transaction", esc(usd(p.maxTransaction))) +
    row("Daily limit", esc(usd(p.dailyLimit))) +
    row("Spent today", esc(usd(p.spentToday || 0)) + muted(" " + usd(remaining) + " left")) +
    row("Expires", esc(p.expiresAt ? fmtDate(p.expiresAt) : "Never")) +
    row("Last change", esc(fmtDateTime(p.updatedAt) || "Unknown")) +
    '<div class="app_actions">' + linkBtn(s === "paused" ? "resume policy" : "pause policy", 'data-action="setPolicyStatus" data-status="' + (s === "paused" ? "active" : "paused") + '"') + "</div>" +
  "</div>";
}

function fillPolicyForm() {
  const form = $('[data-form="setPolicy"]');
  const p = app.agent && app.agent.policy;
  $$('input[name="actions"]', form).forEach((i) => { i.checked = !!(p && (p.actions || []).indexOf(i.value) >= 0); });
  form.elements.assets.value = p ? (p.assets || []).map((x) => x.symbol || x).join(", ") : "";
  form.elements.protocols.value = p ? (p.protocols || []).map((x) => x.address).filter(Boolean).join(", ") : "";
  form.elements.maxTransaction.value = p && p.maxTransaction != null ? p.maxTransaction : "";
  form.elements.dailyLimit.value = p && p.dailyLimit != null ? p.dailyLimit : "";
  form.elements.expiresAt.value = p && p.expiresAt ? String(new Date(p.expiresAt).toISOString()).slice(0, 10) : "";
}

function renderDelegation() {
  const el = $('[data-view="delegation"]');
  const a = app.agent;
  if (!a) { el.innerHTML = noAgent("delegations"); return; }
  const now = Date.now();
  const list = a.delegations || [];
  if (!list.length) { el.innerHTML = emptySheet("NO DELEGATIONS", "No authority has been delegated to " + formatAgentId(a.id) + ". Without one it cannot act."); return; }
  el.innerHTML = '<div class="app_sheet"><div class="app_sheet-head"><div><p class="text-color-pastel-pink-main">DELEGATIONS</p><h4 class="app_sheet-title text-color-lemon">' +
    activeDelegations(a, now).length + " active of " + list.length + '</h4></div><div class="app_badges">' + previewBadge() + "</div></div>" +
    '<div class="app_list">' + list.map((d) => {
      const s = delegationState(d, now);
      return '<div class="app_item">' +
        '<div class="app_item-head"><p class="app_item-title">Delegation ' + esc(d.ref || d.id) + "</p>" + badge(s, stateText(s)) + "</div>" +
        '<div class="app_flow"><div>' + mini("CONTROLLER", addr(d.controller)) + '</div><span class="app_flow-arrow" aria-hidden="true">&gt;&gt;&gt;</span><div>' + mini("AGENT", esc(formatAgentId(a.id)) + " " + addr(d.agent || a.agentKey)) + "</div></div>" +
        '<div class="app_item-grid">' +
          mini("PERMISSIONS", '<div class="app_tags">' + (d.permissions || []).map((x) => '<span class="app_tag">' + esc(x.toUpperCase()) + "</span>").join("") + "</div>") +
          mini("SPENDING AUTHORITY", esc(usd(d.spendLimit))) +
          mini("EXPIRES", esc(d.expiresAt ? fmtDate(d.expiresAt) : "Until revoked")) +
          mini("GRANTED", esc(fmtDate(d.createdAt) || "Unknown")) +
        "</div>" +
        (s === "active" ? '<div class="app_actions">' + linkBtn("revoke delegation", 'data-action="revokeDelegation" data-id="' + esc(d.id) + '"') + "</div>" : "") +
      "</div>";
    }).join("") + "</div></div>";
}

const ACTIVITY_LABEL = {
  identity_created: "Identity created", credential_issued: "Credential issued", credential_revoked: "Credential revoked",
  delegation_granted: "Delegation granted", delegation_revoked: "Delegation revoked", policy_changed: "Permission changed",
  tx_authorized: "Transaction authorized", tx_rejected: "Transaction rejected", activity_attested: "Activity attested"
};
const ACTIVITY_GROUP = {
  identity_created: "identity", credential_issued: "credential", credential_revoked: "credential", delegation_granted: "delegation",
  delegation_revoked: "delegation", policy_changed: "policy", tx_authorized: "tx", tx_rejected: "tx", activity_attested: "tx"
};
function renderActivity() {
  const el = $('[data-view="activity"]');
  const a = app.agent;
  if (!a) { el.innerHTML = noAgent("activity"); return; }
  const f = app.activityFilter;
  const list = (a.activity || []).filter((e) => f === "all" || ACTIVITY_GROUP[e.type] === f)
    .sort((x, y) => new Date(y.at) - new Date(x.at));
  if (!list.length) { el.innerHTML = emptySheet("NO EVENTS", "Nothing recorded for this filter yet."); return; }
  el.innerHTML = '<div class="app_sheet"><div class="app_sheet-head"><div><p class="text-color-pastel-pink-main">EVENTS</p><h4 class="app_sheet-title text-color-lemon">' + esc(formatAgentId(a.id)) + '</h4></div><div class="app_badges">' + previewBadge() + "</div></div>" +
    '<div class="app_events">' + list.map((e) => {
      const kind = e.type === "tx_rejected" || /revoked/.test(e.type) ? "revoked" : e.type === "tx_authorized" ? "active" : "neutral";
      return '<div class="app_event"><p class="app_event-time">' + esc(fmtDateTime(e.at) || "") + "</p>" +
        '<div class="app_event-body">' + badge(kind, ACTIVITY_LABEL[e.type] || e.type) + '<p class="text-size-space-grotesk-15">' + esc(e.detail || "") + "</p></div>" +
        '<div class="app_event-tx">' + txCell(e) + "</div></div>";
    }).join("") + "</div></div>";
}

async function renderNetwork() {
  const el = $('[data-view="network"]');
  const st = app.ctx.state;
  const connected = wallet.status === "connected";
  const walletRows =
    row("Status", connected ? badge("active", "Connected") : badge("neutral", wallet.status === "unavailable" ? "No wallet found" : "Not connected")) +
    row("Wallet", connected ? esc(wallet.providerName || "Browser wallet") : muted("None")) +
    row("Address", connected ? addr(wallet.address) : muted("None")) +
    row("Wallet network", connected ? (isCorrectChain(wallet.chainId) ? badge("active", CHAIN.CHAIN_NAME) : badge("revoked", "Chain " + wallet.chainId)) : muted("Unknown"));
  const regs = Object.keys(st.contracts).map((k) => {
    const c = st.contracts[k];
    const ops = Object.keys(OPERATIONS).filter((op) => OPERATIONS[op].contract === k);
    const bound = ops.filter((op) => BINDINGS[op]).length;
    return '<div class="app_item"><div class="app_item-head"><p class="app_item-title">' + esc(c.name) + "</p>" + badge(c.ready ? "active" : "expired", c.ready ? "Configured" : "Not configured") + "</div>" +
      '<div class="app_item-grid">' + mini("ADDRESS", c.addressOk ? addr(c.address) : muted("Not set")) + mini("ABI", c.abiOk ? "Loaded" : muted("Empty")) + mini("BOUND OPERATIONS", bound + " of " + ops.length) + "</div></div>";
  }).join("");
  const checks = st.checks.map((c) => '<p class="app_check" data-ok="' + (c.ok ? "1" : "0") + '"><span>' + (c.ok ? "PASS" : "MISSING") + "</span>" + esc(c.label) + "</p>").join("");
  el.innerHTML = '<div class="app_cols is-even">' +
    '<div class="app_sheet"><p class="text-color-pastel-pink-main">CHAIN</p><h4 class="app_sheet-title text-color-lemon">' + esc(CHAIN.CHAIN_NAME) + "</h4>" +
      row("Chain ID", esc(CHAIN.CHAIN_ID)) + row("RPC", '<span class="app_wrap">' + esc(CHAIN.RPC_URL) + "</span>") +
      row("Explorer", CHAIN.BLOCK_EXPLORER_URL ? '<a class="app_a" href="' + esc(CHAIN.BLOCK_EXPLORER_URL) + '" target="_blank" rel="noopener">' + esc(CHAIN.BLOCK_EXPLORER_URL.replace(/^https?:\/\//, "")) + "</a>" : muted("Not set")) +
      row("Latest block", '<span data-latest-block>' + muted("Checking") + "</span>") +
      '<div class="app_actions">' + linkBtn("add or switch network", "data-net-switch") + "</div>" +
    "</div>" +
    '<div class="app_sheet"><p class="text-color-pastel-pink-main">WALLET</p><h4 class="app_sheet-title text-color-lemon">' + (connected ? esc(shortAddress(wallet.address)) : "Not connected") + "</h4>" + walletRows + "</div>" +
    '<div class="app_sheet"><p class="text-color-pastel-pink-main">MODE</p><h4 class="app_sheet-title text-color-lemon">' + (st.mode === "live" ? "Live" : "Preview") + "</h4>" +
      '<p class="text-size-space-grotesk-15 app_item-text">' + (st.mode === "live" ? "Reads and writes go to the SCRIM registries on Robinhood Chain." : "Live mode starts once every item below passes. Until then nothing is sent.") + "</p>" + checks +
      (st.unbound.length ? '<p class="app_hint">' + st.unbound.length + " operations still need a binding in js/bindings.js.</p>" : "") +
    "</div>" +
    '<div class="app_sheet"><p class="text-color-pastel-pink-main">REGISTRIES</p><h4 class="app_sheet-title text-color-lemon">' + Object.values(st.contracts).filter((c) => c.ready).length + " of 4 configured</h4>" +
      '<div class="app_list">' + regs + "</div>" +
      '<p class="app_hint">Addresses live in js/config.js. Paste them there after deployment.</p>' +
    "</div>" +
  "</div>";
  try {
    const { latestBlock } = await import("./web3.js");
    const n = await latestBlock();
    const span = $("[data-latest-block]");
    if (span) span.textContent = "#" + n.toLocaleString("en-US");
  } catch (e) {
    const span = $("[data-latest-block]");
    if (span) span.innerHTML = muted("RPC not reachable from this browser");
  }
}

/* ---------- verify ---------- */
async function runVerify(form) {
  const view = $('[data-view="verify"]');
  const f = form.elements;
  const ref = f.agent.value.trim();
  clearErrors(form);
  if (!ref) return fieldError(f.agent, "Enter an agent ID such as MEI0842 or a key address.");
  if (!parseAgentId(ref) && !isAddress(ref)) return fieldError(f.agent, "Use an agent ID such as MEI0842 or a 0x address.");
  const amountRaw = f.amount.value.trim().replace(/[$,\s]/g, "");
  if (amountRaw && !(Number(amountRaw) >= 0)) return fieldError(f.amount, "Enter the amount as a number.");
  if (f.protocol.value.trim() && !isAddress(f.protocol.value.trim())) return fieldError(f.protocol, "Protocol must be a 0x address.");
  view.innerHTML = '<div class="app_sheet"><p class="app_muted">Reading registry state</p></div>';
  let agent;
  try { agent = await loadAgent(app.ctx, ref); }
  catch (e) { view.innerHTML = emptySheet("CHECK FAILED", readableError(e)); return; }
  const request = { action: f.action.value, amount: amountRaw === "" ? null : Number(amountRaw), asset: f.asset.value.trim(), protocol: f.protocol.value.trim() };
  const result = evaluate(agent, request, Date.now());
  let contractVerdict = null;
  if (agent && app.ctx.source.kind === "live") {
    try { contractVerdict = await app.ctx.source.read("checkAuthorization", Object.assign({ agentId: agent.id }, request)); } catch (e) { contractVerdict = null; }
  }
  const permitted = contractVerdict ? !!contractVerdict.permitted : result.permitted;
  const reqText = (ACTION_LABEL[request.action] || request.action) + (request.amount != null ? " " + usd(request.amount) : "") + (request.asset ? " in " + request.asset : "");
  view.innerHTML = '<div class="app_sheet app_verdict" data-permitted="' + (permitted ? "1" : "0") + '">' +
    '<div class="app_sheet-head"><div><p class="text-color-pastel-pink-main">RESULT</p><h3 class="app_verdict-title">' + (permitted ? "Permitted" : "Not permitted") + "</h3></div>" +
    '<div class="app_badges">' + previewBadge() + "</div></div>" +
    '<p class="text-size-space-grotesk-15 app_item-text">' + esc(agent ? formatAgentId(agent.id) : ref) + " // " + esc(reqText) + "</p>" +
    (contractVerdict ? row("Contract verdict", badge(contractVerdict.permitted ? "active" : "revoked", contractVerdict.permitted ? "Permitted" : "Refused") + (contractVerdict.reason ? " " + esc(contractVerdict.reason) : "")) : "") +
    '<div class="app_checks">' + result.checks.map((c) => '<div class="app_check-row" data-ok="' + (c.ok ? "1" : "0") + '"><span class="app_check-mark">' + (c.ok ? "PASS" : "FAIL") + '</span><div><p>' + esc(c.label) + '</p><p class="text-size-space-grotesk-15">' + esc(c.detail) + "</p></div></div>").join("") + "</div>" +
    '<p class="app_hint">' + (app.ctx.source.kind === "preview" ? "Source: preview data, not chain state. Live checks read the SCRIM registries." : "Source: SCRIM registries on " + esc(CHAIN.CHAIN_NAME) + ", read " + esc(fmtDateTime(Date.now())) + ".") + "</p>" +
  "</div>";
}

/* ---------- forms ---------- */
function clearErrors(form) {
  $$(".app_field-error.is-field", form).forEach((e) => e.remove());
  $$(".is-invalid", form).forEach((e) => e.classList.remove("is-invalid"));
}
function fieldError(input, message) {
  input.classList.add("is-invalid");
  const p = document.createElement("p");
  p.className = "app_field-error is-field";
  p.textContent = message;
  const group = input.closest(".app_field") || input.parentElement;
  group.after(p);
  input.focus();
  return null;
}
function money(input, required, label) {
  const raw = input.value.trim().replace(/[$,\s]/g, "");
  if (!raw) { if (required) fieldError(input, label + " is required."); return required ? null : undefined; }
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) { fieldError(input, label + " must be a positive number."); return null; }
  return n;
}
function futureDate(input) {
  const v = input.value;
  if (!v) return { ok: true, value: null };
  const t = Date.parse(v + "T23:59:59Z");
  if (isNaN(t) || t <= Date.now()) { fieldError(input, "Pick a date in the future."); return { ok: false }; }
  return { ok: true, value: new Date(t).toISOString() };
}
function needAgent(form) {
  if (app.agent) return true;
  const p = document.createElement("p");
  p.className = "app_field-error is-field";
  p.textContent = "Select or look up an agent first.";
  form.querySelector(".app_submit").before(p);
  return false;
}

const FORMS = {
  registerAgent(form) {
    const f = form.elements;
    const key = f.agentKey.value.trim();
    const controller = f.controller.value.trim();
    if (!isAddress(key)) return fieldError(f.agentKey, "Enter the agent key as a 0x address with 40 hex characters.");
    if (!isAddress(controller)) return fieldError(f.controller, "Enter the controller as a 0x address.");
    if (sameAddress(key, controller)) return fieldError(f.controller, "The controller must be a different key from the agent.");
    if (!f.label.value.trim()) return fieldError(f.label, "Give the agent a name.");
    return {
      input: { agentKey: key, controller: controller, label: f.label.value.trim(), application: f.application.value.trim(), metadataURI: f.metadataURI.value.trim() },
      summary: [["Agent key", shortAddress(key)], ["Controller", shortAddress(controller)], ["Name", f.label.value.trim()]]
    };
  },
  issueCredential(form) {
    if (!needAgent(form)) return null;
    const f = form.elements;
    if (!f.reference.value.trim()) return fieldError(f.reference, "Describe what the credential states.");
    const exp = futureDate(f.expiresAt);
    if (!exp.ok) return null;
    return {
      input: { agentId: app.agent.id, type: f.type.value, reference: f.reference.value.trim(), expiresAt: exp.value },
      summary: [["Agent", formatAgentId(app.agent.id)], ["Type", CREDENTIAL_LABEL[f.type.value]], ["Expires", exp.value ? fmtDate(exp.value) : "Never"]]
    };
  },
  setPolicy(form) {
    if (!needAgent(form)) return null;
    const f = form.elements;
    const actions = $$('input[name="actions"]:checked', form).map((i) => i.value);
    if (!actions.length) { const p = document.createElement("p"); p.className = "app_field-error is-field"; p.textContent = "Allow at least one action, or pause the policy instead."; $('[data-chips="actions"]', form).after(p); return null; }
    const assets = f.assets.value.split(",").map((s) => s.trim()).filter(Boolean);
    if (!assets.length) return fieldError(f.assets, "Approve at least one asset, such as USDC.");
    const protocols = f.protocols.value.split(",").map((s) => s.trim()).filter(Boolean);
    const bad = protocols.find((x) => !isAddress(x));
    if (bad) return fieldError(f.protocols, "Each protocol must be a 0x address.");
    const max = money(f.maxTransaction, true, "Max per transaction");
    if (max == null) return null;
    const daily = money(f.dailyLimit, true, "Daily limit");
    if (daily == null) return null;
    if (max > daily) return fieldError(f.maxTransaction, "The transaction maximum cannot exceed the daily limit.");
    const exp = futureDate(f.expiresAt);
    if (!exp.ok) return null;
    return {
      input: { agentId: app.agent.id, actions: actions, assets: assets, protocols: protocols, maxTransaction: max, dailyLimit: daily, expiresAt: exp.value },
      summary: [["Agent", formatAgentId(app.agent.id)], ["Actions", actions.join(", ").toUpperCase()], ["Limits", usd(max) + " per tx, " + usd(daily) + " daily"]]
    };
  },
  grantDelegation(form) {
    if (!needAgent(form)) return null;
    const f = form.elements;
    const perms = $$('input[name="permissions"]:checked', form).map((i) => i.value);
    if (!perms.length) { const p = document.createElement("p"); p.className = "app_field-error is-field"; p.textContent = "Choose at least one permission to delegate."; $(".app_chips", form).after(p); return null; }
    const limit = money(f.spendLimit, true, "Spending authority");
    if (limit == null) return null;
    const exp = futureDate(f.expiresAt);
    if (!exp.ok) return null;
    return {
      input: { agentId: app.agent.id, permissions: perms, spendLimit: limit, expiresAt: exp.value },
      summary: [["Agent", formatAgentId(app.agent.id)], ["Permissions", perms.join(", ").toUpperCase()], ["Authority", usd(limit)], ["Expires", exp.value ? fmtDate(exp.value) : "Until revoked"]]
    };
  }
};

/* ---------- transaction sheet ---------- */
// The reference smooth scroll (Lenis) is a global let binding from a classic script.
function smooth() {
  // eslint-disable-next-line no-undef
  try { return typeof lenis !== "undefined" ? lenis : null; } catch (e) { return null; }
}
const sheet = {
  el: null,
  open(kicker) {
    this.el = this.el || $("#tx-sheet");
    this.el.hidden = false;
    document.documentElement.classList.add("app_tx-open");
    requestAnimationFrame(() => this.el.classList.add("is-open"));
    $("[data-tx-kicker]", this.el).textContent = kicker;
    const l = smooth(); if (l && l.stop) l.stop();
  },
  close() {
    if (!this.el) return;
    this.el.classList.remove("is-open");
    document.documentElement.classList.remove("app_tx-open");
    setTimeout(() => { this.el.hidden = true; }, 350);
    const l = smooth(); if (l && l.start) l.start();
  },
  set(state, title, text, summary, extraHtml) {
    const el = this.el;
    el.setAttribute("data-state", state);
    $("[data-tx-title]", el).textContent = title;
    $("[data-tx-text]", el).textContent = text || "";
    const steps = [["validate", "Checked"], ["sign", "Signed in wallet"], ["pending", "Pending onchain"], ["confirmed", "Confirmed"]];
    const order = { blocked: 0, signing: 1, pending: 2, confirmed: 4, failed: -1 };
    const reached = order[state] == null ? 0 : order[state];
    $("[data-tx-steps]", el).innerHTML = steps.map((s, i) => {
      const cls = state === "failed" ? (i === 0 ? "is-done" : "") : state === "blocked" ? (i === 0 ? "is-done" : "is-stop") : i < reached ? "is-done" : i === reached ? "is-now" : "";
      return '<p class="app_step ' + cls + '"><span class="blinking-decor-block"></span>' + esc(s[1]) + "</p>";
    }).join("");
    $("[data-tx-detail]", el).innerHTML = (summary || []).map((r) => row(r[0], esc(r[1]))).join("") + (extraHtml || "");
  }
};

async function runWrite(op, input, summary) {
  const label = OPERATIONS[op].label;
  sheet.open(label.toUpperCase());
  const avail = writeAvailability(op, app.ctx);
  if (!avail.ok) {
    let extra = "";
    if (avail.code === "wallet") extra = '<div class="app_actions">' + linkBtn("connect wallet", "data-tx-connect") + "</div>";
    if (avail.code === "network") extra = '<div class="app_actions">' + linkBtn("switch network", "data-tx-switch") + "</div>";
    const titles = { preview: "Not sent", config: "Not configured", unbound: "Not wired yet", wallet: "Wallet needed", network: "Wrong network" };
    sheet.set("blocked", titles[avail.code] || "Not sent", avail.reason, summary, extra);
    return;
  }
  sheet.set("signing", "Confirm in wallet", "Your wallet shows the transaction. Nothing happens until you sign it.", summary);
  try {
    const result = await app.ctx.source.write(op, input, (u) => {
      if (u.status === "signing") sheet.set("signing", "Confirm in wallet", "Waiting for your signature.", summary);
      if (u.status === "pending") sheet.set("pending", "Pending", "Sent. Waiting for Robinhood Chain to include it.", summary, txLink(u.hash));
      if (u.status === "failed") sheet.set("failed", "Failed", u.error || "The transaction failed.", summary, u.hash ? txLink(u.hash) : "");
      if (u.status === "confirmed") sheet.set("confirmed", "Confirmed", "Included in block " + u.block + ".", summary, txLink(u.hash));
    });
    if (result && result.status === "confirmed" && app.agentRef) await selectAgent(app.agentRef, { quiet: true });
  } catch (e) {
    const known = e instanceof PreviewWriteError || e instanceof NotConfiguredError || e instanceof NotBoundError || e instanceof WalletRequiredError;
    sheet.set("failed", known ? "Not sent" : "Failed", known ? e.message : readableError(e), summary);
  }
}
function txLink(hash) {
  const url = explorer("tx", hash);
  return row("Transaction", url ? '<a class="app_a" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(shortHash(hash)) + "</a>" : esc(shortHash(hash)));
}

/* ---------- render all ---------- */
function renderAll() {
  renderDashboard();
  renderIdentity();
  renderCredentials();
  renderPolicies();
  renderDelegation();
  renderActivity();
  $$("[data-agent-name]").forEach((el) => { el.textContent = app.agent ? formatAgentId(app.agent.id) : "the selected agent"; });
  if (app.agent) fillPolicyForm();
  $$("[data-pick]").forEach((b) => b.classList.toggle("is-on", !!app.agent && String(app.agent.id) === b.getAttribute("data-pick")));
}

/* ---------- events ---------- */
function wire() {
  window.addEventListener("hashchange", () => showTab(currentTab()));
  // Menu links to another console tab only change the hash, so close the menu by hand.
  $$('.nav_menu a[href^="app.html#"]').forEach((a) => a.addEventListener("click", () => {
    const menu = $(".nav_menu");
    const button = $(".nav_button");
    if (menu && button && getComputedStyle(menu).display !== "none") setTimeout(() => button.click(), 60);
  }));

  document.addEventListener("click", async (e) => {
    const t = e.target;
    const copy = t.closest("[data-copy]");
    if (copy) {
      e.preventDefault();
      const ok = await copyText(copy.getAttribute("data-copy"));
      const old = copy.textContent;
      copy.textContent = ok ? "[ copied ]" : "[ copy failed ]";
      setTimeout(() => { copy.textContent = old; }, 1400);
      return;
    }
    const pick = t.closest("[data-pick]");
    if (pick) { selectAgent(pick.getAttribute("data-pick")); return; }
    if (t.closest("[data-wallet-connect]") || t.closest("[data-tx-connect]")) {
      if (wallet.status === "connected" && !isCorrectChain(wallet.chainId)) { trySwitch(); return; }
      if (wallet.status === "connected") return;
      try { await connect(); if (t.closest("[data-tx-connect]")) sheet.close(); }
      catch (err) { flash(wallet.error || readableError(err)); }
      return;
    }
    if (t.closest("[data-wallet-switch]") || t.closest("[data-net-switch]") || t.closest("[data-tx-switch]")) { trySwitch(); return; }
    if (t.closest("[data-wallet-disconnect]")) { await disconnect(); return; }
    if (t.closest("[data-wallet-copy]")) { await copyText(wallet.address || ""); flash("Address copied."); return; }
    if (t.closest("[data-tx-close]")) { sheet.close(); return; }
    const act = t.closest("[data-action]");
    if (act && app.agent) {
      const op = act.getAttribute("data-action");
      const a = app.agent;
      if (op === "revokeCredential") runWrite(op, { agentId: a.id, credentialId: Number(act.getAttribute("data-id")) }, [["Agent", formatAgentId(a.id)], ["Credential", "C" + String(act.getAttribute("data-id")).padStart(3, "0")]]);
      if (op === "revokeDelegation") runWrite(op, { agentId: a.id, delegationId: Number(act.getAttribute("data-id")) }, [["Agent", formatAgentId(a.id)], ["Delegation", act.getAttribute("data-id")]]);
      if (op === "setAgentStatus") runWrite(op, { agentId: a.id, status: act.getAttribute("data-status") }, [["Agent", formatAgentId(a.id)], ["New status", stateText(act.getAttribute("data-status"))]]);
      if (op === "setPolicyStatus") runWrite(op, { agentId: a.id, status: act.getAttribute("data-status") }, [["Agent", formatAgentId(a.id)], ["Policy", stateText(act.getAttribute("data-status"))]]);
      return;
    }
    const filt = t.closest("[data-filter]");
    if (filt) {
      app.activityFilter = filt.getAttribute("data-filter");
      $$("[data-filter]").forEach((b) => b.classList.toggle("is-on", b === filt));
      renderActivity();
    }
  });

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet.el && !sheet.el.hidden) sheet.close(); });

  $("[data-lookup]").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = e.target.elements.agent.value.trim();
    const err = $("[data-lookup-error]");
    if (!parseAgentId(v) && !isAddress(v)) { err.textContent = "Use an agent ID such as MEI0842 or a 0x key address."; err.hidden = false; return; }
    selectAgent(v);
  });

  $$("[data-form]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      clearErrors(form);
      const op = form.getAttribute("data-form");
      const built = FORMS[op](form);
      if (built) runWrite(op, built.input, built.summary);
    });
  });

  $("[data-verify-form]").addEventListener("submit", (e) => { e.preventDefault(); runVerify(e.target); });
}

async function trySwitch() {
  try { await switchNetwork(); flash("Switched to " + CHAIN.CHAIN_NAME + "."); }
  catch (err) { flash(readableError(err)); }
}

let flashTimer = null;
function flash(message) {
  let el = $(".app_flash");
  if (!el) { el = document.createElement("div"); el.className = "app_flash"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = message;
  el.classList.add("is-on");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove("is-on"), 2600);
}

/* ---------- boot ---------- */
async function boot() {
  wire();
  showTab(currentTab());
  try {
    app.ctx = await getSource();
  } catch (e) {
    $('[data-view="dashboard"]').innerHTML = emptySheet("CONSOLE UNAVAILABLE", readableError(e));
    return;
  }
  renderNotice();
  onWallet(() => { renderWallet(); if (currentTab() === "network") renderNetwork(); if (app.ctx.source.kind === "live") renderAgentList(); });
  renderNetwork();
  await renderAgentList();

  // Deep link from the landing check form: app.html?agent=MEI0842&action=pay&amount=1200#verify
  const q = new URLSearchParams(location.search);
  const qAgent = q.get("agent");
  let start = qAgent;
  if (!start) { try { start = localStorage.getItem("scrim.agent"); } catch (e) { start = null; } }
  if (!start && app.agents.length) start = String(app.agents[0].id);
  if (start) await selectAgent(start, { quiet: !qAgent });
  else renderAll();

  if (qAgent) {
    const form = $("[data-verify-form]");
    form.elements.agent.value = qAgent;
    const action = (q.get("action") || "").toLowerCase();
    if (ACTIONS.indexOf(action) >= 0) form.elements.action.value = action;
    if (q.get("amount")) form.elements.amount.value = q.get("amount");
    if (currentTab() === "verify") runVerify(form);
  }
  window.addEventListener("hashchange", () => { if (currentTab() === "network") renderNetwork(); });
}

boot();
