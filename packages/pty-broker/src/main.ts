// Entry point for the detached broker process.
import { startBroker } from './broker.ts';

const socketPath = process.env.ORMICODE_PTY_SOCKET;
if (!socketPath) { console.error('ORMICODE_PTY_SOCKET is required'); process.exit(2); }
await startBroker({ socketPath, idleMs: Number(process.env.ORMICODE_PTY_IDLE_MS) || 30_000, onExit: () => process.exit(0) });
