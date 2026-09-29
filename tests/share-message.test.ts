import test from 'node:test';
import assert from 'node:assert/strict';
import { SHARE_SPEECH, SHARE_SPEECH_MAX_LENGTH, limitShareSpeech, resolveShareSpeech } from '../games/rare-pet/share-message.ts';

test('custom speech uses the existing longest message limit and preserves all defaults', () => {
  assert.equal(SHARE_SPEECH_MAX_LENGTH, 21);
  for (const action of ['pet', 'feed', 'play', 'launch', 'poop', 'talk'] as const) {
    assert.equal(resolveShareSpeech(action), SHARE_SPEECH[action]);
    assert.equal(resolveShareSpeech(action, ' \n\t '), SHARE_SPEECH[action]);
    assert.equal(limitShareSpeech(SHARE_SPEECH[action]), SHARE_SPEECH[action]);
  }
});

test('overlong pasted text is capped without breaking supplementary Unicode characters', () => {
  const input = 'a'.repeat(20) + '🐾' + 'extra';
  assert.equal(limitShareSpeech(input), 'a'.repeat(20) + '🐾');
  assert.equal(Array.from(resolveShareSpeech('pet', '🐾'.repeat(25))).length, 21);
});

test('speech stays single-line, preserves typing spaces and renders punctuation literally', () => {
  assert.equal(limitShareSpeech('gm '), 'gm ');
  assert.equal(resolveShareSpeech('feed', 'gm\nrare\tfriend'), 'gm rare friend');
  assert.equal(resolveShareSpeech('poop', '<b>hi & "bye"</b>'), '<b>hi & "bye"</b>');
  assert.equal(resolveShareSpeech('pet', 'my own rare message'), 'my own rare message');
});
