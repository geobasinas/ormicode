import test from 'node:test';
import assert from 'node:assert/strict';
import { browserDestination, browserLocation } from '../src/features/browser/browser-navigation.ts';

const preview = { id: 'preview', port: 41000, path: '/', url: 'http://s-41000.localhost:5555/', title: 'App' };
const ports = { base: 41000, count: 10 };
test('a web page can be opened from an empty browser, with no service or preview dependency', () => {
  assert.deepEqual(browserDestination('example.com'), { url: 'https://example.com/', path: 'https://example.com/', port: undefined });
  assert.equal(browserDestination('search words').url, 'https://duckduckgo.com/?q=search%20words');
  assert.equal(browserDestination('https://example.org', preview, ports).port, undefined);
  assert.throws(() => browserDestination('javascript:alert(1)', preview, ports));
});
test('service paths and allocated local ports still route through preview.url', () => {
  assert.deepEqual(browserDestination('/admin?q=1#top', preview, ports), { url: 'http://s-41000.localhost:5555/admin?q=1#top', path: '/admin?q=1#top', port: 41000 });
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(browserDestination(`http://${host}:41001/docs`, undefined, ports).port, 41001);
  }
  assert.equal(browserDestination('http://localhost:41010', preview, ports).port, undefined);
  assert.equal(browserDestination('https://localhost:41001', preview, ports).port, undefined);
});
test('web navigation records full URLs and drops service status; back to the original preview restores it', () => {
  assert.deepEqual(browserLocation('https://example.com/docs?a=1#top', preview), { path: 'https://example.com/docs?a=1#top', port: undefined });
  assert.deepEqual(browserLocation('http://s-41000.localhost:5555/admin', preview), { path: '/admin', port: 41000 });
  const web = { id: 'web', url: 'https://example.com/', path: 'https://example.com/docs', title: 'Web' };
  assert.equal(browserDestination('/next', web).url, 'https://example.com/next');
  assert.deepEqual(browserLocation('https://example.com/next', web), { path: 'https://example.com/next', port: undefined });
});
