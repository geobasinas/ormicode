var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
if (!("__unenv__" in performance)) {
  const proto = Performance.prototype;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key !== "constructor" && !(key in performance)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc) {
        Object.defineProperty(performance, key, desc);
      }
    }
  }
}
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  _channel,
  _debugEnd,
  _debugProcess,
  _disconnect,
  _events,
  _eventsCount,
  _exiting,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _handleQueue,
  _kill,
  _linkedBinding,
  _maxListeners,
  _pendingMessage,
  _preload_modules,
  _rawDebug,
  _send,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert,
  availableMemory,
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  disconnect,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  hrtime: hrtime3,
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  mainModule,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// ../../../AppData/Roaming/npm/node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// src/account.ts
var sha256hex = /* @__PURE__ */ __name(async (input) => {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}, "sha256hex");
var eq = /* @__PURE__ */ __name((a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}, "eq");
var JOIN_TTL_MS = 3e4;
var AccountDO = class {
  static {
    __name(this, "AccountDO");
  }
  joins = /* @__PURE__ */ new Map();
  ctx;
  constructor(ctx) {
    this.ctx = ctx;
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT, token_hash TEXT UNIQUE, revoked INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS codes(code_hash TEXT PRIMARY KEY, expires_at INTEGER);
      CREATE TABLE IF NOT EXISTS cursors(device TEXT, session TEXT, seq INTEGER, PRIMARY KEY(device, session));
      CREATE TABLE IF NOT EXISTS subs(device TEXT, session TEXT, PRIMARY KEY(device, session));
      CREATE TABLE IF NOT EXISTS outbox(session TEXT, seq INTEGER, frame TEXT, PRIMARY KEY(session, seq));
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, device TEXT);
    `);
  }
  get sql() {
    return this.ctx.storage.sql;
  }
  meta(key) {
    return this.sql.exec("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value;
  }
  sockets(role, device) {
    return this.ctx.getWebSockets().filter((ws) => {
      const a = ws.deserializeAttachment();
      return a?.role === role && (!device || a.device === device);
    });
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/connect") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ role: "pending" });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (req.method === "POST" && url.pathname === "/auth-hub") {
      const { token } = await req.json();
      const ok = !!(token && this.meta("hub_token_hash") && eq(this.meta("hub_token_hash"), await sha256hex(token)));
      return new Response(null, { status: ok ? 200 : 401 });
    }
    if (req.method === "POST" && url.pathname === "/auth-any") {
      const { tokenHash } = await req.json();
      const ok = !!(tokenHash && (eq(tokenHash, this.meta("hub_token_hash") ?? "") || this.deviceForHash(tokenHash)));
      return new Response(null, { status: ok ? 200 : 401 });
    }
    if (req.method === "POST" && url.pathname === "/register") {
      const { hubTokenHash } = await req.json();
      if (!hubTokenHash) return new Response("hubTokenHash required", { status: 400 });
      this.sql.exec("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", "hub_token_hash", hubTokenHash);
      return Response.json({ ok: true });
    }
    if (req.method === "POST" && url.pathname === "/pair") {
      if (!await this.authed(req)) return new Response("unauthorized", { status: 401 });
      const { codeHash, expiresAt } = await req.json();
      if (!codeHash || !expiresAt) return new Response("codeHash and expiresAt required", { status: 400 });
      this.sql.exec("INSERT OR REPLACE INTO codes(code_hash, expires_at) VALUES (?, ?)", codeHash, expiresAt);
      this.setAlarm();
      return Response.json({ ok: true });
    }
    if (req.method === "POST" && url.pathname === "/join") return this.join(req);
    if (req.method === "POST" && url.pathname === "/revoke") {
      if (!await this.authed(req)) return new Response("unauthorized", { status: 401 });
      const { device } = await req.json();
      if (!device) return new Response("device required", { status: 400 });
      this.sql.exec("UPDATE devices SET revoked = 1 WHERE id = ?", device);
      for (const ws of this.sockets("device", device)) ws.close(4001, "revoked");
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }
  async authed(req) {
    const stored = this.meta("hub_token_hash");
    const bearer = req.headers.get("authorization")?.replace(/^bearer\s+/i, "");
    return !!(stored && bearer && eq(stored, await sha256hex(bearer)));
  }
  async join(req) {
    const { code, name } = await req.json();
    if (!code || !name) return new Response("code and name required", { status: 400 });
    const hash = await sha256hex(code.replace(/\D/g, ""));
    const row = this.sql.exec("SELECT expires_at FROM codes WHERE code_hash = ?", hash).toArray()[0];
    if (!row || row.expires_at < Date.now()) return Response.json({ error: "pairing.invalid_code" }, { status: 403 });
    const hub = this.sockets("hub")[0];
    if (!hub) return Response.json({ error: "pairing.hub_offline" }, { status: 503 });
    const join = crypto.randomUUID();
    const done = new Promise((resolve) => this.joins.set(join, resolve));
    const timeout = setTimeout(() => {
      const res = this.joins.get(join);
      if (res) {
        this.joins.delete(join);
        res(Response.json({ error: "pairing.timeout" }, { status: 504 }));
      }
    }, JOIN_TTL_MS);
    try {
      hub.send(JSON.stringify({ type: "pair.join", join, code: code.replace(/\s/g, ""), name }));
      return await done;
    } finally {
      clearTimeout(timeout);
    }
  }
  setAlarm() {
    const next = this.sql.exec("SELECT MIN(expires_at) AS t FROM codes").one()?.t;
    if (next) void this.ctx.storage.setAlarm(next);
  }
  async alarm() {
    this.sql.exec("DELETE FROM codes WHERE expires_at < ?", Date.now());
    this.setAlarm();
  }
  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      ws.close(4002, "bad frame");
      return;
    }
    const a = ws.deserializeAttachment() ?? { role: "pending" };
    if (a.role === "pending") {
      if (msg.type !== "auth" || typeof msg.token !== "string") {
        ws.close(4003, "first frame must be auth");
        return;
      }
      const hash = await sha256hex(msg.token);
      const next = eq(hash, this.meta("hub_token_hash") ?? "") ? { role: "hub" } : this.deviceForHash(hash) ? { role: "device", device: this.deviceForHash(hash) } : { role: "pending" };
      if (next.role === "pending") {
        ws.close(4004, "unknown token");
        return;
      }
      ws.serializeAttachment(next);
      ws.send(JSON.stringify({ type: "authed", role: next.role, ...next.device ? { device: next.device } : {} }));
      return;
    }
    if (a.role === "device") {
      await this.deviceMessage(ws, a.device, msg);
      return;
    }
    await this.hubMessage(ws, msg);
  }
  deviceForHash(hash) {
    return this.sql.exec("SELECT id FROM devices WHERE token_hash = ? AND revoked = 0", hash).toArray()[0]?.id;
  }
  async deviceMessage(ws, device, msg) {
    const session = typeof msg.session === "string" ? msg.session : "";
    switch (msg.type) {
      case "subscribe": {
        if (!session) return;
        this.sql.exec("INSERT OR IGNORE INTO subs(device, session) VALUES (?, ?)", device, session);
        const after = typeof msg.after === "number" ? msg.after : 0;
        this.sql.exec("INSERT OR REPLACE INTO cursors(device, session, seq) VALUES (?, ?, ?)", device, session, after);
        for (const row of this.sql.exec("SELECT seq, frame FROM outbox WHERE session = ? AND seq > ? ORDER BY seq", session, after)) {
          ws.send(row.frame);
          this.sql.exec("INSERT OR REPLACE INTO cursors(device, session, seq) VALUES (?, ?, ?)", device, session, row.seq);
        }
        return;
      }
      case "unsubscribe":
        this.sql.exec("DELETE FROM subs WHERE device = ? AND session = ?", device, session);
        return;
      case "ack":
        if (session && typeof msg.seq === "number")
          this.sql.exec("INSERT OR REPLACE INTO cursors(device, session, seq) VALUES (?, ?, ?)", device, session, msg.seq);
        return;
      case "req": {
        const hub = this.sockets("hub")[0];
        if (!hub) {
          ws.send(JSON.stringify({ type: "err", id: msg.id, code: "relay.hub_offline" }));
          return;
        }
        this.sql.exec("INSERT OR REPLACE INTO requests(id, device) VALUES (?, ?)", String(msg.id), device);
        hub.send(JSON.stringify({ ...msg, device }));
        return;
      }
      default:
        return;
    }
  }
  async hubMessage(ws, msg) {
    switch (msg.type) {
      case "evt": {
        const session = String(msg.session);
        const seq = Number(msg.seq);
        const frame = JSON.stringify(msg.frame ?? msg);
        for (const d of this.subscribed(session)) {
          for (const sock of this.sockets("device", d)) {
            try {
              sock.send(frame);
              this.sql.exec("INSERT OR REPLACE INTO cursors(device, session, seq) VALUES (?, ?, ?)", d, session, seq);
            } catch {
            }
          }
        }
        return;
      }
      case "res":
      case "err": {
        const row = this.sql.exec("SELECT device FROM requests WHERE id = ?", String(msg.id)).toArray()[0];
        if (!row) return;
        this.sql.exec("DELETE FROM requests WHERE id = ?", String(msg.id));
        for (const sock of this.sockets("device", String(row.device))) sock.send(JSON.stringify(msg));
        return;
      }
      case "pair.result": {
        const res = this.joins.get(String(msg.join));
        if (!res) return;
        this.joins.delete(String(msg.join));
        if (msg.ok && typeof msg.device === "string" && typeof msg.tokenHash === "string") {
          this.sql.exec(
            "INSERT OR REPLACE INTO devices(id, name, token_hash) VALUES (?, ?, ?)",
            msg.device,
            String(msg.name ?? msg.device),
            msg.tokenHash
          );
          this.sql.exec("DELETE FROM codes WHERE code_hash = ?", String(msg.codeHash ?? ""));
          res(Response.json({ device: msg.device, token: msg.token }));
        } else res(Response.json({ error: "pairing.rejected" }, { status: 403 }));
        return;
      }
      case "device.add":
        this.sql.exec(
          "INSERT OR REPLACE INTO devices(id, name, token_hash) VALUES (?, ?, ?)",
          String(msg.device),
          String(msg.name),
          String(msg.tokenHash)
        );
        return;
      case "device.revoke": {
        const id = String(msg.device);
        this.sql.exec("UPDATE devices SET revoked = 1 WHERE id = ?", id);
        for (const sock of this.sockets("device", id)) sock.close(4001, "revoked");
        return;
      }
      default:
        return;
    }
  }
  subscribed(session) {
    return this.sql.exec("SELECT DISTINCT device FROM subs WHERE session = ?", session).toArray().map((r) => r.device);
  }
  async webSocketClose(ws) {
    try {
      ws.close(1e3);
    } catch {
    }
  }
};

// src/index.ts
var buckets = /* @__PURE__ */ new Map();
function limited(ip, route, cap) {
  const key = `${route}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { reset: now + 6e4, count: 1 });
    return false;
  }
  b.count++;
  return b.count > cap;
}
__name(limited, "limited");
var tooMany = /* @__PURE__ */ __name(() => new Response("rate limited", { status: 429, headers: { "retry-after": "60" } }), "tooMany");
var sha256hex2 = /* @__PURE__ */ __name(async (input) => {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}, "sha256hex");
var src_default = {
  async fetch(req, env2) {
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    const account = url.searchParams.get("account") ?? req.headers.get("x-ormi-account") ?? "";
    if (req.method === "POST" && url.pathname === "/register") {
      if (limited(ip, "register", 10)) return tooMany();
      const { hubToken, secret } = await req.json();
      if (!hubToken || !account) return new Response("account + hubToken required", { status: 400 });
      if (env2.BOOTSTRAP_SECRET && secret !== env2.BOOTSTRAP_SECRET) return new Response("forbidden", { status: 403 });
      const stub = env2.ACCOUNT.get(env2.ACCOUNT.idFromName(`acct:${account}`));
      return stub.fetch(new Request("https://do/register", {
        method: "POST",
        body: JSON.stringify({ hubTokenHash: await sha256hex2(hubToken) })
      }));
    }
    if (req.method === "POST" && url.pathname === "/pair") {
      if (limited(ip, "pair", 60)) return tooMany();
      if (!account) return new Response("account required", { status: 400 });
      const stub = env2.ACCOUNT.get(env2.ACCOUNT.idFromName(`acct:${account}`));
      return stub.fetch(req);
    }
    if (req.method === "POST" && url.pathname === "/join") {
      if (limited(ip, "join", 20)) return tooMany();
      if (!account) return new Response("account required", { status: 400 });
      const stub = env2.ACCOUNT.get(env2.ACCOUNT.idFromName(`acct:${account}`));
      return stub.fetch(req);
    }
    if (req.method === "POST" && url.pathname === "/revoke") {
      if (!account) return new Response("account required", { status: 400 });
      const stub = env2.ACCOUNT.get(env2.ACCOUNT.idFromName(`acct:${account}`));
      return stub.fetch(req);
    }
    if (url.pathname === "/connect") {
      if (limited(ip, "connect", 60)) return tooMany();
      if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      if (!account) return new Response("account required", { status: 400 });
      const stub = env2.ACCOUNT.get(env2.ACCOUNT.idFromName(`acct:${account}`));
      return stub.fetch(req);
    }
    if (url.pathname.startsWith("/blob/")) {
      if (limited(ip, "blob", 120)) return tooMany();
      const id = url.pathname.slice("/blob/".length);
      if (!id || !account) return new Response("bad blob path", { status: 400 });
      const key = `b/${account}/${id}`;
      if (req.method === "PUT") {
        const len = Number(req.headers.get("content-length"));
        if (!len || len > 25 * 1024 * 1024) return new Response("content-length required, max 25MB", { status: 400 });
        const stub = env2.ACCOUNT.get(env2.ACCOUNT.idFromName(`acct:${account}`));
        const ok = await stub.fetch(new Request("https://do/auth-hub", { method: "POST", body: JSON.stringify({ token: req.headers.get("authorization")?.replace(/^bearer\s+/i, "") }) }));
        if (!ok.ok) return new Response("unauthorized", { status: 401 });
        await env2.EVENTS.put(key, req.body);
        return Response.json({ ok: true });
      }
      if (req.method === "GET") {
        const bearer = req.headers.get("authorization")?.replace(/^bearer\s+/i, "") ?? "";
        if (!bearer) return new Response("unauthorized", { status: 401 });
        const stub = env2.ACCOUNT.get(env2.ACCOUNT.idFromName(`acct:${account}`));
        const ok = await stub.fetch(new Request("https://do/auth-any", { method: "POST", body: JSON.stringify({ tokenHash: await sha256hex2(bearer) }) }));
        if (!ok.ok) return new Response("unauthorized", { status: 401 });
        const obj = await env2.EVENTS.get(key);
        if (!obj) return new Response("not found", { status: 404 });
        return new Response(obj.body, { headers: { "content-type": "application/octet-stream" } });
      }
    }
    return new Response("ormicode relay", { status: 200 });
  }
};

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-JiF0Xr/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env2, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env2, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env2, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env2, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-JiF0Xr/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env2, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env2, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env2, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env2, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env2, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env2, ctx) => {
      this.env = env2;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  AccountDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
