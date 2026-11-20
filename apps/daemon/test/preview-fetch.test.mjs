import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { PREVIEW_FETCH_CHUNK_BYTES, PreviewFetchError, PreviewFetchPages } from '../src/preview-fetch.ts';

test('preview fetch pages preserve a response larger than one relay frame', () => {
  const pages = new PreviewFetchPages();
  const source = Buffer.alloc(PREVIEW_FETCH_CHUNK_BYTES * 3 + 91);
  for (let index = 0; index < source.length; index++) source[index] = index % 251;
  const first = pages.first('device', { status: 200, headers: {}, body: source });
  const chunks = [Buffer.from(first.body, 'base64')];
  let more = first.more;
  while (more) {
    const next = pages.next('device', more);
    chunks.push(Buffer.from(next.body, 'base64'));
    more = next.more;
  }
  assert.equal(first.size, source.length);
  assert.deepEqual(Buffer.concat(chunks), source);
  pages.close();
});

test('preview fetch handles expire and are scoped to the client', async () => {
  const pages = new PreviewFetchPages(5);
  const response = pages.first('device-a', { status: 200, headers: {}, body: Buffer.alloc(PREVIEW_FETCH_CHUNK_BYTES + 1) });
  assert.throws(() => pages.next('device-b', response.more), PreviewFetchError);
  await delay(15);
  assert.throws(() => pages.next('device-a', response.more), PreviewFetchError);
  assert.throws(() => pages.next('device-a', 'unknown'), PreviewFetchError);
  pages.close();
});
