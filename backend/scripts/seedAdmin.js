import bcrypt from 'bcrypt';
import User from '../models/User.js';

/**
 * Seed the default admin user.
 * Credentials: username = "shubham.kumar", password = "QHAdmin"
 * Full name: "Shubham Kumar", Role: admin
 */
export async function seedAdmin() {
  try {
    const existing = await User.findOne({ username: 'shubham.kumar' });
    if (existing) {
      // Ensure admin role
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        await existing.save();
        console.log('Default admin user found. Role set to admin.');
      } else {
        console.log('Default admin user already exists with admin role.');
      }
      return;
    }

    const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
    const hash = await bcrypt.hash('QHAdmin', BCRYPT_ROUNDS);

    await User.create({
      username: 'shubham.kumar',
      fullName: 'Shubham Kumar',
      passwordHash: hash,
      role: 'admin',
      isActive: true,
    });

    console.log('Default admin user created:');
    console.log('  Username: shubham.kumar');
    console.log('  Password: QHAdmin');
    console.log('  Role: admin');
    console.log('  Full Name: Shubham Kumar');
    console.log('');
    console.log('⚠️  IMPORTANT: Change the default password after first login!');
  } catch (err) {
    console.error('Failed to seed admin user:', err.message);
  }
}