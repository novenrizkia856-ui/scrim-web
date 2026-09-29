/* Wallet and network layer. No library: browser wallets speak EIP-1193, and
   EIP-6963 lets several installed wallets announce themselves. Public reads go
   straight to the Robinhood Chain RPC with fetch, so the site works without a
   wallet. Contract encoding lives in js/contracts.js, not here. */
import { CHAIN, APP_CONFIG } from "./config.js";

const REMEMBER_KEY = "scrim.wallet.connected";
const listeners = new Set();
const announced = new Map();

export const wallet = {
  status: "idle", // idle | unavailable | disconnected | connecting | connected
  address: null,
  chainId: null,
  provider: null,
  providerName: null,
  error: null
};

function emit() {
  listeners.forEach(function (fn) {
    try { fn(wallet); } catch (e) { console.error(e); }
  });
}

export function onWallet(fn) {
  listeners.add(fn);
  fn(wallet);
  return function () { listeners.delete(fn); };
}

function set(patch) {
  Object.assign(wallet, patch);
  emit();
}

/* ---------- helpers ---------- */
export function shortAddress(address) {
  if (!address) return "";
  return address.slice(0, 6) + "…" + address.slice(-4);
}

export function shortHash(hash) {
  if (!hash) return "";
  return hash.length > 18 ? hash.slice(0, 10) + "…" + hash.slice(-6) : hash;
}

export function toHexChainId(id) {
  return "0x" + Number(id).toString(16);
}

export function isCorrectChain(chainId) {
  return chainId != null && Number(chainId) === Number(CHAIN.CHAIN_ID);
}

export function explorer(kind, value) {
  if (!value || !CHAIN.BLOCK_EXPLORER_URL) return null;
  const base = CHAIN.BLOCK_EXPLORER_URL.replace(/\/$/, "");
  const path = { tx: "/tx/", address: "/address/", block: "/block/" }[kind];
  return path ? base + path + value : null;
}

/* ---------- public RPC (no wallet needed) ---------- */
let rpcId = 0;
export async function rpc(method, params, options) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, (options && options.timeout) || 8000);
  try {
    const res = await fetch(CHAIN.RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: method, params: params || [] }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error("RPC returned status " + res.status);
    const body = await res.json();
    if (body.error) throw new Error(body.error.message || "RPC error");
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function latestBlock() {
  const hex = await rpc("eth_blockNumber");
  return parseInt(hex, 16);
}

/* ---------- provider discovery ---------- */
function discover() {
  window.addEventListener("eip6963:announceProvider", function (event) {
    const d = event.detail;
    if (d && d.info && d.provider) announced.set(d.info.uuid, d);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function pickProvider() {
  if (announced.size) {
    const list = Array.from(announced.values());
    const preferred = list.find(function (d) { return /metamask/i.test(d.info.name); }) || list[0];
    return { provider: preferred.provider, name: preferred.info.name };
  }
  if (window.ethereum) {
    const eth = window.ethereum;
    const name = eth.isMetaMask ? "MetaMask" : eth.isCoinbaseWallet ? "Coinbase Wallet" : eth.isRabby ? "Rabby" : "Browser wallet";
    return { provider: eth, name: name };
  }
  return null;
}

function attach(provider) {
  if (!provider || provider.__scrimAttached) return;
  provider.__scrimAttached = true;
  if (typeof provider.on !== "function") return;
  provider.on("accountsChanged", function (accounts) {
    if (!accounts || !accounts.length) {
      forget();
      set({ status: "disconnected", address: null });
    } else {
      set({ status: "connected", address: accounts[0] });
    }
  });
  provider.on("chainChanged", function (id) {
    set({ chainId: parseInt(id, 16) });
  });
  provider.on("disconnect", function () {
    set({ status: "disconnected", address: null });
  });
}

function remember() { try { localStorage.setItem(REMEMBER_KEY, "1"); } catch (e) {} }
function forget() { try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {} }
function remembered() { try { return localStorage.getItem(REMEMBER_KEY) === "1"; } catch (e) { return false; } }

/* ---------- connect / disconnect ---------- */
export async function connect() {
  const found = pickProvider();
  if (!found) {
    set({ status: "unavailable", error: "No browser wallet found. Install a wallet such as MetaMask." });
    throw new Error(wallet.error);
  }
  attach(found.provider);
  set({ status: "connecting", provider: found.provider, providerName: found.name, error: null });
  try {
    const accounts = await found.provider.request({ method: "eth_requestAccounts" });
    const chainHex = await found.provider.request({ method: "eth_chainId" });
    remember();
    set({ status: accounts && accounts.length ? "connected" : "disconnected", address: accounts[0] || null, chainId: parseInt(chainHex, 16) });
    return wallet;
  } catch (err) {
    set({ status: "disconnected", error: readableError(err) });
    throw err;
  }
}

export async function disconnect() {
  forget();
  const p = wallet.provider;
  if (p) {
    try { await p.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); } catch (e) { /* not every wallet supports it */ }
  }
  set({ status: "disconnected", address: null });
}

async function restore() {
  const found = pickProvider();
  if (!found) { set({ status: "unavailable" }); return; }
  attach(found.provider);
  set({ provider: found.provider, providerName: found.name });
  if (!remembered()) { set({ status: "disconnected" }); return; }
  try {
    const accounts = await found.provider.request({ method: "eth_accounts" });
    const chainHex = await found.provider.request({ method: "eth_chainId" });
    set({ status: accounts && accounts.length ? "connected" : "disconnected", address: (accounts && accounts[0]) || null, chainId: parseInt(chainHex, 16) });
  } catch (e) {
    set({ status: "disconnected" });
  }
}

/* ---------- network ---------- */
export function chainParams() {
  return {
    chainId: toHexChainId(CHAIN.CHAIN_ID),
    chainName: CHAIN.CHAIN_NAME,
    nativeCurrency: CHAIN.NATIVE_CURRENCY,
    rpcUrls: [CHAIN.RPC_URL],
    blockExplorerUrls: CHAIN.BLOCK_EXPLORER_URL ? [CHAIN.BLOCK_EXPLORER_URL] : []
  };
}

export async function switchNetwork() {
  const p = wallet.provider || (pickProvider() || {}).provider;
  if (!p) throw new Error("No browser wallet found");
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHexChainId(CHAIN.CHAIN_ID) }] });
  } catch (err) {
    // 4902: the wallet does not know the chain yet, so add it (which also switches).
    const code = err && (err.code || (err.data && err.data.originalError && err.data.originalError.code));
    if (code === 4902 || /unrecognized|not added|unknown chain/i.test(String(err && err.message))) {
      await p.request({ method: "wallet_addEthereumChain", params: [chainParams()] });
    } else {
      throw err;
    }
  }
  const chainHex = await p.request({ method: "eth_chainId" });
  set({ chainId: parseInt(chainHex, 16) });
}

/* ---------- transactions ---------- */
/* Watches a submitted transaction through the public RPC and reports
   { status: "pending" | "confirmed" | "failed", hash, receipt, error }. */
export function trackTransaction(hash, onUpdate, options) {
  const confirmations = (options && options.confirmations) || APP_CONFIG.confirmations || 1;
  let stopped = false;
  onUpdate({ status: "pending", hash: hash });
  (async function poll() {
    const started = Date.now();
    while (!stopped) {
      try {
        const receipt = await rpc("eth_getTransactionReceipt", [hash]);
        if (receipt && receipt.blockNumber) {
          if (receipt.status === "0x0") { onUpdate({ status: "failed", hash: hash, receipt: receipt, error: "The transaction reverted onchain." }); return; }
          const head = await latestBlock();
          const depth = head - parseInt(receipt.blockNumber, 16) + 1;
          if (depth >= confirmations) { onUpdate({ status: "confirmed", hash: hash, receipt: receipt, block: parseInt(receipt.blockNumber, 16) }); return; }
        }
      } catch (e) { /* keep polling through transient RPC errors */ }
      if (Date.now() - started > 10 * 60 * 1000) { onUpdate({ status: "failed", hash: hash, error: "No receipt after ten minutes. Check the explorer." }); return; }
      await new Promise(function (r) { setTimeout(r, 2500); });
    }
  })();
  return function stop() { stopped = true; };
}

export function readableError(err) {
  if (!err) return "Something went wrong.";
  if (err.code === 4001 || err.code === "ACTION_REJECTED") return "Request rejected in the wallet.";
  if (err.code === -32002) return "The wallet already has a pending request. Open it to continue.";
  const msg = (err.shortMessage || err.reason || err.message || String(err)).replace(/\s*\(.*$/s, "");
  return msg.length > 140 ? msg.slice(0, 140) + "…" : msg;
}

if (typeof window !== "undefined") {
  discover();
  setTimeout(restore, 120);
}
