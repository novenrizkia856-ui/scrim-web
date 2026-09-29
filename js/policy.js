/* Deterministic authorization.
   Given an agent record (identity, credentials, policy, delegations) read from
   the registries, decide whether a requested action is permitted. The answer
   comes only from that state and the request; nothing is inferred or guessed,
   and an agent's own claims are never an input.

   Pure functions, no DOM and no network, so they run the same in the browser
   and in the node tests (test/policy.test.mjs). */

export const ACTIONS = ["pay", "swap", "trade", "contract"];
export const ACTION_LABEL = { pay: "Pay", swap: "Swap", trade: "Trade", contract: "Contract interaction" };

export const CREDENTIAL_TYPES = ["controller", "application", "capability", "delegation"];
export const CREDENTIAL_LABEL = {
  controller: "Verified controller",
  application: "Application credential",
  capability: "Capability credential",
  delegation: "Delegation credential"
};

/* ---------- agent IDs: MEI0842 on screen, 842 onchain ---------- */
export function parseAgentId(value) {
  const m = /^(?:mei)?\s*0*([0-9]{1,12})$/i.exec(String(value == null ? "" : value).trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}
export function formatAgentId(id) {
  return "MEI" + String(id).padStart(4, "0");
}
export function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value == null ? "" : value).trim());
}
export function sameAddress(a, b) {
  return isAddress(a) && isAddress(b) && a.toLowerCase() === b.toLowerCase();
}

/* ---------- time ---------- */
function toMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const t = Date.parse(value);
  return isNaN(t) ? null : t;
}
export function isExpired(expiresAt, now) {
  const t = toMs(expiresAt);
  return t !== null && t <= now;
}

/* ---------- state of single records ---------- */
export function credentialState(c, now) {
  if (!c) return "missing";
  if (c.revoked) return "revoked";
  if (isExpired(c.expiresAt, now)) return "expired";
  if (c.status && c.status !== "active") return c.status;
  return "active";
}
export function delegationState(d, now) {
  if (!d) return "missing";
  if (d.revoked || d.status === "revoked") return "revoked";
  if (isExpired(d.expiresAt, now)) return "expired";
  if (d.status && d.status !== "active") return d.status;
  return "active";
}
export function policyState(p, now) {
  if (!p) return "missing";
  if (p.status && p.status !== "active") return p.status;
  if (isExpired(p.expiresAt, now)) return "expired";
  return "active";
}

export function activeCredentials(agent, now) {
  return (agent.credentials || []).filter(function (c) { return credentialState(c, now) === "active"; });
}
export function activeDelegations(agent, now) {
  return (agent.delegations || []).filter(function (d) { return delegationState(d, now) === "active"; });
}

function money(n) {
  return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function lower(list) {
  return (list || []).map(function (x) { return String(x).toLowerCase(); });
}
function assetSymbols(policy) {
  return (policy.assets || []).map(function (a) { return typeof a === "string" ? a : a.symbol; });
}

/* ---------- the check ----------
   request: { action, amount?, asset?, protocol? }
   returns: { permitted, checks: [{ key, label, ok, detail }] }
   Every check is listed so a third party can see exactly which rule failed. */
export function evaluate(agent, request, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const req = request || {};
  const action = String(req.action || "").trim().toLowerCase();
  const amount = req.amount === "" || req.amount == null ? null : Number(req.amount);
  const asset = String(req.asset || "").trim();
  const protocol = String(req.protocol || "").trim();
  const checks = [];
  const add = function (key, label, ok, detail) { checks.push({ key: key, label: label, ok: !!ok, detail: detail }); };

  if (!agent) {
    add("identity", "Identity registered", false, "No identity found for this agent.");
    return { permitted: false, checks: checks };
  }

  add("identity", "Identity registered and active", agent.status === "active",
    agent.status === "active" ? "Identity " + formatAgentId(agent.id) + " is active." : "Identity status is " + (agent.status || "unknown") + ".");

  const controllerCred = (agent.credentials || []).find(function (c) { return c.type === "controller" && credentialState(c, now) === "active"; });
  add("controller", "Controller credential valid", !!controllerCred,
    controllerCred ? "Issued by " + (controllerCred.issuer || "issuer") + "." : "No active verified controller credential.");

  const p = agent.policy;
  const pState = policyState(p, now);
  add("policy", "Policy active", pState === "active", pState === "active" ? "Policy is active." : "Policy is " + pState + ".");

  const validAction = ACTIONS.indexOf(action) >= 0;
  const allowed = !!(p && validAction && lower(p.actions).indexOf(action) >= 0);
  add("action", "Action allowed", allowed,
    !validAction ? "Unknown action. Use pay, swap, trade or contract." : allowed ? ACTION_LABEL[action] + " is allowed." : ACTION_LABEL[action] + " is not in the policy.");

  if (asset) {
    const ok = !!(p && lower(assetSymbols(p)).indexOf(asset.toLowerCase()) >= 0);
    add("asset", "Asset approved", ok, ok ? asset + " is approved." : asset + " is not an approved asset.");
  }

  if (protocol) {
    const list = (p && p.protocols) || [];
    const ok = list.some(function (x) {
      return (x.address && sameAddress(x.address, protocol)) || (x.name && x.name.toLowerCase() === protocol.toLowerCase());
    });
    add("protocol", "Protocol approved", ok, ok ? "Protocol is approved." : "Protocol is not in the approved list.");
  }

  if (amount !== null) {
    const valid = isFinite(amount) && amount >= 0;
    const max = p ? Number(p.maxTransaction) : 0;
    const okTx = valid && !!p && amount <= max;
    add("maxTx", "Within transaction maximum", okTx,
      !valid ? "Amount is not a valid number." : p ? money(amount) + " against a " + money(max) + " maximum." : "No policy limit.");
    const daily = p ? Number(p.dailyLimit) : 0;
    const spent = p ? Number(p.spentToday || 0) : 0;
    const remaining = Math.max(daily - spent, 0);
    const okDay = valid && !!p && amount <= remaining;
    add("daily", "Within daily limit", okDay,
      p ? money(remaining) + " left of " + money(daily) + " today." : "No daily limit.");
  }

  const delegation = activeDelegations(agent, now).find(function (d) {
    return validAction && lower(d.permissions).indexOf(action) >= 0 && (amount === null || !d.spendLimit || amount <= Number(d.spendLimit));
  });
  add("delegation", "Delegation covers request", !!delegation,
    delegation ? "Delegation " + (delegation.ref || "") + " from the controller covers it." : "No active delegation covers this request.");

  return { permitted: checks.every(function (c) { return c.ok; }), checks: checks };
}

/* ---------- readable policy summary ---------- */
export function summarizePolicy(agent, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const p = agent && agent.policy;
  if (!p) return "No policy set. The agent may not act.";
  const state = policyState(p, now);
  const acts = (p.actions || []).map(function (a) { return (ACTION_LABEL[a] || a).toLowerCase(); });
  const parts = [];
  parts.push(formatAgentId(agent.id) + " may " + (acts.length ? joinList(acts) : "do nothing") + ".");
  parts.push("Each transaction is capped at " + money(p.maxTransaction) + ", and each day at " + money(p.dailyLimit) + ".");
  const assets = assetSymbols(p);
  if (assets.length) parts.push("Approved assets are " + joinList(assets) + ".");
  const protos = (p.protocols || []).map(function (x) { return x.name || x.address; });
  if (protos.length) parts.push("Approved protocols are " + joinList(protos) + ".");
  if (state !== "active") parts.push("This policy is " + state + ", so nothing is permitted.");
  return parts.join(" ");
}

function joinList(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}
