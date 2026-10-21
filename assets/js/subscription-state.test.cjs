const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("./subscription-state.js");
const received = Date.parse("2026-10-21T12:00:00Z");
const base = { subscription_verified: true, active: true, days: 99, checked_at: "2026-10-21T12:00:00Z", received_at: received };

test("expired panel date overrides a stale positive day counter", () => {
    assert.deepEqual(state({ ...base, expires_at: "2026-10-20T12:00:00Z" }, received), { known: true, active: false, days: 0 });
});
test("an open mini app expires without waiting for a reload", () => {
    const me = { ...base, expires_at: "2026-10-21T12:00:01Z" };
    assert.equal(state(me, received).days, 1);
    assert.equal(state(me, received + 1000).days, 0);
});
test("server time avoids incorrect days when the phone clock is wrong", () => {
    const phoneClock = received + 10 * 86400000;
    assert.equal(state({ ...base, received_at: phoneClock, expires_at: "2026-10-22T12:00:00Z" }, phoneClock).days, 1);
});
test("unverified balances are unknown, not active or expired", () => {
    assert.equal(state({ ...base, subscription_verified: false }, received).known, false);
    assert.equal(state({ days: 45 }, received).known, false);
});
test("disabled, unlimited and pending subscriptions retain their semantics", () => {
    assert.equal(state({ ...base, active: false }, received).days, 0);
    assert.equal(state({ ...base, unlimited: true }, received).unlimited, true);
    assert.equal(state({ ...base, pending_activation: true, days: 5 }, received).days, 5);
});
