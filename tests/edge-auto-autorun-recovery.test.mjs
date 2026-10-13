import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../edge-automation/extension/autorun.js', import.meta.url), 'utf8');

async function runAutorun(states, runResponses = [{ ok: true, resumed: true }]) {
  const status = {};
  const messages = [];
  let reloads = 0;
  let closed = 0;
  const context = vm.createContext({ URLSearchParams, location: { search: '?force=0' },
    document: { getElementById: () => status },
    setTimeout(fn) { const timer = { canceled: false }; queueMicrotask(() => { if (!timer.canceled) fn(); }); return timer; },
    clearTimeout(timer) { timer.canceled = true; },
    chrome: { runtime: { getManifest: () => ({ version: '1.1.12' }), reload() { reloads++; },
      sendMessage(message, callback) {
        messages.push(message);
        const values = message.type === 'JS_AUTO_GET_STATE' ? states : runResponses;
        const response = values.length > 1 ? values.shift() : values[0];
        if (response !== 'no-callback') callback(response);
      } }, tabs: { getCurrent: callback => callback({ id: 7 }), remove() { closed++; } } }
  });
  await vm.runInContext(code, context);
  await new Promise(resolve => setImmediate(resolve));
  return { status: status.textContent, messages, reloads, closed };
}

test('transient worker status failures reconnect without reloading the running extension', async () => {
  const result = await runAutorun([{ ok: false }, 'no-callback', { ok: true, backgroundBuild: '1.1.12' }]);
  assert.equal(result.reloads, 0);
  assert.equal(result.messages.filter(message => message.type === 'JS_AUTO_GET_STATE').length, 3);
  assert.equal(result.messages.filter(message => message.type === 'JS_AUTO_RUN_REQUEST').length, 1);
  assert.equal(result.closed, 1);
  assert.match(result.status, /중단 지점부터/);
});

test('only a confirmed nonempty mismatched worker build causes a single extension reload', async () => {
  const result = await runAutorun([{ ok: true, backgroundBuild: '1.1.11' }]);
  assert.equal(result.reloads, 1);
  assert.equal(result.messages.length, 1);
  assert.equal(result.closed, 0);
});

test('missing or unavailable build state stops after bounded attempts without reloading or starting collection', async () => {
  for (const response of [{ ok: true }, { ok: false, backgroundBuild: '1.1.11' }, 'no-callback']) {
    const result = await runAutorun([response]);
    assert.equal(result.reloads, 0);
    assert.equal(result.messages.length, 4);
    assert.equal(result.messages.filter(message => message.type === 'JS_AUTO_RUN_REQUEST').length, 0);
    assert.equal(result.closed, 0);
  }
});

test('failed run requests never unload a verified worker even when the response has no message', async () => {
  const result = await runAutorun([{ ok: true, backgroundBuild: '1.1.12' }], [{ ok: false }]);
  assert.equal(result.reloads, 0);
  assert.equal(result.messages.filter(message => message.type === 'JS_AUTO_RUN_REQUEST').length, 4);
  assert.equal(result.closed, 0);
});
