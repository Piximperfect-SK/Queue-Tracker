// Cross-origin deployments (frontend on Netlify, backend on Render) run into
// browsers increasingly blocking third-party cookies even when SameSite/
// Secure are set correctly. Rather than keep fighting that, the JWT is also
// returned directly in the login response body and carried explicitly as a
// Bearer token — for HTTP calls via the Authorization header, and for the
// socket.io handshake via its `auth` payload. The httpOnly cookie is still
// set by the backend too (harmless, and works fine for anyone on the same
// domain/staging setup), but nothing on the frontend depends on it anymore.
//
// Stored in sessionStorage rather than localStorage: cleared when the tab/
// browser closes, shrinking the window an XSS bug could exploit it in.

const TOKEN_KEY = 'accessToken';

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* sessionStorage unavailable (rare) — auth will just fall back to cookie */
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* noop */
  }
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
