const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'cabinet/index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'assets/js/cabinet-features.js'), 'utf8');

function fixture(api) {
  const nodes = new Map();
  let document;
  function element(tag = 'div') {
    const classes = new Set();
    return {
      tag, children: [], listeners: {}, textContent: '', value: '', disabled: false, open: false,
      classList: { add: n => classes.add(n), remove: n => classes.delete(n), toggle(n, on) { on ? classes.add(n) : classes.delete(n); }, contains: n => classes.has(n) },
      addEventListener(n, fn) { this.listeners[n] = fn; },
      setAttribute(n, v) { this[n] = v; },
      append(...els) { this.children.push(...els); },
      replaceChildren(...els) { this.children = els; },
      querySelectorAll() { return this.children.flatMap(c => c.tag === 'button' ? [c] : c.querySelectorAll()); },
      focus() { document.activeElement = this; },
      showModal() { this.open = true; },
      close() { this.open = false; this.listeners.close?.(); },
      click() { return this.listeners.click?.({ preventDefault() {} }); }
    };
  }
  for (const m of html.matchAll(/id="([^"]+)"/g)) nodes.set(m[1], element());
  document = { body: element(), activeElement: element(), getElementById: id => nodes.get(id), createElement: element, querySelector: () => element() };
  const window = {};
  vm.runInNewContext(source, { window, document, Date, Number, URL, console });
  const calls = [];
  const features = window.neuravpnCabinetFeatures({ api: async (url, opts) => { calls.push([url, opts]); return api(url, opts); } });
  return { nodes, features, calls, click: id => nodes.get(id).click(), submit: () => nodes.get('promoForm').listeners.submit({ preventDefault() {} }) };
}
const device = { id: 'a'.repeat(64), name: '<img onerror=alert(1)>', last_seen: 0 };

test('rollout hides payments for unlimited accounts, enabled accounts see their limit', async () => {
  const f = fixture(() => ({devices:[device],device_plan:{enabled:false,extra_slots:0}}));
  f.click('devicesBtn'); await flush();
  assert.equal(f.nodes.get('addDeviceSlotBtn').classList.contains('hidden'),true);
  f.click('addDeviceSlotBtn'); assert.equal(f.nodes.get('deviceSlotDialog').open,false);
  const g=fixture(() => ({devices:[device],device_plan:{enabled:true,extra_slots:2}}));
  g.click('devicesBtn');await flush();
  assert.match(g.nodes.get('devicesCount').textContent,/из 7/);
  assert.match(g.nodes.get('devicePlanSummary').textContent,/100/);
});

test('slot purchase requires confirmation, is not duplicated, and checks the owned order', async () => {
  let finish;
  const f=fixture(url=>{
    if(url.endsWith('/purchase'))return new Promise(resolve=>{finish=resolve;});
    if(url.endsWith('/check'))return {devices:[],order:{id:'owned-order',applied:true}};
    return {devices:[device],device_plan:{enabled:true,extra_slots:0}};
  });
  f.click('devicesBtn');await flush();f.click('addDeviceSlotBtn');
  assert.equal(f.calls.length,1);assert.equal(f.nodes.get('deviceSlotDialog').open,true);
  assert.match(f.nodes.get('deviceSlotTerms').textContent,/каждом продлении/);
  const pending=f.click('confirmDeviceSlotBtn');f.click('confirmDeviceSlotBtn');
  assert.equal(f.calls.filter(c=>c[0].endsWith('/purchase')).length,1);
  finish({devices:[],order:{id:'owned-order',confirmation_url:'https://example.invalid/pay',applied:false}});await pending;
  assert.equal(f.nodes.get('deviceSlotPayLink').href,'https://example.invalid/pay');
  await f.click('confirmDeviceSlotBtn');
  assert.equal(f.calls.find(c=>c[0].endsWith('/check'))[1].body.id,'owned-order');
  assert.equal(f.nodes.get('deviceSlotDialog').open,false);
});

test('slot removal has a separate confirmation and does not charge a payment',async()=>{
 const f=fixture(()=>({devices:[],device_plan:{enabled:true,extra_slots:1}}));
 f.click('devicesBtn');await flush();f.click('reduceDeviceSlotBtn');
 assert.equal(f.calls.length,1);assert.match(f.nodes.get('deviceSlotTerms').textContent,/не возвращается/);
 f.click('cancelDeviceSlotBtn');assert.equal(f.calls.length,1);
 f.click('reduceDeviceSlotBtn');await f.click('confirmDeviceSlotBtn');
 assert.equal(f.calls.filter(c=>c[0].endsWith('/reduce')).length,1);
 assert.equal(f.calls.filter(c=>c[0].endsWith('/purchase')).length,0);
});
const baseQuote = { amount: 419, base_amount: 419, discount: 0, quote: 'signed-base' };
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

test('device deletion requires a second confirmation and sends only opaque ID', async () => {
  const f = fixture(url => url.endsWith('/delete') ? { devices: [], partial: false, result: 'deleted' } : { devices: [device], partial: false });
  await f.click('devicesBtn'); await flush();
  const list = f.nodes.get('deviceList');
  assert.equal(list.children[0].children[1].children[0].textContent, device.name);
  list.children[0].children[2].click();
  assert.equal(f.nodes.get('deleteDeviceDialog').open, true);
  assert.equal(f.calls.length, 1);
  f.click('cancelDeleteDeviceBtn');
  assert.equal(f.calls.length, 1);
  list.children[0].children[2].click();
  await f.click('confirmDeleteDeviceBtn');
  assert.equal(f.calls.length, 2);
  assert.equal(JSON.stringify(f.calls[1][1].body), JSON.stringify({ id: device.id }));
  assert.equal(list.children.length, 0);
  assert.match(f.nodes.get('devicesStatus').textContent, /удалена/);
});

test('unavailable panels are not displayed as a successful zero count', async () => {
  const f = fixture(() => { throw new Error('Unavailable'); });
  f.click('devicesBtn'); await flush();
  assert.equal(f.nodes.get('devicesCount').textContent, '');
  assert.equal(f.nodes.get('devicesStatus').classList.contains('is-error'), true);
  const partial = fixture(() => ({ devices: [device], partial: true }));
  partial.click('devicesBtn'); await flush();
  assert.match(partial.nodes.get('devicesStatus').textContent, /неполный/);
});

test('double delete cannot send two destructive requests', async () => {
  let finish;
  const f = fixture(url => url.endsWith('/delete') ? new Promise(resolve => { finish = resolve; }) : { devices: [device], partial: false });
  f.click('devicesBtn'); await flush();
  f.nodes.get('deviceList').children[0].children[2].click();
  const pending = f.click('confirmDeleteDeviceBtn');
  f.click('confirmDeleteDeviceBtn');
  assert.equal(f.calls.filter(c => c[0].endsWith('/delete')).length, 1);
  assert.equal(f.nodes.get('cancelDeleteDeviceBtn').disabled, true);
  finish({ devices: [], partial: true, result: 'partial' }); await pending;
  assert.match(f.nodes.get('devicesStatus').textContent, /не на всех/);
});

test('payment waits for a server quote and prevents concurrent creation', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  f.features.openCheckout({ id: '90d', title: '90 дней', amount: 419 });
  assert.equal(f.features.beginPayment(), null);
  finish({ quote: baseQuote }); await flush();
  assert.equal(f.features.beginPayment(), 'signed-base');
  assert.equal(f.features.beginPayment(), null);
  assert.equal(f.features.closeCheckout(), false);
  f.features.endPayment();
  assert.equal(f.features.closeCheckout(), true);
});

test('promo applies actual quoted amount; invalid code never invents a discount', async () => {
  const f = fixture((url, opts) => {
    if (url.includes('apply')) {
      if (opts.body.code === 'BAD') throw new Error('Промокод не найден');
      return { quote: { ...baseQuote, amount: 314.25, discount: 25, promo_code: 'SAVE25', quote: 'signed-discount' }, message: 'Промокод активирован.' };
    }
    return { quote: baseQuote };
  });
  f.features.openCheckout({ id: '90d', title: '90 дней', amount: 419 }); await flush();
  f.nodes.get('promoInput').value = 'BAD'; f.submit(); await flush();
  assert.match(f.nodes.get('promoStatus').textContent, /не найден/);
  f.nodes.get('promoInput').value = 'SAVE25'; f.submit(); await flush();
  assert.match(f.nodes.get('promoStatus').textContent, /25%/);
  assert.match(f.nodes.get('paymentChoiceText').children[0].textContent, /314,25/);
  assert.equal(f.features.beginPayment(), 'signed-discount');
});

test('price conflict requires a fresh quote and a new deliberate payment click', async () => {
  let fail = false;
  const f = fixture(() => { if (fail) throw new Error('offline'); return { quote: baseQuote }; });
  f.features.openCheckout({ id: '90d', title: '90 дней', amount: 419 }); await flush();
  f.features.beginPayment(); fail = true;
  await f.features.paymentError({ status: 409, message: 'Цена изменилась' });
  assert.equal(f.features.beginPayment(), null);
  assert.match(f.nodes.get('checkoutStatus').textContent, /изменилась/);
});
