import { NextFunction, Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { captureException } from '../config/sentry';

interface ErrorPayload {
  success: false;
  message: string;
  errorDetails: unknown;
}

/**
 * Single place where every error in the app is turned into a consistent
 * JSON response: { success: false, message, errorDetails }.
 *
 * Must be registered LAST, after all routes and after notFoundHandler,
 * and must keep all four params (err, req, res, next) — Express only
 * treats a middleware as an error handler when it has exactly 4 args.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const globalErrorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  let statusCode = 500;
  let message = 'Something went wrong on the server';
  let errorDetails: unknown = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    errorDetails = err.errorDetails ?? null;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    errorDetails = err.flatten();
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        statusCode = 409;
        message = `Duplicate value for field(s): ${(err.meta?.target as string[])?.join(', ')}`;
        break;
      case 'P2025':
        statusCode = 404;
        message = 'Record not found';
        break;
      case 'P2003':
        statusCode = 400;
        message = 'Invalid reference to a related record';
        break;
      default:
        statusCode = 400;
        message = 'Database request error';
    }
    errorDetails = env.NODE_ENV === 'development' ? { code: err.code, meta: err.meta } : null;
  } else if (err instanceof Error) {
    message = env.NODE_ENV === 'development' ? err.message : message;
  }

  // Log full detail server-side regardless of what we expose to the client.
  const requestId = req.id ? ` [${req.id}]` : '';
  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl}${requestId} - ${message}`, { error: err });
    captureException(err);
  } else {
    logger.warn(`${req.method} ${req.originalUrl}${requestId} - ${message}`);
  }

  const payload: ErrorPayload = {
    success: false,
    message,
    errorDetails: errorDetails ?? null,
  };

  res.status(statusCode).json(payload);
};
