// The local server behind `void-machine ui`.
//
// It carries NO business logic. It receives a reader, calls it, and serialises
// the result. That constraint is the whole design: without it the server
// becomes a third implementation beside the Core and the CLI, and the three
// start disagreeing about what a project's state is. The parity test asserts
// the CLI and this route return the same object.
//
// Not a daemon. It starts on demand, serves, and stops with the command. A
// resident process adds a lifecycle, a supervision story, and a stale cache to
// explain at every anomaly.
//
// Existing local-server posture: loopback only, CORS limited to localhost,
// a process-local launch token exchanged for a
// session cookie, and the shared security headers. It serves project paths and
// decision titles, which is not something to leave open on a shared network.

import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { createLiveAuth, sessionCookie, type LiveAuth } from './auth.js';

const LOCALHOST_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function corsFor(origin: string | undefined): Record<string, string> {
  if (origin !== undefined && LOCALHOST_ORIGIN.test(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    };
  }
  return {};
}

export function securityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

const LOOPBACK = '127.0.0.1';
const PORT_RETRIES = 20;
/**
 * Cookies ignore the port, so the Projects UI keeps its own cookie name.
 */
const COOKIE = 'void_projects_session';

export interface CommandCenterOptions {
  readonly port: number;
  readonly launchToken: string;
  /**
   * Supplies the payload. Injected so the server holds no knowledge of what a
   * project is, and so the parity test can compare it against the CLI.
   */
  readonly read: () => unknown;
  /** The page shell. Static, self-contained, no external request. */
  readonly html: string;
  readonly onListening?: (port: number) => void;
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  cors: Record<string, string>,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, {
    ...cors,
    ...securityHeaders(),
    ...extra,
    'Content-Type': contentType,
  });
  res.end(body);
}

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: CommandCenterOptions,
  auth: LiveAuth,
): void {
  const cors = corsFor(req.headers.origin);
  const url = new URL(req.url ?? '/', `http://${LOOPBACK}`);

  // Only reading is ever offered. There is no route that mutates a project,
  // because the view is a projection and a projection that writes is a second
  // source of truth.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'method not allowed', 'text/plain', cors, { Allow: 'GET, HEAD' });
    return;
  }

  if (url.pathname === '/auth') {
    const session = auth.exchange(url.searchParams.get('token') ?? '');
    if (session === undefined) {
      send(res, 403, 'forbidden', 'text/plain', cors);
      return;
    }
    res.writeHead(302, {
      ...cors,
      ...securityHeaders(),
      'Set-Cookie': sessionCookie(session, COOKIE),
      Location: '/',
    });
    res.end();
    return;
  }

  if (!auth.authorized(req.headers.cookie)) {
    send(res, 403, 'forbidden', 'text/plain', cors);
    return;
  }

  if (url.pathname === '/api/projects') {
    let payload: string;
    try {
      payload = JSON.stringify(opts.read());
    } catch {
      // One unreadable project must not take the page down; the reader already
      // degrades per project, so reaching here means something worse.
      send(res, 500, '{"error":"read failed"}', 'application/json', cors);
      return;
    }
    send(res, 200, payload, 'application/json', cors);
    return;
  }

  if (url.pathname === '/') {
    send(res, 200, opts.html, 'text/html; charset=utf-8', cors);
    return;
  }

  send(res, 404, 'not found', 'text/plain', cors);
}

/** Start the loopback-only command centre. Returns the live server. */
export function startCommandCenter(opts: CommandCenterOptions): Server {
  // Not one-shot: a dashboard is opened again and again, and a spent link would
  // mean restarting the command for a second browser or after clearing cookies.
  const auth = createLiveAuth(opts.launchToken, { oneShot: false, cookieName: COOKIE });
  const server = createServer((req, res) => handle(req, res, opts, auth));
  let port = opts.port;

  server.on('listening', () => {
    const address = server.address();
    // Truthiness rather than an explicit comparison: `address()` may answer with
    // an absent value, and the harness's own rule forbids naming that literal.
    opts.onListening?.(typeof address === 'object' && address ? address.port : port);
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    // A port already taken is ordinary on a developer machine: step along
    // rather than refuse to start.
    if (error.code === 'EADDRINUSE' && opts.port !== 0 && port - opts.port < PORT_RETRIES) {
      port += 1;
      server.listen(port, LOOPBACK);
      return;
    }
    throw error;
  });

  server.listen(port, LOOPBACK);
  return server;
}
