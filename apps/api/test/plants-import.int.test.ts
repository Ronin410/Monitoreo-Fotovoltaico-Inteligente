import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createTestContext,
  createUser,
  tokenFor,
  type TestContext,
} from './helpers.js';

// Importación masiva de clientes y plantas desde CSV (docs/plan-lanzamiento.md 6.4).

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

async function company() {
  const c = await createCompany(ctx.owner);
  const op = await createUser(ctx.owner, { companyId: c.id, role: 'operator' });
  const tech = await createUser(ctx.owner, { companyId: c.id, role: 'technician' });
  return {
    company: c,
    auth: `Bearer ${await tokenFor(op, ctx.clock.current)}`,
    techAuth: `Bearer ${await tokenFor(tech, ctx.clock.current)}`,
  };
}

const importCsv = (auth: string, csv: string, dryRun = false) =>
  request(ctx.app)
    .post(`/api/plants/import${dryRun ? '?dry_run=true' : ''}`)
    .set('Authorization', auth)
    .set('Content-Type', 'text/csv')
    .send(csv);

const existingClient = (companyId: string, name: string) =>
  ctx.owner.client.create({
    data: {
      companyId,
      name,
      address: 'Av. Obregón 100',
      colonia: 'Centro',
      postalCode: '80000',
      lat: 24.8069,
      lon: -107.3938,
    },
  });

// Como lo guarda Excel en español: BOM, punto y coma, coma decimal y fecha día/mes/año.
const EXCEL = [
  '\uFEFFCliente;Dirección;Colonia;Código postal;Latitud;Longitud;Teléfono;Correo reportes;Planta;Capacidad kWp;Puesta en marcha;Marca inversor;Inclinación;Orientación;Notas',
  'María López;Calle Rosales 12;Las Quintas;80060;24,8135;-107,4055;667 123 4567;maria@example.com;Casa;6,6;10/03/2025;Growatt;20;180;techo plano',
  'María López;Calle Rosales 12;Las Quintas;80060;24,8135;-107,4055;;;Cochera;3,3;2025-04-01;GoodWe;;;',
  'abarrotes el sol;;;;;;;;Bodega;12;;Victron;;;',
].join('\r\n');

describe('importación masiva de plantas', () => {
  it('revisa sin guardar y señala cada error con su renglón y columna', async () => {
    const f = await company();
    const csv = [
      'cliente,direccion,colonia,codigo_postal,latitud,longitud,planta,capacidad_kwp,marca_inversor',
      'Cliente A,Calle 1,Centro,800,24.8,-107.4,Planta 1,5,GoodWe',
      'Cliente B,Calle 2,Centro,80000,24.8,-107.4,Planta 2,cinco,GoodWe',
      'Cliente C,Calle 3,Centro,80000,24.8,-107.4,Planta 3,5,Sungrow',
      ',Calle 4,Centro,80000,24.8,-107.4,Planta 4,5,GoodWe',
    ].join('\n');
    const res = await importCsv(f.auth, csv, true);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(false);
    expect(res.body.errors.map((e: { row: number; column: string }) => [e.row, e.column])).toEqual([
      [2, 'codigo_postal'],
      [3, 'capacidad_kwp'],
      [4, 'marca_inversor'],
      [5, 'cliente'],
    ]);
    // Con errores tampoco guarda sin dry_run (todo o nada).
    const again = await importCsv(f.auth, csv);
    expect(again.body.imported).toBe(false);
    expect(await ctx.owner.client.count({ where: { companyId: f.company.id } })).toBe(0);
  });

  it('importa un archivo de Excel: clientes nuevos y existentes, plantas y clima', async () => {
    const f = await company();
    const sol = await existingClient(f.company.id, 'Abarrotes El Sol');
    // Un cliente con el mismo nombre en otra empresa no se toma en cuenta.
    const other = await createCompany(ctx.owner);
    await existingClient(other.id, 'María López');

    const preview = await importCsv(f.auth, EXCEL, true);
    expect(preview.body).toMatchObject({
      rows: 3,
      clients_new: 1,
      clients_existing: 1,
      plants_new: 3,
      imported: false,
      errors: [],
      ignored_columns: ['notas'],
    });
    expect(await ctx.owner.solarPlant.count({ where: { companyId: f.company.id } })).toBe(0);

    const before = ctx.jobs.jobs.length;
    const res = await importCsv(f.auth, EXCEL);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ imported: true, plants_new: 3 });

    const maria = await ctx.owner.client.findFirstOrThrow({
      where: { companyId: f.company.id, name: 'María López' },
      include: { plants: { orderBy: { name: 'asc' } } },
    });
    expect(maria).toMatchObject({ phone: '667 123 4567', reportEmail: 'maria@example.com' });
    expect(maria.plants.map((p) => [p.name, p.capacityKwp.toNumber(), p.inverterBrand])).toEqual([
      ['Casa', 6.6, 'growatt'],
      ['Cochera', 3.3, 'goodwe'],
    ]);
    const casa = maria.plants.find((p) => p.name === 'Casa');
    expect(casa?.commissioningDate?.toISOString().slice(0, 10)).toBe('2025-03-10');
    // Sin coordenadas propias, la planta toma las del cliente.
    expect(casa?.lat?.toNumber()).toBe(24.8135);
    const bodega = await ctx.owner.solarPlant.findFirstOrThrow({
      where: { companyId: f.company.id, name: 'Bodega' },
    });
    expect(bodega).toMatchObject({
      clientId: sol.id,
      inverterBrand: 'victron',
      postalCode: '80000',
    });
    // Clima histórico de cada planta, como en el alta manual.
    expect(ctx.jobs.jobs.slice(before).filter((j) => j.name === 'weather.backfill')).toHaveLength(
      3,
    );

    // Volver a importar el mismo archivo no duplica.
    const twice = await importCsv(f.auth, EXCEL);
    expect(twice.body.imported).toBe(false);
    expect(twice.body.errors[0].message).toMatch(/ya tiene una planta llamada "Casa"/);
  });

  it('faltan columnas, archivo vacío, plantas repetidas y permisos', async () => {
    const f = await company();
    const missing = await importCsv(f.auth, 'cliente,planta\nA,B', true);
    expect(missing.body.errors[0].message).toMatch(
      /Faltan columnas: capacidad_kwp, marca_inversor/,
    );
    const empty = await importCsv(f.auth, '');
    expect(empty.status).toBe(400);
    const dup = await importCsv(
      f.auth,
      [
        'cliente,direccion,colonia,codigo_postal,latitud,longitud,planta,capacidad_kwp,marca_inversor',
        'A,Calle,Centro,80000,24.8,-107.4,Casa,5,GoodWe',
        'A,Calle,Centro,80000,24.8,-107.4,casa,5,GoodWe',
      ].join('\n'),
      true,
    );
    expect(dup.body.errors).toEqual([
      {
        row: 3,
        column: 'planta',
        message: 'La planta "casa" está repetida en el archivo para este cliente',
      },
    ]);
    expect((await importCsv(f.techAuth, EXCEL, true)).status).toBe(403);
  });
});
