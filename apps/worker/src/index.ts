import { heartbeat } from './heartbeat.js';

const HEARTBEAT_MS = 60_000;

function beat(): void {
  console.log(JSON.stringify({ level: 'info', msg: 'heartbeat', ...heartbeat() }));
}

beat();
setInterval(beat, HEARTBEAT_MS);
