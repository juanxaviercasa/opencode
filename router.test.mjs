import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, isFree } from './index.mjs';
const base = {
  providerID: 'opencode', enabled: true, status: 'active', type: 'chat',
  package: '@opencode/ai/providers/openai-compatible',
  settings: { baseURL: 'https://opencode.ai/inference/openai/v1' },
  capabilities: { tools: true, input: ['text'], output: ['text'] },
  compatibility: { reasoningField: 'reasoning_content' },
  cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  limit: { context: 200000, output: 32000 },
};
const model = id => ({ ...structuredClone(base), id, modelID: id });
function setup(fetcher, custom = {}) {
  const router = createRouter({ fetcher, log: () => {}, ...custom });
  const list = [model('deepseek-v4.1-flash-free'), model('glm-5.3-flash-free'), model('beam-free')];
  router.transform({ list: () => list, remove() {}, update() {}, default: { set() {} } });
  return router;
}
const event = () => ({ sessionID: 's1', kind: 'primary', model: { providerID: 'opencode' }, request: new Request('https://opencode.ai/inference/openai/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'deepseek-v4.1-flash-free', messages: [{ role: 'user', content: 'hola' }], tools: [{ type: 'function', function: { name: 'read' } }], stream: true }) }) });
test('rejects paid, unknown-price and foreign models', () => {
  assert.equal(isFree(base), true);
  assert.equal(isFree({ ...base, cost: [] }), false);
  assert.equal(isFree({ ...base, cost: [{ ...base.cost[0], output: 1 }] }), false);
  assert.equal(isFree({ ...base, providerID: 'other' }), false);
});
test('accepts raw catalog models with inherited runtime and publishes a stable alias', () => {
  const raw = model('glm-5.3-flash-free');
  delete raw.package; delete raw.modelID;
  const updates = new Map(); let defaultID;
  const router = createRouter({ log: () => {} });
  router.transform({list: () => [raw], remove() {}, update(provider, id, fn) { const draft={}; fn(draft); updates.set(id,draft); }, default: {set(provider,id) {defaultID=id;}}});
  assert.equal(defaultID, 'free-auto');
  assert.equal(updates.get('free-auto').modelID, 'glm-5.3-flash-free');
  assert.equal(updates.get('free-auto').id, 'free-auto');
});
test('429 switches models, preserves conversation/tools/stream and cools down the failure', async () => {
  let sent;
  const router = setup(async (url, init) => { sent = JSON.parse(init.body); return new Response('data: success\n\n', { headers: { 'content-type': 'text/event-stream' } }); });
  const e = event();
  await router.request(e);
  const initial = await e.request.clone().json();
  e.response = new Response('limited', { status: 429 });
  await router.response(e);
  assert.equal(e.response.status, 200);
  assert.equal(sent.model, 'glm-5.3-flash-free');
  assert.deepEqual(sent.messages, initial.messages);
  assert.deepEqual(sent.tools, initial.tools);
  assert.equal(sent.stream, true);
  const next = event(); await router.request(next);
  assert.equal((await next.request.json()).model, 'glm-5.3-flash-free');
});
test('tries all compatible free candidates and stops on exhaustion', async () => {
  const attempts = [];
  const router = setup(async (url, init) => { attempts.push(JSON.parse(init.body).model); return new Response('down', { status: 503 }); });
  const e = event(); await router.request(e); e.response = new Response('down', { status: 503 });
  await router.response(e);
  assert.deepEqual(attempts, ['glm-5.3-flash-free', 'beam-free']);
  await assert.rejects(router.request(event()), /temporalmente limitados/);
});
test('does not retry authentication errors or successful streams', async () => {
  for (const status of [200, 400, 401, 403]) {
    const router = setup(() => { throw Error('must not retry'); });
    const e = event(); await router.request(e); e.response = new Response('body', { status });
    await router.response(e); assert.equal(e.response.status, status);
  }
});
test('blocks paid body and foreign endpoint before dispatch', async () => {
  const router = setup(() => {});
  const e = event(); e.request = new Request(e.request, { body: JSON.stringify({ model: 'paid' }) });
  await assert.rejects(router.request(e), /precio cero/);
  const foreign = event(); foreign.request = new Request('https://example.org', { method: 'POST', body: '{}' });
  await assert.rejects(router.request(foreign), /solo se permiten/);
});
test('honors Retry-After and resumes when cooldown ends', async () => {
  let time = 100000;
  const router = setup(async () => new Response('ok'), { now: () => time });
  const e = event(); await router.request(e); e.response = new Response('limited', { status: 429, headers: { 'retry-after': '120' } });
  await router.response(e);
  time += 60000;
  const next = event(); await router.request(next); assert.equal((await next.request.json()).model, 'glm-5.3-flash-free');
  time += 60001;
  const later = event(); await router.request(later); assert.equal((await later.request.json()).model, 'deepseek-v4.1-flash-free');
});
