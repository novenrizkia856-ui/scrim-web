/* Contract adapters.
   Screens ask for operations ("getAgent", "issueCredential", ...) and never touch
   ABIs, addresses or ethers directly. Two sources implement the operations:

     PreviewSource  reads data/preview.json. Every record carries preview: true,
                    has no transaction or block, and every write is refused.
     LiveSource     calls the SCRIM registries on Robinhood Chain through the
                    function or event named in js/bindings.js.

   A registry with no address or no ABI is "not configured": its reads return
   nothing and its writes are refused before a wallet ever opens. */
import { APP_CONFIG, CHAIN, CONTRACTS, ABI_PATHS, MODULES, DEPLOYMENT_BLOCKS, ETHERS_URL, PREVIEW_DATA } from "./config.js";
import { BINDINGS } from "./bindings.js";
import { wallet, isCorrectChain, rpc, trackTransaction, readableError } from "./web3.js";
import { parseAgentId, isAddress, sameAddress } from "./policy.js";
export { BINDINGS };

/* ---------- the operations the dapp needs ---------- */
export const OPERATIONS = {
  // MachineIdentityRegistry
  getAgent: { contract: "machineIdentityRegistry", kind: "read", label: "Read an agent identity by ID or key address" },
  listAgentsByController: { contract: "machineIdentityRegistry", kind: "read", label: "List agents a controller owns" },
  registerAgent: { contract: "machineIdentityRegistry", kind: "write", label: "Register an agent identity" },
  setAgentStatus: { contract: "machineIdentityRegistry", kind: "write", label: "Suspend or reactivate an identity" },
  // CredentialRegistry
  getCredentials: { contract: "credentialRegistry", kind: "read", label: "List credentials for an agent" },
  issueCredential: { contract: "credentialRegistry", kind: "write", label: "Issue a credential" },
  revokeCredential: { contract: "credentialRegistry", kind: "write", label: "Revoke a credential" },
  // PolicyRegistry
  getPolicy: { contract: "policyRegistry", kind: "read", label: "Read an agent policy" },
  setPolicy: { contract: "policyRegistry", kind: "write", label: "Set an agent policy" },
  setPolicyStatus: { contract: "policyRegistry", kind: "write", label: "Pause or resume a policy" },
  checkAuthorization: { contract: "policyRegistry", kind: "read", label: "Ask the policy contract for a verdict", optional: true },
  // DelegationRegistry
  getDelegations: { contract: "delegationRegistry", kind: "read", label: "List delegations for an agent" },
  grantDelegation: { contract: "delegationRegistry", kind: "write", label: "Grant a delegation" },
  revokeDelegation: { contract: "delegationRegistry", kind: "write", label: "Revoke a delegation" },
  // Events across all four registries
  getActivity: { contract: "machineIdentityRegistry", kind: "read", label: "Read agent activity from registry events" }
};

/* ---------- errors the UI renders as states, not crashes ---------- */
export class NotConfiguredError extends Error {
  constructor(key) { super(MODULES[key] + " is not configured yet. Nothing was sent."); this.name = "NotConfiguredError"; this.key = key; }
}
export class NotBoundError extends Error {
  constructor(op) { super(OPERATIONS[op].label + " is not wired to the contract yet."); this.name = "NotBoundError"; this.op = op; }
}
export class PreviewWriteError extends Error {
  constructor(op) {
    super("Contracts are not deployed yet. Preview mode sends nothing.");
    this.name = "PreviewWriteError"; this.op = op;
  }
}
export class WalletRequiredError extends Error {
  constructor(msg) { super(msg); this.name = "WalletRequiredError"; }
}

/* ---------- ABI loading ---------- */
let abiCache = null;
export async function loadAbis() {
  if (abiCache) return abiCache;
  const entries = await Promise.all(Object.keys(ABI_PATHS).map(async function (key) {
    try {
      const res = await fetch(ABI_PATHS[key], { cache: "no-cache" });
      if (!res.ok) return [key, []];
      const json = await res.json();
      return [key, Array.isArray(json) ? json : Array.isArray(json.abi) ? json.abi : []];
    } catch (e) {
      return [key, []];
    }
  }));
  abiCache = Object.fromEntries(entries);
  return abiCache;
}

/* ---------- mode and per registry readiness ---------- */
export async function resolveMode() {
  const abis = await loadAbis();
  const contracts = {};
  Object.keys(CONTRACTS).forEach(function (key) {
    const address = String(CONTRACTS[key] || "").trim();
    const addressOk = isAddress(address);
    const abiOk = !!(abis[key] && abis[key].length);
    contracts[key] = { key: key, name: MODULES[key], address: addressOk ? address : "", addressOk: addressOk, abiOk: abiOk, ready: addressOk && abiOk };
  });
  const checks = [
    { label: 'APP_CONFIG.mode set to "live"', ok: APP_CONFIG.mode === "live" },
    { label: "Robinhood Chain ID and RPC set", ok: !!(CHAIN.CHAIN_ID && CHAIN.RPC_URL) },
    { label: MODULES.machineIdentityRegistry + " address and ABI", ok: contracts.machineIdentityRegistry.ready }
  ];
  const unbound = Object.keys(OPERATIONS).filter(function (op) { return !BINDINGS[op] && !OPERATIONS[op].optional; });
  const ready = checks.every(function (c) { return c.ok; });
  return { mode: ready ? "live" : "preview", requested: APP_CONFIG.mode, checks: checks, contracts: contracts, unbound: unbound, abis: abis };
}

/* ---------- ethers (live mode only) ---------- */
let ethersPromise = null;
export function loadEthers() {
  if (!ethersPromise) ethersPromise = import(ETHERS_URL).catch(function (e) { ethersPromise = null; throw e; });
  return ethersPromise;
}

/* ---------- preview source ---------- */
class PreviewSource {
  constructor(data) { this.kind = "preview"; this.data = data; }

  find(ref) {
    const list = this.data.agents;
    const id = parseAgentId(ref);
    if (id) return list.find(function (a) { return a.id === id; }) || null;
    if (isAddress(ref)) return list.find(function (a) { return sameAddress(a.agentKey, ref); }) || null;
    return null;
  }

  identity(a) {
    if (!a) return null;
    return { id: a.id, agentKey: a.agentKey, controller: a.controller, label: a.label, application: a.application, metadataURI: a.metadataURI,
      status: a.status, createdAt: a.createdAt, verifiedActions: a.stats ? a.stats.verifiedActions : null, tx: null, block: null, preview: true };
  }

  async read(op, input) {
    const a = input && (input.agentId != null ? this.find(input.agentId) : input.agent != null ? this.find(input.agent) : null);
    switch (op) {
      case "getAgent": return this.identity(a);
      case "listAgentsByController": {
        const self = this;
        return this.data.agents.filter(function (x) { return sameAddress(x.controller, input.controller); }).map(function (x) { return self.identity(x); });
      }
      case "getCredentials": return a ? a.credentials.map(function (c) { return Object.assign({ agentId: a.id, tx: null, block: null, preview: true }, c); }) : [];
      case "getPolicy": return a && a.policy ? Object.assign({ agentId: a.id, tx: null, block: null, preview: true }, a.policy) : null;
      case "getDelegations": return a ? a.delegations.map(function (d) { return Object.assign({ agentId: a.id, agent: a.agentKey, tx: null, block: null, preview: true }, d); }) : [];
      case "getActivity": return a ? a.activity.map(function (e) { return Object.assign({ agentId: a.id, tx: null, block: null, preview: true }, e); }) : [];
      case "checkAuthorization": return null; // no contract verdict in preview; the UI evaluates the preview state
      default: throw new Error("Unknown read " + op);
    }
  }

  async write(op) { throw new PreviewWriteError(op); }

  agentIds() { return this.data.agents.map(function (a) { return a.id; }); }
}

/* ---------- live source ---------- */
class LiveSource {
  constructor(state) { this.kind = "live"; this.state = state; this.abis = state.abis; this.readProvider = null; }

  async provider() {
    if (this.readProvider) return this.readProvider;
    const ethers = await loadEthers();
    this.readProvider = new ethers.JsonRpcProvider(CHAIN.RPC_URL, Number(CHAIN.CHAIN_ID), { staticNetwork: true });
    return this.readProvider;
  }

  async contract(key, runner) {
    if (!this.state.contracts[key].ready) throw new NotConfiguredError(key);
    const ethers = await loadEthers();
    return new ethers.Contract(CONTRACTS[key], this.abis[key], runner || (await this.provider()));
  }

  async read(op, input) {
    const key = OPERATIONS[op].contract;
    if (!this.state.contracts[key].ready) throw new NotConfiguredError(key);
    const b = BINDINGS[op];
    if (!b) {
      if (OPERATIONS[op].optional) return null;
      throw new NotBoundError(op);
    }
    if (b.call) return b.call(this, input);
    const c = await this.contract(key);
    if (b.event) {
      const filter = c.filters[b.event].apply(null, b.filter ? b.filter(input) : []);
      const logs = await c.queryFilter(filter, DEPLOYMENT_BLOCKS[key] || 0, "latest");
      return logs.map(function (log) { return b.map(log, input); });
    }
    const result = await c[b.fn].apply(null, b.args ? b.args(input) : []);
    return b.map ? b.map(result, input) : result;
  }

  /* Sends a write and reports its lifecycle through onUpdate:
     { status: "signing" | "pending" | "confirmed" | "failed", hash, error } */
  async write(op, input, onUpdate) {
    const key = OPERATIONS[op].contract;
    if (!this.state.contracts[key].ready) throw new NotConfiguredError(key);
    const b = BINDINGS[op];
    if (!b || !b.fn) throw new NotBoundError(op);
    if (wallet.status !== "connected" || !wallet.provider) throw new WalletRequiredError("Connect a wallet to send this transaction.");
    if (!isCorrectChain(wallet.chainId)) throw new WalletRequiredError("Switch the wallet to " + CHAIN.CHAIN_NAME + " first.");
    const ethers = await loadEthers();
    const signer = await new ethers.BrowserProvider(wallet.provider).getSigner();
    const c = await this.contract(key, signer);
    let args;
    try {
      args = b.args ? b.args(input) : [];
    } catch (err) {
      onUpdate({ status: "failed", error: err.message });
      throw err;
    }
    onUpdate({ status: "signing" });
    let tx;
    try {
      tx = await c[b.fn].apply(null, args);
    } catch (err) {
      onUpdate({ status: "failed", error: readableError(err) });
      throw err;
    }
    return new Promise(function (resolve) {
      trackTransaction(tx.hash, function (u) {
        onUpdate(u);
        if (u.status !== "pending") resolve(u);
      });
    });
  }

  agentIds() { return []; }
}

/* ---------- entry point ---------- */
let sourcePromise = null;
export function getSource() {
  if (!sourcePromise) {
    sourcePromise = (async function () {
      const state = await resolveMode();
      if (state.mode === "live") {
        // The RPC must really be the configured chain before anything is read as chain state.
        try {
          const id = parseInt(await rpc("eth_chainId"), 16);
          if (id !== Number(CHAIN.CHAIN_ID)) throw new Error("RPC reports chain " + id);
          return { source: new LiveSource(state), state: state };
        } catch (e) {
          state.mode = "preview";
          state.checks.push({ label: "RPC answers as chain " + CHAIN.CHAIN_ID + " (" + readableError(e) + ")", ok: false });
        }
      }
      const res = await fetch(PREVIEW_DATA, { cache: "no-cache" });
      if (!res.ok) throw new Error("Preview data did not load.");
      return { source: new PreviewSource(await res.json()), state: state };
    })();
  }
  return sourcePromise;
}

/* Whether a write can be sent right now, and if not, why. The screens show the
   reason next to the button, so an unavailable action is visible before a click. */
export function writeAvailability(op, ctx) {
  const key = OPERATIONS[op].contract;
  if (ctx.state.mode !== "live") return { ok: false, code: "preview", reason: "Preview mode. " + MODULES[key] + " is not deployed yet, so nothing is sent." };
  if (!ctx.state.contracts[key].ready) return { ok: false, code: "config", reason: MODULES[key] + " is not configured. Nothing will be sent." };
  if (!BINDINGS[op]) return { ok: false, code: "unbound", reason: OPERATIONS[op].label + " is not wired yet." };
  if (wallet.status !== "connected") return { ok: false, code: "wallet", reason: "Connect a wallet to send this." };
  if (!isCorrectChain(wallet.chainId)) return { ok: false, code: "network", reason: "Switch the wallet to " + CHAIN.CHAIN_NAME + "." };
  return { ok: true, code: "ready", reason: "Ready. Your wallet will ask you to sign." };
}

/* One agent, assembled from all four registries. Missing registries leave their
   part empty and are listed in `gaps`, so the screens can say what is unknown. */
export async function loadAgent(ctx, ref) {
  const src = ctx.source;
  const identity = await src.read("getAgent", { agent: ref });
  if (!identity) return null;
  const input = { agentId: identity.id, agent: identity.agentKey };
  const gaps = [];
  async function part(op, fallback) {
    try { return await src.read(op, input); }
    catch (e) { gaps.push({ op: op, message: e.message }); return fallback; }
  }
  const credentials = await part("getCredentials", []);
  const policy = await part("getPolicy", null);
  const delegations = await part("getDelegations", []);
  const activity = await part("getActivity", []);
  return Object.assign({}, identity, { credentials: credentials || [], policy: policy, delegations: delegations || [], activity: activity || [], gaps: gaps });
}

/* ---------- shapes the screens render ----------
   Identity    { id, agentKey, controller, label, application, metadataURI, status, createdAt, tx, block }
               status: "active" | "suspended" | "revoked"
   Credential  { id, agentId, type, issuer, issuerAddress, issuedAt, expiresAt, revoked, reference, tx, block }
               type: "controller" | "application" | "capability" | "delegation"
   Policy      { agentId, actions[], assets[{ symbol, address }], protocols[{ name, address }],
                 maxTransaction, dailyLimit, spentToday, expiresAt, status, updatedAt, tx, block }
               status: "active" | "paused"
   Delegation  { id, ref, agentId, controller, agent, permissions[], spendLimit, expiresAt, status, revoked, createdAt, tx, block }
   Activity    { type, at, detail, amount?, tx, block }
               type: identity_created | credential_issued | credential_revoked | delegation_granted |
                     delegation_revoked | policy_changed | tx_authorized | tx_rejected | activity_attested
   Verdict     { permitted, reason? }  (checkAuthorization, optional)
   Timestamps may be ISO strings or unix seconds. Amounts are USD numbers. */
