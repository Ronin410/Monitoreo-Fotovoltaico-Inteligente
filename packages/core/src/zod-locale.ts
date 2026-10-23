import { z } from 'zod';

// Mensajes de validación de zod en español para toda la plataforma (la interfaz es es-MX,
// specs/09). Hay una sola copia de zod en el monorepo y esta configuración es global: basta con
// importar @pv/core, como hacen la api, el worker y la web. Los esquemas con mensaje propio lo
// conservan.
z.config(z.locales.es());
