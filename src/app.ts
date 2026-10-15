import express, { Application, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { notFoundHandler } from './middlewares/notFound.middleware';
import { globalErrorHandler } from './middlewares/error.middleware';
import { requestIdMiddleware } from './middlewares/requestId.middleware';
import { generalRateLimiter } from './middlewares/rateLimit.middleware';
import { sendSuccess } from './utils/ApiResponse';
import { openApiDocument } from './docs/openapi';

import authRoutes from './modules/auth/auth.routes';
import gearRoutes from './modules/gear/gear.routes.js';
import providerGearRoutes from './modules/gear/provider-gear.routes.js';
import adminGearRoutes from './modules/gear/admin-gear.routes.js';
import gearAvailabilityRoutes from './modules/availability/availability.routes.js';
import providerAvailabilityRoutes from './modules/availability/provider-availability.routes.js';
import rentalRoutes from './modules/rentals/rental.routes.js';
import providerOrderRoutes from './modules/rentals/provider-order.routes.js';
import adminRentalRoutes from './modules/rentals/admin-rental.routes.js';
import reviewRoutes from './modules/reviews/review.routes.js';
import gearReviewsRoutes from './modules/reviews/gear-reviews.routes.js';
import categoryRoutes from './modules/categories/category.routes.js';
import adminCategoryRoutes from './modules/categories/admin-category.routes.js';
import adminUserRoutes from './modules/users/admin-user.routes.js';
import adminPaymentRoutes from './modules/payments/admin-payment.routes.js';
import paymentRoutes from './modules/payments/payment.routes.js';
import paymentWebhookRoutes from './modules/payments/payment.webhook.js';

export const app: Application = express();

// Behind a single reverse proxy (Vercel/Heroku/nginx), trust the platform's
// X-Forwarded-For so `req.ip` is the real client and express-rate-limit can
// key on it. Must be a hop count (1), not `true` — express-rate-limit rejects
// a permissive `true` and throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR otherwise.
app.set('trust proxy', 1);

// --- Global middleware ---
app.use(requestIdMiddleware);
app.use(helmet());

const allowedOrigins = env.CORS_ORIGIN;
const allowAllOrigins = allowedOrigins.includes('*');

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowAllOrigins || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: !allowAllOrigins,
  }),
);
app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));

/**
 * Stripe's webhook route needs the raw request body to verify the
 * signature, so it's mounted BEFORE express.json() with its own
 * express.raw() middleware — everything else in the app parses JSON
 * normally. It is also intentionally mounted before the global rate
 * limiter so Stripe's retries are never throttled.
 */
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }), paymentWebhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(generalRateLimiter);

// --- Health checks ---
app.get('/', (_req: Request, res: Response) => {
  sendSuccess(res, { message: 'GearUp API is up and running', data: { uptime: process.uptime() } });
});

app.get('/api/health', (_req: Request, res: Response) => {
  sendSuccess(res, {
    message: 'GearUp API is healthy',
    data: { status: 'ok', uptime: process.uptime() },
  });
});

app.get('/api/health/ready', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    sendSuccess(res, { message: 'GearUp API is ready', data: { status: 'ready' } });
  } catch {
    res.status(503).json({
      success: false,
      message: 'Service is not ready',
      errorDetails: null,
    });
  }
});

// --- Feature routes ---
app.use('/api/auth', authRoutes);
app.use('/api/gear/:id/availability', gearAvailabilityRoutes);
app.use('/api/provider/gear/:id/blocks', providerAvailabilityRoutes);
app.use('/api/gear', gearRoutes);
app.use('/api/provider/gear', providerGearRoutes);
app.use('/api/rentals', rentalRoutes);
app.use('/api/provider/orders', providerOrderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/gear/:id/reviews', gearReviewsRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/payments', paymentRoutes);

// --- Admin routes ---
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/categories', adminCategoryRoutes);
app.use('/api/admin/rentals', adminRentalRoutes);
app.use('/api/admin/payments', adminPaymentRoutes);
app.use('/api/admin/gear', adminGearRoutes);

// --- API docs ---
app.get('/api/docs.json', (_req: Request, res: Response) => res.json(openApiDocument));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

// --- 404 + global error handler (must be registered last, in this order) ---
app.use(notFoundHandler);
app.use((err: unknown, req: Request, res: Response, next: NextFunction) =>
  globalErrorHandler(err, req, res, next),
);
