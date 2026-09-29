/* SCRIM configuration. This is the only file a deployment needs to touch.

   Token launch:
     Paste the token contract address into TOKEN_ADDRESS below. Nothing else.
     The landing page value, the Copy button and every other place read it.

   Contracts, after they are deployed to Robinhood Chain:
     1. Paste the four addresses into CONTRACTS.
     2. Set DEPLOYMENT_BLOCKS so event scans do not start at block 0.
     3. Drop each compiled ABI into abi/ (bare array or Foundry / Hardhat artifact).
     4. Map each operation to its contract function in js/bindings.js.
     5. Set APP_CONFIG.mode to "live".
   Until every piece is present the dapp stays in preview mode on its own and
   the Network tab lists what is missing. Preview data is never shown as chain state. */

// TOKEN CA — CHANGE ONLY THIS LINE WHEN TOKEN LAUNCHES
export const TOKEN_ADDRESS = "";

export const APP_CONFIG = {
  // "preview": the dapp reads the sample agents in data/preview.json, clearly marked.
  // "live": the dapp reads and writes the SCRIM registries on Robinhood Chain.
  mode: "preview",

  // Confirmations to wait for before a write is shown as confirmed.
  confirmations: 1
};

export const CHAIN = {
  // SCRIM_DEPLOYMENT: confirm these against the network the contracts use.
  CHAIN_ID: 4663,
  CHAIN_NAME: "Robinhood Chain",
  RPC_URL: "https://rpc.mainnet.chain.robinhood.com",
  BLOCK_EXPLORER_URL: "https://robinhoodchain.blockscout.com",
  NATIVE_CURRENCY: { name: "Ether", symbol: "ETH", decimals: 18 }
};

export const CONTRACTS = {
  // SCRIM_DEPLOYMENT: insert the deployed MachineIdentityRegistry address.
  machineIdentityRegistry: "",

  // SCRIM_DEPLOYMENT: insert the deployed CredentialRegistry address.
  credentialRegistry: "",

  // SCRIM_DEPLOYMENT: insert the deployed DelegationRegistry address.
  delegationRegistry: "",

  // SCRIM_DEPLOYMENT: insert the deployed PolicyRegistry address.
  policyRegistry: ""
};

// Block each contract was deployed in. Event scans start here instead of block 0.
export const DEPLOYMENT_BLOCKS = {
  machineIdentityRegistry: 0,
  credentialRegistry: 0,
  delegationRegistry: 0,
  policyRegistry: 0
};

// Where each ABI lives. A bare ABI array or a compiler artifact with an "abi" field.
export const ABI_PATHS = {
  machineIdentityRegistry: "abi/MachineIdentityRegistry.json",
  credentialRegistry: "abi/CredentialRegistry.json",
  delegationRegistry: "abi/DelegationRegistry.json",
  policyRegistry: "abi/PolicyRegistry.json"
};

// Human names for the four registries, used across the UI.
export const MODULES = {
  machineIdentityRegistry: "MachineIdentityRegistry",
  credentialRegistry: "CredentialRegistry",
  delegationRegistry: "DelegationRegistry",
  policyRegistry: "PolicyRegistry"
};

// Sample agents shown in preview mode. js/contracts.js is the only reader.
export const PREVIEW_DATA = "data/preview.json";

// Library used for ABI encoding in live mode only. Preview mode never loads it.
export const ETHERS_URL = "https://cdn.jsdelivr.net/npm/ethers@6.13.4/+esm";
