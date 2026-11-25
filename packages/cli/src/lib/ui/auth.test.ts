import { describe, expect, it } from 'vitest';
import { createLiveAuth, sessionCookie } from './auth.js';

describe('local UI auth', () => {
  it('exchanges the launch token once and authorizes only its session cookie', () => {
    const auth = createLiveAuth('launch-secret');
    expect(auth.exchange('wrong')).toBeUndefined();
    const session = auth.exchange('launch-secret');
    expect(session).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(auth.exchange('launch-secret')).toBeUndefined();
    expect(auth.authorized(`other=x; void_mission_session=${session}`)).toBe(true);
    expect(auth.authorized('void_mission_session=wrong')).toBe(false);
  });

  it('renders a host-only, HttpOnly, strict cookie for local HTTP', () => {
    expect(sessionCookie('opaque')).toBe(
      'void_mission_session=opaque; HttpOnly; SameSite=Strict; Path=/',
    );
  });
});
