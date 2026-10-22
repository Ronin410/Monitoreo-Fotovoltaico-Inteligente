/**
 * URL de la base de datos de pruebas. Se exige un nombre que contenga "test" porque
 * global-setup la borra y vuelve a migrar en cada corrida.
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
