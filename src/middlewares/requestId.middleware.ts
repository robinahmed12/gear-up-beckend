import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  req.id = requestId;
  res.setHeader('x-request-id', requestId);
  next();
};
