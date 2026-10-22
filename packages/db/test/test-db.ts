/**
 * URL de la base de datos de pruebas, con el rol dueño (corre migraciones).
 * Se exige un nombre que contenga "test" porque global-setup la vacía en cada corrida.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Falta TEST_DATABASE_URL (por ejemplo postgres://postgres:postgres@localhost:5432/pv_iot_test).',
    );
  }
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.includes('test')) {
    throw new Error(`TEST_DATABASE_URL apunta a "${dbName}"; el nombre debe contener "test".`);
  }
  return url;
}

/** Usuarios de conexión de prueba, miembros de los roles de grupo pv_app y pv_service. */
export const TEST_LOGIN_ROLES = {
  app: { user: 'pv_app_test', password: 'pv_app_test', memberOf: 'pv_app' },
  service: { user: 'pv_service_test', password: 'pv_service_test', memberOf: 'pv_service' },
} as const;

function urlAs(role: { user: string; password: string }): string {
  const url = new URL(testDatabaseUrl());
  url.username = role.user;
  url.password = role.password;
  return url.toString();
}

/** Conexión como la aplicación (rol pv_app: sin BYPASSRLS ni dueño de tablas). */
export const testAppDatabaseUrl = () => urlAs(TEST_LOGIN_ROLES.app);

/** Conexión como el rol de plataforma (pv_service). */
export const testServiceDatabaseUrl = () => urlAs(TEST_LOGIN_ROLES.service);
