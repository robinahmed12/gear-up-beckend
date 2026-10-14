import { Router } from 'express';
import * as paymentController from './payment.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { verifyTokenMiddleware } from '../../middlewares/auth.middleware.js';
import { verifyRole } from '../../middlewares/role.middleware.js';
import { requireVerifiedEmail } from '../../middlewares/requireVerifiedEmail.middleware.js';
import { Role } from '../../constants/roles.js';
import { idempotency } from '../../middlewares/idempotency.middleware.js';
import {
  createPaymentSchema,
  paymentIdParamSchema,
  paymentQuerySchema,
  refundSchema,
  depositOrderSchema,
  captureDepositSchema,
} from './payment.validation.js';

const router = Router();

// ─── Admin: refunds + security-deposit management ───
// Declared before the customer-wide guard below so these aren't forced to
// the CUSTOMER role (router.use only applies to routes registered after it).
router.post(
  '/refund',
  verifyTokenMiddleware,
  verifyRole(Role.ADMIN),
  validate(refundSchema),
  idempotency(),
  paymentController.refund,
);
router.post(
  '/deposit/capture',
  verifyTokenMiddleware,
  verifyRole(Role.ADMIN),
  validate(captureDepositSchema),
  paymentController.captureDeposit,
);
router.post(
  '/deposit/release',
  verifyTokenMiddleware,
  verifyRole(Role.ADMIN),
  validate(depositOrderSchema),
  paymentController.releaseDeposit,
);

// Only customers ever pay for a rental order — applied once here rather
// than repeated per-route, matching the provider-gear pattern.
router.use(verifyTokenMiddleware, verifyRole(Role.CUSTOMER));

router.post(
  '/create',
  requireVerifiedEmail,
  validate(createPaymentSchema),
  idempotency(),
  paymentController.create,
);
router.get('/', validate(paymentQuerySchema, 'query'), paymentController.listOwn);
router.get('/:id', validate(paymentIdParamSchema, 'params'), paymentController.getOwnById);

export default router;
