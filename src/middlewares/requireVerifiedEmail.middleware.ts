import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { ForbiddenError } from '../errors/ForbiddenError';
import { UnauthorizedError } from '../errors/UnauthorizedError';

export const requireVerifiedEmail = (req: Request, _res: Response, next: NextFunction): void => {
  if (!env.REQUIRE_EMAIL_VERIFICATION) return next();

  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  if (!req.user.emailVerifiedAt) {
    throw new ForbiddenError('Please verify your email address before continuing');
  }

  next();
};
