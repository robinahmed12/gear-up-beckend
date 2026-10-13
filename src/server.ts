import { app } from './app';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { logger } from './utils/logger';
import { initSentry } from './config/sentry';

initSentry();

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 GearUp API running on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

/**
 * Graceful shutdown: stop accepting new connections, close the Prisma
 * connection pool, then exit. Prevents dangling DB connections when the
 * host (Render, Docker, etc.) sends a termination signal.
 */
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Server closed. Process terminated.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Safety net for bugs that slip past our own error handling.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', { reason });
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { error });
  process.exit(1);
});
