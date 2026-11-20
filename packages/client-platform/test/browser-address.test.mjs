import test from 'node:test';
import assert from 'node:assert/strict';
import { isBrowserUrl, normalizeBrowserAddress } from '../src/browser-address.ts';

test('normalizes HTTP(S), bare domains, ports, international domains and searches', () => {
  for (const [input, expected] of [
    ['example.com', 'https://example.com/'], ['  EXAMPLE.com/docs?q=1#top  ', 'https://example.com/docs?q=1#top'],
    ['http://localhost:41000/path', 'http://localhost:41000/path'], ['localhost:3000', 'https://localhost:3000/'],
    ['example.com:8443/a', 'https://example.com:8443/a'], ['127.0.0.1:3000', 'https://127.0.0.1:3000/'],
    ['[::1]:3000', 'https://[::1]:3000/'], ['//example.com/a', 'https://example.com/a'],
    ['https://example.com/a b', 'https://example.com/a%20b'], ['bücher.de', 'https://xn--bcher-kva.de/'],
    ['how to test & debug', 'https://duckduckgo.com/?q=how%20to%20test%20%26%20debug'],
    ['ormicode', 'https://duckduckgo.com/?q=ormicode'],
  ]) {
    assert.equal(normalizeBrowserAddress(input), expected, input);
    assert.equal(isBrowserUrl(expected), true, expected);
  }
});
test('resolves explicit relative paths against a current web or local preview page', () => {
  assert.equal(normalizeBrowserAddress('/admin?q=1#top', 'http://session.localhost:123/'), 'http://session.localhost:123/admin?q=1#top');
  assert.equal(normalizeBrowserAddress('?q=next', 'https://example.com/docs'), 'https://example.com/docs?q=next');
  assert.equal(normalizeBrowserAddress('#next', 'https://example.com/docs'), 'https://example.com/docs#next');
  assert.throws(() => normalizeBrowserAddress('/admin'), /Open a page/);
  assert.throws(() => normalizeBrowserAddress('/admin', 'file:///tmp'), /Open a page/);
});
test('rejects empty, malformed, control-character and non-web-scheme addresses', () => {
  for (const input of ['', ' ', 'https://', 'https://[broken', 'http://example.com:99999', 'java\nscript:alert(1)',
    'file:///etc/passwd', 'FILE:/etc/passwd', 'javascript:alert(1)', 'data:text/html,test', 'about:blank', 'blob:https://example.com/id',
    'mailto:person@example.com', 'ftp://example.com', 'view-source:https://example.com', 'ormi:test', 'https:\\example.com']) {
    assert.throws(() => normalizeBrowserAddress(input), Error, input);
    assert.equal(isBrowserUrl(input), false, input);
  }
  for (const input of [null, undefined, 1, {}, 'example.com', 'https://example.com/\nfile:']) assert.equal(isBrowserUrl(input), false);
});
