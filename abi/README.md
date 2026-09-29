# ABIs

One file per SCRIM registry. Each holds `[]` until the contracts are compiled.

| File | Contract |
| --- | --- |
| `MachineIdentityRegistry.json` | agent identities, controllers, status |
| `CredentialRegistry.json` | credentials: issue, revoke, expiry |
| `PolicyRegistry.json` | actions, assets, protocols, limits |
| `DelegationRegistry.json` | controller to agent delegations |

Drop in either a bare ABI array or a Foundry / Hardhat artifact (an object with
an `abi` field). Then map the operations in `js/bindings.js`.
A registry with an empty ABI counts as not configured, even with an address.
