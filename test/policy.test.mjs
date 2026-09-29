import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, summarizePolicy, parseAgentId, formatAgentId, credentialState, delegationState } from "../js/policy.js";

const data = JSON.parse(readFileSync(new URL("../data/preview.json", import.meta.url), "utf8"));
const agent = (id) => data.agents.find((a) => a.id === id);
const NOW = Date.parse("2026-09-29T12:00:00Z");
const failed = (r) => r.checks.filter((c) => !c.ok).map((c) => c.key);

test("agent IDs parse and format", () => {
  assert.equal(parseAgentId("MEI0842"), 842);
  assert.equal(parseAgentId("mei 842"), 842);
  assert.equal(parseAgentId("842"), 842);
  assert.equal(parseAgentId("0"), null);
  assert.equal(parseAgentId("0xabc"), null);
  assert.equal(formatAgentId(77), "MEI0077");
});

test("a request inside every limit is permitted", () => {
  const r = evaluate(agent(842), { action: "pay", amount: 1200, asset: "USDC" }, NOW);
  assert.equal(r.permitted, true);
  assert.deepEqual(failed(r), []);
});

test("each broken rule is named", () => {
  assert.deepEqual(failed(evaluate(agent(842), { action: "pay", amount: 7500 }, NOW)), ["maxTx"]);
  assert.deepEqual(failed(evaluate(agent(842), { action: "swap", amount: 10, asset: "DOGE" }, NOW)), ["asset"]);
  assert.deepEqual(failed(evaluate(agent(311), { action: "pay", amount: 400 }, NOW)), ["daily"]);
  assert.deepEqual(failed(evaluate(agent(311), { action: "trade", amount: 10 }, NOW)), ["action", "delegation"]);
  assert.deepEqual(failed(evaluate(agent(842), { action: "pay", amount: 1, protocol: "0x" + "1".repeat(40) }, NOW)), ["protocol"]);
});

test("suspended identity, revoked credential and paused policy all refuse", () => {
  const r = evaluate(agent(77), { action: "trade", amount: 10 }, NOW);
  assert.equal(r.permitted, false);
  assert.deepEqual(failed(r), ["identity", "controller", "policy", "delegation"]);
});

test("unknown agents and unknown actions are refused, never guessed", () => {
  assert.equal(evaluate(null, { action: "pay" }, NOW).permitted, false);
  assert.deepEqual(failed(evaluate(agent(842), { action: "withdraw_all" }, NOW)), ["action", "delegation"]);
  assert.deepEqual(failed(evaluate(agent(842), { action: "pay", amount: "abc" }, NOW)), ["maxTx", "daily", "delegation"]);
});

test("expiry is judged against the given time", () => {
  const cred = { type: "application", expiresAt: "2026-08-01T00:00:00Z", revoked: false };
  assert.equal(credentialState(cred, NOW), "expired");
  assert.equal(credentialState(cred, Date.parse("2026-07-01T00:00:00Z")), "active");
  assert.equal(credentialState({ ...cred, revoked: true }, 0), "revoked");
  assert.equal(delegationState({ expiresAt: null, status: "active" }, NOW), "active");
  // the whole policy stops once it expires
  assert.equal(evaluate(agent(842), { action: "pay", amount: 1 }, Date.parse("2027-04-01T00:00:00Z")).permitted, false);
});

test("the policy summary reads as plain sentences", () => {
  const s = summarizePolicy(agent(842), NOW);
  assert.match(s, /^MEI0842 may pay, swap, trade and contract interaction\./);
  assert.match(s, /\$5,000/);
  assert.match(s, /\$25,000/);
  assert.match(summarizePolicy(agent(77), NOW), /paused, so nothing is permitted/);
});
