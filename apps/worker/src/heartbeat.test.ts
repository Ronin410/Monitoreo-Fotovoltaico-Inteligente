import { describe, expect, it } from 'vitest';
import { heartbeat } from './heartbeat.js';

describe('heartbeat', () => {
  it('reporta el servicio vivo con la hora en ISO', () => {
    const at = new Date('2026-10-22T12:00:00Z');
    expect(heartbeat(at)).toEqual({
      service: 'pv-worker',
      status: 'alive',
      at: '2026-10-22T12:00:00.000Z',
    });
  });
});
