import test from 'node:test';
import assert from 'node:assert/strict';
import { browserLoadError, isLoadFailure } from '../src/features/browser/browser-load-error.ts';

const remote = (code, number, url) => new Error(`Error invoking remote method 'GUEST_VIEW_MANAGER_CALL': Error: ${code} (${number}) loading '${url}'`);

test('connection failures from loadURL and did-fail-load become a friendly "can\'t reach" error', () => {
  const thrown = browserLoadError(remote('ERR_CONNECTION_CLOSED', -100, 'https://missing.example/'));
  assert.deepEqual({ ...thrown, description: undefined }, {
    kind: 'unreachable', title: "Can't reach this site", tabTitle: "Can't reach this site", target: 'missing.example', url: 'https://missing.example/', description: undefined,
  });
  for (const code of ['ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_TIMED_OUT', 'ERR_CONNECTION_FAILED',
    'ERR_ADDRESS_UNREACHABLE', 'ERR_INTERNET_DISCONNECTED', 'ERR_EMPTY_RESPONSE', 'ERR_TIMED_OUT']) {
    const error = browserLoadError({ errorCode: -105, errorDescription: code, validatedURL: 'https://gone.example:8443/x' });
    assert.equal(error.kind, 'unreachable', code); assert.equal(error.target, 'gone.example:8443');
  }
  for (const error of [thrown, browserLoadError({ errorCode: -105, errorDescription: 'ERR_NAME_NOT_RESOLVED' }, 'https://x.example/')]) {
    assert.doesNotMatch(JSON.stringify(error), /GUEST_VIEW|ERR_|invoking/);
  }
});

test('invalid addresses become a friendly "isn\'t valid" error; aborted loads are ignored', () => {
  assert.equal(browserLoadError(remote('ERR_INVALID_URL', -300, 'https://bad%host/')).kind, 'invalid');
  assert.equal(browserLoadError({ errorCode: -300, errorDescription: '' }, 'http://[x').tabTitle, 'Invalid address');
  assert.equal(browserLoadError(new Error('Invalid web address.'), 'http://').target, 'http://');
  assert.equal(browserLoadError(new Error('Invalid address.'), 'a\tb').kind, 'invalid');
  assert.equal(browserLoadError(remote('ERR_ABORTED', -3, 'https://a.example/')), undefined);
  assert.equal(browserLoadError({ errorCode: -3, errorDescription: 'ERR_ABORTED' }), undefined);
  assert.equal(browserLoadError(remote('ERR_CERT_AUTHORITY_INVALID', -202, 'https://self.example/')).kind, 'failed');
});

test('only navigation failures are routed to the in-pane error page', () => {
  assert.equal(isLoadFailure(remote('ERR_CONNECTION_CLOSED', -100, 'https://a.example/')), true);
  assert.equal(isLoadFailure(new Error('Invalid web address.')), true);
  assert.equal(isLoadFailure({ errorCode: -105 }), true);
  assert.equal(isLoadFailure(new Error('Only HTTP and HTTPS addresses are allowed.')), false);
  assert.equal(isLoadFailure(new Error('Enter a URL or search terms.')), false);
});
