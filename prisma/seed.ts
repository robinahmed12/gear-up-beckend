import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/prisma.js';
import { Role } from '../src/constants/roles.js';

/**
 * Seed strategy:
 * 1. Admin user — required so the assignment's "working admin credentials"
 *    requirement is satisfiable immediately after a fresh migration.
 * 2. Baseline categories — the gear catalog is unusable until at least a
 *    few categories exist, and provider/gear seed data (if you add any
 *    later) will need a categoryId to attach to.
 *
 * `upsert` is used throughout so the seed script is safe to re-run against
 * an existing database without creating duplicates or throwing on unique
 * constraint violations.
 */

const ADMIN_EMAIL = 'admin@gearup.com';
const ADMIN_PASSWORD = 'Admin@123';

// Demo accounts shown on the login page. They are seeded already-verified so
// a grader can log straight into a dashboard without an email round-trip.
const DEMO_PASSWORD = 'Password@#12';
const DEMO_ACCOUNTS = [
  { name: 'Robin Customer', email: 'robin.gearup@yopmail.com', role: Role.CUSTOMER },
  { name: 'Robin Provider', email: 'robin.gearup12@yopmail.com', role: Role.PROVIDER },
] as const;

const DEFAULT_CATEGORIES = [
  { name: 'Cycling', description: 'Bikes, helmets, and cycling accessories' },
  { name: 'Camping', description: 'Tents, sleeping bags, and camp gear' },
  { name: 'Fitness', description: 'Weights, mats, and home gym equipment' },
  { name: 'Water Sports', description: 'Kayaks, paddleboards, and life vests' },
  { name: 'Winter Sports', description: 'Skis, snowboards, and cold-weather gear' },
];

async function seedAdmin(): Promise<void> {
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { emailVerifiedAt: new Date() },
    create: {
      name: 'GearUp Admin',
      email: ADMIN_EMAIL,
      password: hashedPassword,
      role: Role.ADMIN,
      emailVerifiedAt: new Date(),
    },
  });

  console.log('✅ Admin user ready:', admin.email);
}

async function seedDemoAccounts(): Promise<void> {
  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 12);

  for (const account of DEMO_ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {
        name: account.name,
        password: hashedPassword,
        role: account.role,
        emailVerifiedAt: new Date(),
      },
      create: {
        name: account.name,
        email: account.email,
        password: hashedPassword,
        role: account.role,
        emailVerifiedAt: new Date(),
      },
    });

    console.log('✅ Demo user ready:', user.email, `(${user.role})`);
  }
}

async function seedCategories(): Promise<void> {
  for (const category of DEFAULT_CATEGORIES) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }

  console.log(`✅ Seeded ${DEFAULT_CATEGORIES.length} categories`);
}

async function main(): Promise<void> {
  await seedAdmin();
  await seedDemoAccounts();
  await seedCategories();

  console.log('\nAdmin login:');
  console.log('  email:   ', ADMIN_EMAIL);
  console.log('  password:', ADMIN_PASSWORD);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
