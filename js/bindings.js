/* Bindings from dapp operations to the SCRIM contracts.

   The contracts are still being written, so no function signature is guessed
   here: every binding starts as null and the Network tab lists what is left.
   An unbound read shows "not wired yet"; an unbound write is never sent.

   When the ABIs land in abi/, fill each entry with one of:

     { fn: "functionName", args: (input) => [...], map: (result, input) => shape }
         a single call or write. args() may throw to reject bad input
         before the wallet opens.
     { event: "EventName", filter: (input) => [...], map: (log, input) => shape }
         a read built from events, scanned from DEPLOYMENT_BLOCKS.
     { call: async (live, input) => shape }
         anything that needs several calls; live.contract(key) returns an
         ethers Contract for that registry.

   The shapes each read must return are listed at the end of js/contracts.js.
   `input` is what the screens pass:

     getAgent               { agent }                  ID (842 or MEI0842) or agent key address
     listAgentsByController { controller }
     registerAgent          { agentKey, controller, label, application, metadataURI }
     setAgentStatus         { agentId, status }        "active" | "suspended"
     getCredentials         { agentId }
     issueCredential        { agentId, type, expiresAt, reference }
     revokeCredential       { agentId, credentialId }
     getPolicy              { agentId }
     setPolicy              { agentId, actions, assets, protocols, maxTransaction, dailyLimit, expiresAt }
     setPolicyStatus        { agentId, status }        "active" | "paused"
     checkAuthorization     { agentId, action, asset, amount, protocol }   optional
     getDelegations         { agentId }
     grantDelegation        { agentId, permissions, spendLimit, expiresAt }
     revokeDelegation       { agentId, delegationId }
     getActivity            { agentId }

   Amounts arrive as USD numbers and dates as ISO strings or null. Convert them
   to the units the contracts use (token decimals, unix seconds) inside args(). */
export const BINDINGS = {
  getAgent: null,
  listAgentsByController: null,
  registerAgent: null,
  setAgentStatus: null,
  getCredentials: null,
  issueCredential: null,
  revokeCredential: null,
  getPolicy: null,
  setPolicy: null,
  setPolicyStatus: null,
  checkAuthorization: null,
  getDelegations: null,
  grantDelegation: null,
  revokeDelegation: null,
  getActivity: null
};
