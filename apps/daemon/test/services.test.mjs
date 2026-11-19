import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, openStore } from '@ormicode/session-store';
import { allocateSessionPorts } from '../src/session-ports.ts';
import { PreviewProxy, previewLabel } from '../src/preview-proxy.ts';
import { ServiceError, Services } from '../src/services.ts';

const fixture = async config => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-services-'));
  const db = openStore(':memory:');
  const session = `s_${process.pid}_${Math.floor(Math.random() * 1_000_000)}`;
  createSession(db, { id: session, machine: 'm', project: dir, vendor: 'fake', transport: 'cli', cwd: dir });
  const base = Math.ceil((20_000 + Math.floor(Math.random() * 30_000)) / 10) * 10;
  await allocateSessionPorts(db, session, `${base}-${base + 59}`);
  const proxy = new PreviewProxy();
  await proxy.listen();
  const events = [];
  const services = new Services(db, proxy, (id, kind, payload) => events.push({ id, kind, payload }), join(dir, 'home'));
  if (config !== undefined) {
    mkdirSync(join(dir, '.ormi'), { recursive: true });
    writeFileSync(join(dir, '.ormi', 'services.yaml'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return {
    dir, db, session, proxy, services, events,
    async close() {
      await services.shutdown();
      await proxy.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

const waitFor = async (predicate, timeout = 5_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for service state');
};

test('services validate config, start healthy apps, journal transitions, and stop', async () => {
  const f = await fixture({ services: { web: {
    command: `node -e "require('node:http').createServer((q,r)=>r.end('ready')).listen(Number(process.env.PORT),'127.0.0.1')"`,
    health: '/', health_timeout: 5,
    portals: [{ url: '/', title: 'Home' }, { url: '/admin', title: 'Admin' }],
  } } });
  try {
    const started = await f.services.start(f.session, 'web');
    assert.equal(started.state, 'starting');
    await waitFor(() => f.events.find(event => event.payload.service === 'web' && event.payload.state === 'running'));
    const result = await f.services.list(f.session);
    assert.equal(result.config.error, undefined);
    assert.equal(result.services[0].state, 'running');
    assert.equal(result.services[0].port, result.ports.base);
    assert.equal(result.services[0].portals.length, 2);
    assert.match(result.services[0].portals[0].url, /__ormi\/auth\?/);
    const stopped = await f.services.stop(f.session, 'web');
    assert.equal(stopped.state, 'stopped');
    assert.ok(f.events.some(event => event.kind === 'service_state' && event.payload.state === 'stopped'));
  } finally { await f.close(); }
});

test('unhealthy, exited, invalid YAML, log cursors, and ring truncation are observable', async () => {
  const f = await fixture({ services: { web: {
    command: `node -e "setInterval(()=>{},1000)"`, health: '/never', health_timeout: 1,
  }, exit: { command: `node -e "process.exit(7)"` }, logs: {
    command: `node -e "for(let i=0;i<2105;i++)console.log('line'+i)"`,
  } } });
  try {
    await f.services.start(f.session, 'web');
    await waitFor(() => f.events.find(event => event.payload.service === 'web' && event.payload.state === 'unhealthy'));
    await f.services.start(f.session, 'exit');
    const exited = await waitFor(() => f.events.find(event => event.payload.service === 'exit' && event.payload.state === 'exited'));
    assert.equal(exited.payload.code, 7);
    await f.services.start(f.session, 'logs');
    await waitFor(() => f.events.find(event => event.payload.service === 'logs' && event.payload.state === 'exited'));
    const page = f.services.logs(f.session, 'logs');
    assert.equal(page.lines.length, 2000);
    assert.equal(page.truncated, true);
    assert.match(page.lines.at(-1), /line2104/);
    assert.equal(f.services.logs(f.session, 'logs', page.next).lines.length, 0);
  } finally { await f.close(); }
});

test('stop kills a detached service descendant after the grace period', { skip: process.platform !== 'linux' }, async () => {
  let f;
  let childPid;
  const childPath = join(tmpdir(), `ormi-service-child-${process.pid}.pid`);
  const childCode = 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)';
  const parentCode = `const {spawn}=require("node:child_process");const {writeFileSync}=require("node:fs");const child=spawn(process.execPath,["-e",${JSON.stringify(childCode)}],{detached:true,stdio:"ignore"});writeFileSync(${JSON.stringify(childPath)},String(child.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},1000)`;
  try {
    f = await fixture({ services: { tree: { command: `node -e '${parentCode}'` } } });
    await f.services.start(f.session, 'tree');
    await waitFor(() => existsSync(childPath));
    childPid = Number(readFileSync(childPath, 'utf8'));
    assert.ok(childPid > 0);
    assert.equal((await f.services.stop(f.session, 'tree')).state, 'stopped');
    await waitFor(() => {
      try { return readFileSync(`/proc/${childPid}/stat`, 'utf8').slice(-64).includes(' Z '); }
      catch { return true; }
    });
  } finally {
    if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch { /* already stopped */ } }
    rmSync(childPath, { force: true });
    await f?.close();
  }
});

test('invalid service YAML prevents starts and detected ports are listed', async () => {
  const f = await fixture('services: [');
  let server;
  try {
    const invalid = await f.services.list(f.session);
    assert.equal(invalid.config.found, true);
    assert.ok(invalid.config.error);
    await assert.rejects(f.services.start(f.session, 'web'), error => error instanceof ServiceError && error.code === 'config.error');
    await assert.rejects(f.services.previewUrl(f.session, invalid.ports.base + 10), error => error instanceof ServiceError && error.code === 'preview.port_denied');
    server = createServer();
    const base = invalid.ports.base;
    await new Promise(resolve => server.listen(base + 9, '127.0.0.1', resolve));
    const detected = await f.services.list(f.session);
    assert.ok(detected.detected.some(entry => entry.port === base + 9));
    assert.match(detected.detected.find(entry => entry.port === base + 9).url, new RegExp(`${previewLabel(f.session, base + 9)}\\.localhost`));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await f.close();
  }
});
