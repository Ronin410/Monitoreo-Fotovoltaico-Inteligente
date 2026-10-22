export type Heartbeat = { service: 'pv-worker'; status: 'alive'; at: string };

export function heartbeat(now: Date = new Date()): Heartbeat {
  return { service: 'pv-worker', status: 'alive', at: now.toISOString() };
}
