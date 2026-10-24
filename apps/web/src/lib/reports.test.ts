import { describe, expect, it } from 'vitest';
import { canSend, closedPeriods, periodLabel, rowState, type ReportItem } from './reports';

const item = (over: Partial<ReportItem> = {}): ReportItem => ({
  client: { id: '00000000-0000-4000-8000-000000000001', name: 'A', report_email: 'a@x.mx' },
  plants: 1,
  report: null,
  ...over,
});

describe('reportes (web)', () => {
  it('nombres de mes y meses cerrados', () => {
    expect(periodLabel('2026-09')).toBe('septiembre de 2026');
    expect(closedPeriods('2026-02', 3)).toEqual(['2026-01', '2025-12', '2025-11']);
  });

  it('estado y envío', () => {
    expect(rowState(item())).toBe('none');
    const generated = item({
      report: {
        id: '00000000-0000-4000-8000-000000000002',
        status: 'generated',
        narrative_source: 'ai',
        has_pdf: true,
        sent_to: null,
        sent_at: null,
        updated_at: '2026-10-01T15:00:00.000Z',
        send_failed: false,
      },
    });
    expect(rowState(generated)).toBe('generated');
    expect(canSend(generated)).toBe(true);
    expect(canSend({ ...generated, client: { ...generated.client, report_email: null } })).toBe(
      false,
    );
  });
});
