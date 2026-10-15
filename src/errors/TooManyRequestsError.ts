import { AppError } from './AppError';

/** 429 — the caller is acting too frequently (e.g. resending a code). */
export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, please try again later.') {
    super(message, 429);
  }
}
