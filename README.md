# SCRIM web

**Machines are becoming economic entities. Give them an identity.**
SCRIM is a Machine Economic Identity layer for autonomous agents on Robinhood
Chain: a persistent identity, credentials, permissions and delegation, with
authorization decided from contract state only.

This repository is the website and the dapp. It is static HTML, CSS and
JavaScript with no build step and no backend.

## Pages

| Page | What it is |
| --- | --- |
| `index.html` | Landing page. The client reference (DICH Webflow site) with SCRIM copy; the token CA bar sits at the top of the hero |
| `app.html` | Console: Dashboard, Identity, Credentials, Policies, Delegation, Verify, Activity, Network |

Deep link into the verifier: `app.html?agent=MEI0842&action=pay&amount=1200#verify`.
The landing page `verify_agent` form opens exactly that.

## Token CA: one line

```js
// js/config.js
// TOKEN CA — CHANGE ONLY THIS LINE WHEN TOKEN LAUNCHES
export const TOKEN_ADDRESS = "";
```

The CA bar is the first thing in the hero, right under the top notch of the
frame. Empty, `null` or blank shows **Coming soon** and disables Copy. Any other value
is shown exactly as written, and Copy copies exactly that. Nothing else in the
repo holds the address; `test/config.test.mjs` fails if a second copy appears.
`js/config.js` is served with `Cache-Control: no-cache`, so a redeploy shows the
new address at once.

## Design source

The landing page is the client reference kept as is: markup, Webflow
interactions (IX2), GSAP, SplitType scramble text, Lenis, Spline scenes, the
Unicorn Studio background, sounds and imagery. Only copy, links and product
pieces changed. Every asset is served from this repo.

- `css/template.css` is the reference stylesheet, verbatim, with asset URLs
  pointed at local files. Do not edit it; override in `css/scrim.css`.
- `js/webflow/` is the reference Webflow runtime (interactions live there,
  keyed by the `data-w-id` attributes in the markup). `js/vendor/` holds the
  libraries the reference loaded from CDNs, pinned to the same versions.
- `assets/3d/` holds the two Spline scenes and the Unicorn Studio project.
  The Spline runtime itself still loads from jsDelivr, as in the reference.
- The console reuses the reference vocabulary: the frame and menu, the idea
  modal sheet and its floating label fields, the CTA button, T 012 headings,
  NB Architekt labels, dotted frames and blinking blocks.

## Performance notes

- The preloader Lottie carried two PNGs; they are WebP now (1.96 MB to 272 KB, same pixels).
- Gallery portraits and drop avatars are resized to about twice their largest display size.
- Sounds use `preload="none"`: the 3.6 MB music loads only once the visitor turns sound on.
- The three display fonts are preloaded. `js/vendor`, `js/webflow` and `assets` get long cache headers.
- Kept on purpose: three.js loads eagerly because the second section's card image is its WebGL canvas.

## Code map

```
js/config.js     the only file a deployment edits: TOKEN_ADDRESS, mode, chain, addresses, ABI paths
js/contracts.js  operations, PreviewSource and LiveSource, per registry readiness, loadAgent
js/bindings.js   operation to contract function map (all null until the ABIs exist)
js/policy.js     deterministic authorization: evaluate(agent, request) and the policy summary
js/web3.js       wallet (EIP 1193 / 6963), network switch, public RPC, transaction tracking
js/app.js        console screens, forms, validation and the transaction sheet
js/landing.js    token CA block and the verify_agent form on the landing page
data/preview.json  three fictional agents for preview mode, marked as such everywhere
abi/*.json       placeholder ABIs ([]) until the contracts are compiled
```

Screens never touch addresses, ABIs or ethers. They ask for an operation
(`getAgent`, `issueCredential` ...) and `js/contracts.js` answers from preview
data or from the chain.

## Authorization is deterministic

`js/policy.js` checks, in order: identity active, verified controller
credential, policy active and unexpired, action allowed, asset approved,
protocol approved, amount within the transaction maximum, amount within what is
left of the daily limit, and an active delegation from the controller covering
the request. Every rule is listed with pass or fail. If the PolicyRegistry
exposes a verdict (`checkAuthorization` binding), the console shows the contract
verdict as well. Nothing is inferred by a model and nothing the agent claims is
an input.

## Preview mode and live mode

**Preview** (today): the contracts are not deployed. The console reads
`data/preview.json`, labels every panel "Preview data", and refuses every
write with a "Not sent" state. No transaction hash, block or contract address is
invented.

**Live** needs `APP_CONFIG.mode = "live"`, a configured MachineIdentityRegistry
(address and ABI), and the RPC answering as chain 4663. Each other registry is
checked on its own: an unconfigured one shows "Not configured" next to its
buttons and its reads and writes never run. The Network tab lists what is
missing.

## Going live after deployment

1. Paste the four addresses into `CONTRACTS` in `js/config.js` and the deploy
   blocks into `DEPLOYMENT_BLOCKS`. Confirm `CHAIN`.
2. Replace each file in `abi/` with the compiled ABI.
3. Fill `BINDINGS` in `js/bindings.js`. The input of every operation and the
   shape every read must return are documented there and at the end of
   `js/contracts.js`.
4. Set `APP_CONFIG.mode = "live"`, run the checks, deploy.

Unbound operations show "not wired yet" instead of failing silently, so a
partial wiring is safe to ship. ethers v6 loads from jsDelivr only in live mode.

## Product boundaries

SCRIM is identity and authorization. There is no chatbot, trading bot,
investment feature, agent marketplace, social feed or token sale. The landing
page only displays the official token address.

## Checks

```bash
npm run check
```

Copy rules (no hyphens or dashes in visible copy, no sentence over 15 words)
and unit tests for the authorization rules and the single TOKEN_ADDRESS source.

```bash
node tools/check-browser.mjs --shots
```

Serves the site on a throwaway port, opens every page and console tab in
headless Chrome at 1440 px and 390 px, and fails on console errors, uncaught
exceptions, failed requests or horizontal overflow. Screenshots go to
`work/shots/` (git ignored).

## Local preview

```bash
python -m http.server 5310 --directory .
```

## Open items

- **Fonts.** T 012, NB Architekt, Druk Wide and FK Raster Grotesk (a trial
  build) came with the reference. Confirm SCRIM holds web licences before
  launch, or swap the files in `assets/fonts/`.
- **Imagery, 3D and sound.** Photos, Spline scenes, the Unicorn Studio
  background and the music come from the reference site. Confirm usage rights.
- **Robinhood Chain values.** Chain 4663, RPC and explorer match the other
  Robinhood Chain projects; confirm them against the deployment network.
