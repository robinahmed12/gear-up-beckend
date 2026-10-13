import { execSync } from 'node:child_process';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let activeContainer: StartedPostgreSqlContainer | null = null;

/**
 * Spins up an ephemeral Postgres container and applies every Prisma migration
 * to it. Returns the connection string, or null if Docker isn't available so
 * callers can skip integration tests gracefully instead of failing.
 */
export const startTestDatabase = async (): Promise<string | null> => {
  try {
    const container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('gearup_test')
      .withUsername('gearup')
      .withPassword('gearup')
      .start();

    const url = container.getConnectionUri();

    execSync('npx prisma migrate deploy', {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: url },
    });

    activeContainer = container;
    return url;
  } catch (error) {
    console.warn(
      '[integration] Postgres container unavailable - skipping integration tests:',
      (error as Error).message,
    );
    return null;
  }
};

export const stopTestDatabase = async (): Promise<void> => {
  await activeContainer?.stop();
  activeContainer = null;
};
