#!/usr/bin/env node
import { startDaemon } from './supervisor.ts';

const daemon = await startDaemon();
console.log(`ormicode daemon listening on ${daemon.socketPath}`);
process.on('SIGINT', () => { void daemon.close().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void daemon.close().then(() => process.exit(0)); });
// data.wipe stops the hub from inside; exit instead of idling without a store.
void daemon.stopped.then(() => process.exit(0));
