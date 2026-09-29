/* Landing page additions on top of the reference motion scripts:
   the token CA block and the "verify_agent" modal, which opens the verifier
   in the dapp instead of posting a form anywhere. */
import { TOKEN_ADDRESS } from "./config.js";
import { tokenAddress, copyText } from "./token.js";

/* ---------- token CA ---------- */
function renderCa() {
  const address = tokenAddress(TOKEN_ADDRESS);
  document.querySelectorAll("[data-ca]").forEach(function (block) {
    const value = block.querySelector("[data-ca-value]");
    const button = block.querySelector("[data-ca-copy]");
    const label = block.querySelector("[data-ca-copy-label]");
    block.setAttribute("data-ca-state", address ? "live" : "soon");
    value.textContent = address || "Coming soon";
    if (address) value.setAttribute("title", address);
    button.disabled = !address;
    button.setAttribute("aria-disabled", address ? "false" : "true");
    let timer = null;
    button.addEventListener("click", async function (event) {
      event.preventDefault();
      const current = tokenAddress(TOKEN_ADDRESS);
      if (!current) return; // nothing to copy until the token launches
      const ok = await copyText(current);
      label.textContent = ok ? "Copied" : "Copy failed";
      if (ok) block.setAttribute("data-copied", ""); else block.removeAttribute("data-copied");
      clearTimeout(timer);
      timer = setTimeout(function () { label.textContent = "Copy"; block.removeAttribute("data-copied"); }, 1600);
    });
  });
}

/* ---------- verify_agent modal -> dapp verifier ---------- */
function wireCheckForm() {
  const form = document.querySelector("#email-form form");
  if (!form) return;
  form.setAttribute("action", "app.html");
  form.addEventListener("submit", function (event) {
    // Stop the reference form handler: nothing is posted, the dapp runs the check.
    event.preventDefault();
    event.stopImmediatePropagation();
    const agent = form.elements.agent.value.trim();
    const action = form.elements.action.value.trim().toLowerCase();
    const amount = form.elements.amount.value.replace(/[^0-9.]/g, "");
    if (!agent) return;
    const params = new URLSearchParams({ agent: agent });
    if (action) params.set("action", action);
    if (amount) params.set("amount", amount);
    window.location.href = "app.html?" + params.toString() + "#verify";
  }, true);
}

renderCa();
wireCheckForm();
