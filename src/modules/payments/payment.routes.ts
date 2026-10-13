import { Router } from 'express';
import * as paymentController from './payment.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { verifyTokenMiddleware } from '../../middlewares/auth.middleware.js';
import { verifyRole } from '../../middlewares/role.middleware.js';
import { requireVerifiedEmail } from '../../middlewares/requireVerifiedEmail.middleware.js';
import { Role } from '../../constants/roles.js';
import {
  createPaymentSchema,
  paymentIdParamSchema,
  paymentQuerySchema,
} from './payment.validation.js';

const router = Router();

// Only customers ever pay for a rental order — applied once here rather
// than repeated per-route, matching the provider-gear pattern.
router.use(verifyTokenMiddleware, verifyRole(Role.CUSTOMER));

router.post(
  '/create',
  requireVerifiedEmail,
  validate(createPaymentSchema),
  paymentController.create,
);
router.get('/', validate(paymentQuerySchema, 'query'), paymentController.listOwn);
router.get('/:id', validate(paymentIdParamSchema, 'params'), paymentController.getOwnById);

export default router;
