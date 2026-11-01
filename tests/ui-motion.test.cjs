const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/ui-motion.js'), 'utf8');

test('ripple is bounded, does not intercept actions, and respects reduced motion', () => {
  const events = {}, timers = new Map(), layers = new Set();
  let id = 0;
  const reduced = { matches: false, addEventListener: (_, fn) => { reduced.changed = fn; } };
  const button = { disabled: false, getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 40, left: 0, top: 0 }),
    appendChild: layer => layers.add(layer) };
  const document = { hidden: false, addEventListener: (name, fn) => { events[name] = fn; },
    createElement: () => { const el = { style: {}, setAttribute() {}, appendChild() {}, remove: () => layers.delete(el) }; return el; } };
  const window = { matchMedia: () => reduced,
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(source, { document, window, Set, Math });
  const event = { target: { closest: () => button }, detail: 0 };
  events.click(event);
  events.click(event);
  assert.equal(layers.size, 1);
  assert.equal(timers.size, 1);
  document.hidden = true;
  events.visibilitychange();
  assert.equal(layers.size, 0);
  assert.equal(timers.size, 0);
  document.hidden = false;
  reduced.matches = true;
  events.click(event);
  assert.equal(layers.size, 0);
  reduced.matches = false;
  button.disabled = true;
  events.click(event);
  assert.equal(layers.size, 0);
  button.disabled = false;
  events.click(event);
  for (const fn of timers.values()) fn();
  assert.equal(layers.size, 0);
});
