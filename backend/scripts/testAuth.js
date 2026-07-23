import fetch from 'node-fetch';
import fetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';
import 'dotenv/config';

const jar = new CookieJar();
const fetchWithCookies = fetchCookie(fetch, jar);

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';

const tmpUser = { username: `testuser${Date.now()%10000}`, fullName: 'Test User', password: 'testpassword123', registrationSecret: process.env.REGISTRATION_SECRET || 'changeme' };

const run = async () => {
  console.log('Testing register...');
  // Fetch csrf token first
  const t = await fetchWithCookies(`${BACKEND}/api/csrf-token`, { credentials: 'include' });
  const csrf = t.ok ? (await t.json()).csrfToken : null;

  const r = await fetchWithCookies(`${BACKEND}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf || '' }, body: JSON.stringify(tmpUser), credentials: 'include' });
  console.log('Register status', r.status);
  console.log(await r.text());

  console.log('Testing login...');
  const r2 = await fetchWithCookies(`${BACKEND}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf || '' }, body: JSON.stringify({ username: tmpUser.username, password: tmpUser.password }), credentials: 'include' });
  console.log('Login status', r2.status);
  console.log(await r2.text());

  console.log('Testing /api/me...');
  const r3 = await fetchWithCookies(`${BACKEND}/api/me`, { method: 'GET', credentials: 'include' });
  console.log('Me status', r3.status);
  console.log(await r3.text());
};

run().catch(err => { console.error(err); process.exit(1); });
