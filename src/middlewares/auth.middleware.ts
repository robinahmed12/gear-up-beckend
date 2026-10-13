import { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../errors/UnauthorizedError';
import { verifyToken as verifyJwt } from '../utils/jwt';
import { prisma } from '../config/prisma';
import { catchAsync } from '../utils/catchAsync';

/**
 * Verifies the Bearer token, then re-fetches a minimal user record
 * (id, role, status) from the DB rather than trusting the token alone.
 * This matters because it's the only way to catch a user who was
 * suspended by an admin AFTER their token was already issued — the JWT
 * itself has no way of knowing that happened.
 */
export const verifyTokenMiddleware = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication token missing. Expected: Bearer <token>');
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = verifyJwt(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, role: true, status: true, emailVerifiedAt: true },
    });

    if (!user) {
      throw new UnauthorizedError('User belonging to this token no longer exists');
    }

    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedError('Your account has been suspended. Contact support.');
    }

    req.user = { id: user.id, role: user.role, emailVerifiedAt: user.emailVerifiedAt };
    next();
  },
);
