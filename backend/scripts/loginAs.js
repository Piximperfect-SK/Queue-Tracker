import fetch from 'node-fetch';
import fetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';
import 'dotenv/config';

const jar = new CookieJar();
const fetchWithCookies = fetchCookie(fetch, jar);

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';
const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PWD;

(async () => {
  const t = await fetchWithCookies(`${BACKEND}/api/csrf-token`, { credentials: 'include' });
  const csrf = t.ok ? (await t.json()).csrfToken : null;
  console.log('csrf token fetched?', !!csrf);
  const r = await fetchWithCookies(`${BACKEND}/api/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf || '' },
    body: JSON.stringify({ username, password })
  });
  console.log('Login status', r.status);
  console.log(await r.text());
  const r2 = await fetchWithCookies(`${BACKEND}/api/me`, { credentials: 'include' });
  console.log('/api/me status', r2.status);
  console.log(await r2.text());
})();
