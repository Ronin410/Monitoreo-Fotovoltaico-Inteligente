import { proxyToApi } from '@/lib/proxy';

// /api/* → pv-api (specs/PREGUNTAS.md #24). Se evalúa en cada petición: API_INTERNAL_URL se lee
// en tiempo de ejecución, no al compilar.
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function handle(req: Request, { params }: Context): Promise<Response> {
  return proxyToApi(req, (await params).path, process.env);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
