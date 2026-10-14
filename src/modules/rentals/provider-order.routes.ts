import { Router } from 'express';
import * as rentalController from './rental.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { verifyTokenMiddleware } from '../../middlewares/auth.middleware.js';
import { verifyRole } from '../../middlewares/role.middleware.js';
import { Role } from '../../constants/roles.js';
import {
  rentalIdParamSchema,
  rentalQuerySchema,
  updateRentalStatusSchema,
} from './rental.validation.js';

const router = Router();

router.use(verifyTokenMiddleware, verifyRole(Role.PROVIDER));

router.get('/', validate(rentalQuerySchema, 'query'), rentalController.listProviderOrders);
router.patch(
  '/:id/status',
  validate(rentalIdParamSchema, 'params'),
  validate(updateRentalStatusSchema),
  rentalController.updateStatus,
);

// Provider-initiated cancellation of an order on gear they own. Always
// refunds the full charge; the shared handler decides that from the actor.
router.patch(
  '/:id/cancel',
  validate(rentalIdParamSchema, 'params'),
  rentalController.cancel,
);

export default router;
