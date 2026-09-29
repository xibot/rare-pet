import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionCompletionQueue, type ActionCompletionScope } from '../games/rare-pet/action-completion.ts';

const preview = { friend: 'generations:68356', context: 'preview:1' };
const owned = { friend: 'generations:68356', context: 'owned:0xowner:revision:7' };
const launch = { kind: 'launch', mode: 'friend', friend: owned.friend, hash: `0x${'aB'.repeat(32)}` } as const;

test('an abandoned modal never celebrates, and closing it rejects later completion', () => {
  for (const action of ['play', 'launch'] as const) {
    const queue = createActionCompletionQueue();
    const ticket = queue.begin(action, owned);
    assert.equal(queue.consume(ticket, owned), null);
    assert.equal(queue.complete(ticket, owned, action === 'play' ? { kind: 'play' } : launch), false);
    assert.equal(queue.consume(ticket, owned), null);
  }
});

test('finished Preview and owned practice Play each wait for close and celebrate once', () => {
  for (const scope of [preview, owned]) {
    const queue = createActionCompletionQueue();
    const ticket = queue.begin('play', scope);
    assert.equal(queue.complete(ticket, scope, { kind: 'play' }), true);
    assert.equal(queue.consume(ticket, scope), 'play');
    assert.equal(queue.consume(ticket, scope), null);
    assert.equal(queue.complete(ticket, scope, { kind: 'play' }), false);
  }
});

test('multiple finished Play runs remain independently accepted within the same modal', () => {
  const queue = createActionCompletionQueue();
  const ticket = queue.begin('play', preview);
  for (let run = 0; run < 3; run++) assert.equal(queue.complete(ticket, preview, { kind: 'play' }), true);
  assert.equal(queue.consume(ticket, preview), 'play');
  assert.equal(queue.consume(ticket, preview), null);
});

test('Friend, collection, mode and wallet-context changes invalidate a queued moment', () => {
  const changedScopes: ActionCompletionScope[] = [
    { ...owned, friend: 'generations:68370' },
    { ...owned, friend: 'genesis:68356' },
    preview,
    { ...owned, context: 'owned:0xother:revision:7' },
    { ...owned, context: 'owned:0xowner:revision:8' },
  ];
  for (const changed of changedScopes) {
    const queue = createActionCompletionQueue();
    const ticket = queue.begin('play', owned);
    assert.equal(queue.complete(ticket, owned, { kind: 'play' }), true);
    assert.equal(queue.consume(ticket, changed), null);
    assert.equal(queue.consume(ticket, owned), null, 'returning to the old Friend cannot revive the moment');
  }
});

test('a scope change before completion rejects the callback even if the old scope returns', () => {
  const queue = createActionCompletionQueue();
  const ticket = queue.begin('play', owned);
  assert.equal(queue.complete(ticket, preview, { kind: 'play' }), false);
  assert.equal(queue.complete(ticket, owned, { kind: 'play' }), false);
  assert.equal(queue.consume(ticket, owned), null);
});

test('only a confirmed launch for the same Friend queues an RF celebration', () => {
  const queue = createActionCompletionQueue();
  const ticket = queue.begin('launch', owned);
  assert.equal(queue.complete(ticket, owned, { ...launch, mode: 'self', friend: null }), false);
  assert.equal(queue.complete(ticket, owned, { ...launch, friend: 'genesis:68356' }), false);
  assert.equal(queue.complete(ticket, owned, { ...launch, friend: null }), false);
  assert.equal(queue.complete(ticket, owned, { ...launch, hash: '' }), false);
  assert.equal(queue.complete(ticket, owned, launch), true);
  assert.equal(queue.consume(ticket, owned), 'launch');
});

test('launch hashes cannot replay after close, clear, or a new modal, regardless of case', () => {
  const queue = createActionCompletionQueue();
  const first = queue.begin('launch', owned);
  assert.equal(queue.complete(first, owned, launch), true);
  assert.equal(queue.complete(first, owned, { ...launch, hash: launch.hash.toLowerCase() }), false);
  assert.equal(queue.consume(first, owned), 'launch');
  queue.clear();
  const second = queue.begin('launch', owned);
  assert.equal(queue.complete(second, owned, { ...launch, hash: launch.hash.toUpperCase() }), false);
  assert.equal(queue.consume(second, owned), null);
  const third = queue.begin('launch', owned);
  assert.equal(queue.complete(third, owned, { ...launch, hash: `0x${'cd'.repeat(32)}` }), true);
  assert.equal(queue.consume(third, owned), 'launch');
});

test('wrong-action completions never queue and do not reserve a launch hash', () => {
  const queue = createActionCompletionQueue();
  const playTicket = queue.begin('play', owned);
  assert.equal(queue.complete(playTicket, owned, launch), false);
  assert.equal(queue.consume(playTicket, owned), null);
  const launchTicket = queue.begin('launch', owned);
  assert.equal(queue.complete(launchTicket, owned, { kind: 'play' }), false);
  assert.equal(queue.complete(launchTicket, owned, launch), true);
  assert.equal(queue.consume(launchTicket, owned), 'launch');
});

test('reopening replaces the old ticket and late callbacks cannot disturb the new modal', () => {
  const queue = createActionCompletionQueue();
  const first = queue.begin('play', preview);
  assert.equal(queue.complete(first, preview, { kind: 'play' }), true);
  const second = queue.begin('launch', owned);
  assert(second.id > first.id);
  assert.equal(queue.complete(first, preview, { kind: 'play' }), false);
  assert.equal(queue.consume(first, preview), null);
  assert.equal(queue.complete(null, owned, launch), false);
  assert.equal(queue.consume(null, owned), null);
  assert.equal(queue.complete(second, owned, launch), true);
  assert.equal(queue.consume(second, owned), 'launch');
});

test('clearing a pending completion discards it and rejects all callbacks from that ticket', () => {
  const queue = createActionCompletionQueue();
  const ticket = queue.begin('launch', owned);
  assert.equal(queue.complete(ticket, owned, launch), true);
  queue.clear();
  assert.equal(queue.consume(ticket, owned), null);
  assert.equal(queue.complete(ticket, owned, launch), false);
  const next = queue.begin('launch', owned);
  assert.equal(queue.complete(next, owned, launch), false, 'seen transaction hashes survive a clear');
  assert.equal(queue.consume(next, owned), null);
});

test('ticket scope is captured at opening, so mutating the caller scope cannot retarget it', () => {
  const queue = createActionCompletionQueue();
  const scope = { ...preview };
  const ticket = queue.begin('play', scope);
  scope.friend = 'genesis:1';
  assert.deepEqual(ticket.scope, preview);
  assert.equal(queue.complete(ticket, scope, { kind: 'play' }), false);
  assert.equal(queue.consume(ticket, preview), null);
});
