import { randomBytes, timingSafeEqual } from 'node:crypto';

export const LIVE_SESSION_COOKIE = 'void_mission_session';

function constantEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export interface LiveAuth {
  exchange(supplied: string): string | undefined;
  authorized(cookieHeader: string | undefined): boolean;
}

export interface LiveAuthOptions {
  /**
   * Whether the launch token dies on first use. Default true, which is what a
   * one-off inspection surface wants.
   *
   * A surface reopened all day wants false: a dashboard gets opened in a second
   * browser, on a second screen, after cookies are cleared, and a one-shot link
   * turns each of those into "restart the command". The secret is printed on
   * the owner's own terminal and dies with the process, so anyone able to read
   * that scrollback can already read what the page summarises.
   */
  readonly oneShot?: boolean;
  /**
   * Cookie name. Distinct per surface ON PURPOSE: cookies ignore the port, so
   * two loopback servers sharing a name overwrite each other's session and
   * opening one logs you out of the other.
   */
  readonly cookieName?: string;
}

/** One process-local launch exchange. No token or session is persisted. */
export function createLiveAuth(launchToken: string, options: LiveAuthOptions = {}): LiveAuth {
  const sessionToken = randomBytes(32).toString('base64url');
  const oneShot = options.oneShot ?? true;
  const cookieName = options.cookieName ?? LIVE_SESSION_COOKIE;
  let launchConsumed = false;
  return {
    exchange: (supplied) => {
      if ((oneShot && launchConsumed) || !constantEqual(supplied, launchToken)) {
        return undefined;
      }
      launchConsumed = true;
      return sessionToken;
    },
    authorized: (header) => {
      const supplied = cookieValue(header, cookieName);
      return supplied !== undefined && constantEqual(supplied, sessionToken);
    },
  };
}

export function sessionCookie(sessionToken: string, cookieName = LIVE_SESSION_COOKIE): string {
  return `${cookieName}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`;
}
