import { alertsEvaluate, alertsOffline, alertsOfflineCompany } from '@pv/adapters';
import {
  addDays,
  buildEvidence,
  dailyStatus,
  evaluateDailyAlerts,
  evaluateOffline,
  localDate,
  parseCompanySettings,
  startOfLocalDay,
  sunHoursBetween,
  zoneEventPlants,
  type AlertAction,
  type AlertEvidence,
  type AlertSeverity,
  type AlertType,
  type EvidenceDay,
  type OpenAlert,
} from '@pv/core';
import { listActiveCompanies, withTenant, type Company, type Prisma, type TenantDb } from '@pv/db';
import { registerJob, type JobContext } from '../runtime.js';
import { enqueueEmails, queueEmails, recipientsFor } from './notifications.js';

// Job alerts.evaluate (specs/06): evento de zona → reglas diarias por planta → aplica las acciones
// (abrir, actualizar evidencia, resolver) → recalcula el estado del día. La regla offline corre
// aparte cada hora (alerts.offline).

const HOUR_MS = 3_600_000;
/** Hora local a la que corre metrics.daily: fecha de detección de las alertas del día. */
const EVALUATION_HOUR = 22;
/** Días de métricas que se cargan por planta (rachas, resoluciones y evidencia de 14 días). */
const HISTORY_DAYS = 30;
const DAILY_TYPES: AlertType[] = ['sudden_drop', 'soiling', 'cleaning_due_soon'];
const OPEN_STATUSES = ['open', 'acknowledged'] as const;

const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

type StoredAlert = {
  id: string;
  plantId: string;
  type: AlertType;
  severity: AlertSeverity;
  detectedAt: Date;
  evidence: Prisma.JsonValue;
};

type Applied = { opened: number; updated: number; resolved: number };

async function applyAction(
  tx: TenantDb,
  companyId: string,
  plantId: string,
  action: AlertAction,
  existing: StoredAlert | undefined,
  at: Date,
  evidence: (trigger: AlertEvidence['trigger'], cleaningDidNotRecover: boolean) => AlertEvidence,
  counts: Applied,
): Promise<string | null> {
  if (action.kind === 'open') {
    const created = await tx.alert.create({
      data: {
        companyId,
        plantId,
        type: action.type,
        severity: action.severity,
        status: 'open',
        detectedAt: at,
        evidence: evidence(action.trigger, false),
        // Las info (cleaning_due_soon) no llevan explicación IA (specs/07 §3).
        aiStatus: action.severity === 'info' ? 'skipped' : 'pending',
      },
    });
    // TODO(F7-T2): encolar ai.explain_alert para alertas warning y critical (specs/07 §3).
    counts.opened++;
    return created.id;
  }
  if (!existing) return null;
  if (action.kind === 'resolve') {
    await tx.alert.update({
      where: { id: existing.id },
      data: { status: 'resolved', resolvedAt: at, resolution: 'auto' },
    });
    counts.resolved++;
    return null;
  }
  const previous = existing.evidence as Partial<AlertEvidence> | null;
  const trigger = action.trigger ?? previous?.trigger ?? { dates: [], deviation_pct: [] };
  await tx.alert.update({
    where: { id: existing.id },
    data: {
      severity: action.severity,
      evidence: evidence(trigger, action.cleaningDidNotRecover ?? false),
      // TODO(F7-T2): con reexplain, encolar ai.explain_alert de nuevo.
      ...(action.reexplain && { aiStatus: 'pending' }),
    },
  });
  counts.updated++;
  return null;
}

/** Máxima antigüedad de una alerta para avisar por correo (no se notifica la historia). */
const NOTIFY_MAX_AGE_MS = 24 * HOUR_MS;

/**
 * Correo de alerta nueva warning o critical a alert_emails y company_admin (specs/06 §6). Devuelve
 * los ids para encolarlos al confirmar la transacción.
 */
async function notifyOpened(
  ctx: JobContext,
  tx: TenantDb,
  company: Company,
  alert: {
    id: string;
    type: AlertType;
    severity: AlertSeverity;
    detectedAt: Date;
    deviationPct: number | null;
  },
  plant: { name: string; colonia: string; client: { name: string } },
): Promise<string[]> {
  if (alert.severity === 'info' || ctx.suppressNotifications) return [];
  if (ctx.now().getTime() - alert.detectedAt.getTime() > NOTIFY_MAX_AGE_MS) return [];
  const recipients = await recipientsFor(tx, company, ['company_admin']);
  return queueEmails(
    tx,
    company,
    recipients,
    'alert_opened',
    {
      alert_id: alert.id,
      type: alert.type,
      severity: alert.severity,
      plant_name: plant.name,
      client_name: plant.client.name,
      colonia: plant.colonia,
      detected_at: alert.detectedAt.toISOString(),
      deviation_pct: alert.deviationPct,
    },
    { type: 'alert', id: alert.id },
  );
}

/** Evalúa las reglas diarias de la empresa para la fecha local `date`. */
export async function evaluateCompanyDay(ctx: JobContext, companyId: string, date: string) {
  const result = await withTenant(
    ctx.db,
    companyId,
    async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const tz = company.timezone;
      const { thresholds } = parseCompanySettings(company.settings);
      const dayStart = startOfLocalDay(date, tz);
      const at = new Date(
        Math.min(ctx.now().getTime(), dayStart.getTime() + EVALUATION_HOUR * HOUR_MS),
      );
      const dayDate = new Date(`${date}T00:00:00Z`);

      const plants = await tx.solarPlant.findMany({
        where: { deletedAt: null, status: 'active' },
        select: {
          id: true,
          name: true,
          colonia: true,
          postalCode: true,
          lat: true,
          lon: true,
          client: { select: { name: true } },
        },
      });
      const ids = plants.map((p) => p.id);
      const [metrics, events, openAlerts] = await Promise.all([
        tx.plantDailyMetric.findMany({
          where: {
            plantId: { in: ids },
            date: { gte: new Date(`${addDays(date, -HISTORY_DAYS)}T00:00:00Z`), lte: dayDate },
          },
        }),
        tx.plantEvent.findMany({
          where: {
            plantId: { in: ids },
            occurredAt: { lt: startOfLocalDay(addDays(date, 1), tz) },
          },
          select: { plantId: true, type: true, occurredAt: true },
        }),
        tx.alert.findMany({
          where: {
            plantId: { in: ids },
            status: { in: [...OPEN_STATUSES] },
            type: { in: DAILY_TYPES },
          },
          select: {
            id: true,
            plantId: true,
            type: true,
            severity: true,
            detectedAt: true,
            evidence: true,
          },
        }),
      ]);

      // 1. Evento de zona (specs/06 §1), antes que las reglas.
      const todays = metrics.filter((m) => isoDay(m.date) === date);
      const plantById = new Map(plants.map((p) => [p.id, p]));
      const zone = zoneEventPlants(
        todays.map((m) => {
          const p = plantById.get(m.plantId);
          return {
            plantId: m.plantId,
            postalCode: p?.postalCode ?? m.postalCode,
            lat: num(p?.lat ?? null),
            lon: num(p?.lon ?? null),
            isValidDay: m.isValidDay,
            deviationPct: num(m.deviationPct),
          };
        }),
        thresholds,
      );
      for (const m of todays) {
        if (m.zoneEvent !== zone.has(m.plantId)) {
          m.zoneEvent = zone.has(m.plantId);
          await tx.plantDailyMetric.update({
            where: { plantId_date: { plantId: m.plantId, date: m.date } },
            data: { zoneEvent: m.zoneEvent },
          });
        }
      }

      // 2. Reglas por planta.
      const counts: Applied = { opened: 0, updated: 0, resolved: 0 };
      const emails: string[] = [];
      for (const m of todays) {
        const days: EvidenceDay[] = metrics
          .filter((x) => x.plantId === m.plantId)
          .map((x) => ({
            date: isoDay(x.date),
            isValidDay: x.isValidDay,
            deviationPct: num(x.deviationPct),
            neighborIndex: num(x.neighborIndex),
            rainMm: num(x.rainMm),
            zoneEvent: x.zoneEvent,
            soilingSlopePctPerDay: num(x.soilingSlopePctPerDay),
            daysToCleaning: x.daysToCleaning,
            predictionConfidence: x.predictionConfidence,
            prTemp: num(x.prTemp),
            prBaseline: num(x.prBaseline),
            baselineSource: x.baselineSource,
            neighborCount: x.neighborCount,
            cloudCoverAvgPct: num(x.cloudCoverAvgPct),
            tempAmbMaxC: num(x.tempAmbMaxC),
          }));
        const plantEvents = events
          .filter((e) => e.plantId === m.plantId)
          .map((e) => ({ type: e.type, date: localDate(e.occurredAt, tz) }));
        const stored = new Map(
          openAlerts.filter((a) => a.plantId === m.plantId).map((a) => [a.type, a as StoredAlert]),
        );
        const open: Partial<Record<AlertType, OpenAlert>> = {};
        for (const [type, a] of stored) {
          open[type] = {
            severity: a.severity,
            detectedOn: localDate(a.detectedAt, tz),
            cleaningDidNotRecover:
              (a.evidence as Partial<AlertEvidence> | null)?.cleaning_did_not_recover === true,
          };
        }

        const actions = evaluateDailyAlerts({
          today: date,
          days,
          events: plantEvents,
          open,
          thresholds,
        });
        for (const action of actions) {
          const openedId = await applyAction(
            tx,
            companyId,
            m.plantId,
            action,
            stored.get(action.type),
            at,
            (trigger, cleaningDidNotRecover) =>
              buildEvidence({
                rule: action.type,
                trigger,
                today: date,
                days,
                events: plantEvents,
                cleaningDidNotRecover,
              }),
            counts,
          );
          const plant = plantById.get(m.plantId);
          if (openedId && action.kind === 'open' && plant) {
            emails.push(
              ...(await notifyOpened(
                ctx,
                tx,
                company,
                {
                  id: openedId,
                  type: action.type,
                  severity: action.severity,
                  detectedAt: at,
                  deviationPct: action.trigger.deviation_pct.at(-1) ?? null,
                },
                plant,
              )),
            );
          }
        }
      }

      // 3. El estado del día refleja las alertas que quedaron abiertas (specs/05 §8).
      const nowOpen = await tx.alert.findMany({
        where: { plantId: { in: ids }, status: { in: [...OPEN_STATUSES] } },
        select: { plantId: true, severity: true },
      });
      for (const m of todays) {
        const status = dailyStatus({
          hasWeather: m.invalidReason !== 'no_weather',
          hasTelemetry: m.invalidReason !== 'no_weather' && m.invalidReason !== 'offline',
          openAlertSeverities: nowOpen
            .filter((a) => a.plantId === m.plantId)
            .map((a) => a.severity),
          deviationPct: num(m.deviationPct),
          daysToCleaning: m.daysToCleaning,
          soilingDeviationPct: thresholds.soiling_deviation_pct,
        });
        if (status !== m.status) {
          await tx.plantDailyMetric.update({
            where: { plantId_date: { plantId: m.plantId, date: m.date } },
            data: { status },
          });
        }
      }

      return {
        emails,
        stats: {
          date,
          plants: todays.length,
          zone_events: zone.size,
          ...counts,
          emails: emails.length,
        },
      };
    },
    { timeout: 120_000 },
  );
  await enqueueEmails(ctx, companyId, result.emails);
  return result.stats;
}

export const alertsEvaluateJob = registerJob(alertsEvaluate, (payload, ctx) =>
  evaluateCompanyDay(ctx, payload.company_id, payload.date),
);

type LastIngestion = {
  plant_id: string;
  status: string;
  error: string | null;
  skipped: string | null;
};

/** Regla offline de las plantas activas de la empresa (cada hora). */
export async function evaluateCompanyOffline(ctx: JobContext, companyId: string) {
  const now = ctx.now();
  // Último intento de ingesta por planta (job_runs es de plataforma: conexión pv_service).
  const runs = await ctx.serviceDb.$queryRaw<LastIngestion[]>`
    SELECT DISTINCT ON (stats->>'plant_id')
      stats->>'plant_id' AS plant_id, status::text AS status, error, stats->>'skipped' AS skipped
    FROM job_runs
    WHERE job_name = 'ingest.telemetry_plant' AND company_id = ${companyId}::uuid
      AND status <> 'running' AND stats ? 'plant_id'
    ORDER BY stats->>'plant_id', started_at DESC`;
  const lastRun = new Map(runs.map((r) => [r.plant_id, r]));

  const result = await withTenant(ctx.db, companyId, async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const { thresholds } = parseCompanySettings(company.settings);
    const emails: string[] = [];
    const plants = await tx.solarPlant.findMany({
      where: { deletedAt: null, status: 'active', lat: { not: null }, lon: { not: null } },
      select: {
        id: true,
        name: true,
        colonia: true,
        lat: true,
        lon: true,
        lastReadingAt: true,
        createdAt: true,
        client: { select: { name: true } },
      },
    });
    const openAlerts = await tx.alert.findMany({
      where: {
        plantId: { in: plants.map((p) => p.id) },
        type: 'offline',
        status: { in: [...OPEN_STATUSES] },
      },
    });

    const counts = { opened: 0, resolved: 0, connection_problems: 0 };
    for (const plant of plants) {
      const run = lastRun.get(plant.id);
      // Error de nuestra integración o planta sin credenciales: "problema de conexión", no alerta.
      const providerError =
        (run?.status === 'failed' && (run.error ?? '').startsWith('ProviderError')) ||
        run?.skipped === 'no_credentials';
      if (providerError) counts.connection_problems++;
      const existing = openAlerts.find((a) => a.plantId === plant.id);
      const lat = Number(plant.lat);
      const lon = Number(plant.lon);
      const action = evaluateOffline({
        now,
        lat,
        lon,
        lastReadingAt: plant.lastReadingAt,
        expectedSince: plant.createdAt,
        providerError,
        open: existing && {
          severity: existing.severity,
          detectedOn: localDate(existing.detectedAt, company.timezone),
          detectedAt: existing.detectedAt,
        },
        thresholds,
      });
      if (action?.kind === 'open') {
        const since = plant.lastReadingAt ?? plant.createdAt;
        const created = await tx.alert.create({
          data: {
            companyId,
            plantId: plant.id,
            type: 'offline',
            severity: action.severity,
            status: 'open',
            detectedAt: now,
            evidence: {
              rule: 'offline',
              last_reading_at: plant.lastReadingAt?.toISOString() ?? null,
              sun_hours_without_data: Math.round(sunHoursBetween(since, now, lat, lon) * 10) / 10,
              offline_hours_threshold: thresholds.offline_hours,
            },
            aiStatus: 'pending',
          },
        });
        // TODO(F7-T2): encolar ai.explain_alert.
        emails.push(
          ...(await notifyOpened(ctx, tx, company, { ...created, deviationPct: null }, plant)),
        );
        counts.opened++;
      } else if (action?.kind === 'resolve' && existing) {
        await tx.alert.update({
          where: { id: existing.id },
          data: { status: 'resolved', resolvedAt: now, resolution: 'auto' },
        });
        counts.resolved++;
      }
    }
    return { emails, stats: { plants: plants.length, ...counts, emails: emails.length } };
  });
  await enqueueEmails(ctx, companyId, result.emails);
  return result.stats;
}

export const alertsOfflineJob = registerJob(alertsOffline, async (_payload, ctx) => {
  let enqueued = 0;
  for (const company of await listActiveCompanies(ctx.serviceDb)) {
    if (await ctx.queue.enqueue(alertsOfflineCompany, { company_id: company.id })) enqueued++;
  }
  return { enqueued };
});

export const alertsOfflineCompanyJob = registerJob(alertsOfflineCompany, (payload, ctx) =>
  evaluateCompanyOffline(ctx, payload.company_id),
);
