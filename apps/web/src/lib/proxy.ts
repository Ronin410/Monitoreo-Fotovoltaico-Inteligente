// Reenvío de /api a pv-api (specs/PREGUNTAS.md #24). Mismo origen para el navegador: la cookie
// de refresh es del mismo sitio aunque web y api vivan en dominios distintos de Render.

/** Cabeceras de la petición que pasan a la API; las demás (host, conexión…) no. */
const REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'cookie',
  'user-agent',
  // La API confía en un salto (trust proxy 1): el borde de Render agrega la IP real del cliente
  // y aquí se reenvía sin tocar, así el límite de intentos sigue siendo por cliente.
  'x-forwarded-for',
  'x-request-id',
];

/** Cabeceras de la respuesta que no se copian (las recalcula el servidor de Next). */
const DROPPED_RESPONSE_HEADERS = [
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
];

export function apiBaseUrl(env: Record<string, string | undefined>): string {
  const raw = env.API_INTERNAL_URL?.trim() || 'http://localhost:4000';
  // En Render, fromService/hostport entrega "host:puerto" sin esquema (red privada).
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/$/, '');
}

export function upstreamUrl(base: string, path: string[], search: string): string {
  return `${base}/api/${path.map(encodeURIComponent).join('/')}${search}`;
}

export function forwardRequestHeaders(incoming: Headers): Headers {
  const out = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}

export function forwardResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, name) => {
    if (name === 'set-cookie' || DROPPED_RESPONSE_HEADERS.includes(name)) return;
    out.append(name, value);
  });
  // Varias cookies: se copian una por una (forEach las uniría).
  for (const cookie of upstream.getSetCookie()) out.append('set-cookie', cookie);
  return out;
}

export async function proxyToApi(
  req: Request,
  path: string[],
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  // Sin '.' ni '..': el reenvío nunca sale de /api de pv-api.
  if (path.some((p) => p === '.' || p === '..' || p === '')) {
    return Response.json(
      { error: { code: 'NOT_FOUND', message: 'Recurso no encontrado' } },
      { status: 404 },
    );
  }
  const url = new URL(req.url);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetchFn(upstreamUrl(apiBaseUrl(env), path, url.search), {
      method: req.method,
      headers: forwardRequestHeaders(req.headers),
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      {
        error: {
          code: 'API_UNAVAILABLE',
          message: 'El servidor no responde. Inténtalo en un momento.',
        },
      },
      { status: 502 },
    );
  }
  // El cuerpo se pasa como flujo (las respuestas SSE del asistente llegan sin esperar).
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: forwardResponseHeaders(upstream.headers),
  });
}
