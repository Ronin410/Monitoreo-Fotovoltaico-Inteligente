import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Las migraciones corren con el rol dueño de las tablas (ver specs/02).
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
