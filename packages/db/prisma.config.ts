import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Las migraciones corren con el rol dueño de las tablas, nunca con el de la aplicación
  // (ver specs/02 y packages/db/README.md).
  datasource: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '' },
});
