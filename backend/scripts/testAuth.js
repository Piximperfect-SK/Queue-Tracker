import fetch from 'node-fetch';
import 'dotenv/config';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';

const tmpUser = { username: `testuser${Date.now()%10000}`, fullName: 'Test User', password: 'testpassword123', registrationSecret: process.env.REGISTRATION_SECRET || 'changeme' };

const run = async () => {
  console.log('Testing register...');
  const r = await fetch(`${BACKEND}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tmpUser) });
  console.log('Register status', r.status);
  console.log(await r.text());

  console.log('Testing login...');
  const r2 = await fetch(`${BACKEND}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: tmpUser.username, password: tmpUser.password }), credentials: 'include' });
  console.log('Login status', r2.status);
  console.log(await r2.text());

  console.log('Testing /api/me...');
  const r3 = await fetch(`${BACKEND}/api/me`, { method: 'GET', credentials: 'include' });
  console.log('Me status', r3.status);
  console.log(await r3.text());
};

run().catch(err => { console.error(err); process.exit(1); });
