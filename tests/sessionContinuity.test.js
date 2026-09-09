import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveResumeSessionId,
  resolveUiSessionId
} from '../src/utils/sessionContinuity.js';

test('route session bridges the gap before selectedSession metadata arrives', () => {
  assert.equal(
    resolveUiSessionId({
      selectedSessionId: null,
      requestedSessionId: 'native-session-a'
    }),
    'native-session-a'
  );
});

test('selected sidebar session remains authoritative after metadata catches up', () => {
  assert.equal(
    resolveUiSessionId({
      selectedSessionId: 'native-session-a',
      requestedSessionId: 'native-session-a'
    }),
    'native-session-a'
  );
});

test('subsequent prompt resumes the route-bound native session if local state is transiently empty', () => {
  assert.equal(
    resolveResumeSessionId({
      currentSessionId: null,
      requestedSessionId: 'native-session-a',
      resumable: true
    }),
    'native-session-a'
  );
});

test('current native session wins once it is promoted', () => {
  assert.equal(
    resolveResumeSessionId({
      currentSessionId: 'native-session-a',
      requestedSessionId: 'native-session-a',
      resumable: true
    }),
    'native-session-a'
  );
});

test('non-resumable history deliberately starts a fresh native conversation', () => {
  assert.equal(
    resolveResumeSessionId({
      currentSessionId: 'legacy-session',
      requestedSessionId: 'legacy-session',
      resumable: false
    }),
    null
  );
});

test('a true new-session view keeps the active-run key on new', () => {
  assert.equal(
    resolveUiSessionId({
      selectedSessionId: null,
      requestedSessionId: null
    }),
    'new'
  );
});
