import AccessCode, { encryptCode, generateCode } from '../models/AccessCode.js';

/**
 * Seed one access code per role if none exist yet. Printed to console ONCE
 * at creation time — after that, view/regenerate via the Admin settings
 * panel (GET/POST /api/access/codes), never again from server logs.
 */
export async function seedAccessCodes() {
  try {
    const roles = ['admin', 'queue_handler', 'associate'];
    const generated = {};

    for (const role of roles) {
      const existing = await AccessCode.findOne({ role });
      if (existing) continue;

      const code = generateCode();
      await AccessCode.create({
        role,
        encryptedCode: encryptCode(code),
        updatedBy: 'system (initial seed)',
      });
      generated[role] = code;
    }

    if (Object.keys(generated).length > 0) {
      console.log('--- ACCESS CODES GENERATED (first boot only) ---');
      for (const [role, code] of Object.entries(generated)) {
        console.log(`  ${role}: ${code}`);
      }
      console.log('Log in as admin and note these down — manage/regenerate them from Settings going forward.');
      console.log('-------------------------------------------------');
    }
  } catch (err) {
    console.error('Failed to seed access codes:', err.message);
  }
}
