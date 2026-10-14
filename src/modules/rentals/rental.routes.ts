import { Router } from 'express';
import * as rentalController from './rental.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { verifyTokenMiddleware } from '../../middlewares/auth.middleware.js';
import { requireVerifiedEmail } from '../../middlewares/requireVerifiedEmail.middleware.js';
import { idempotency } from '../../middlewares/idempotency.middleware.js';
import { verifyRole } from '../../middlewares/role.middleware.js';
import { Role } from '../../constants/roles.js';
import { createRentalSchema, rentalIdParamSchema, rentalQuerySchema } from './rental.validation.js';

const router = Router();

router.use(verifyTokenMiddleware);


router.post(
  '/',
  verifyRole(Role.CUSTOMER),
  requireVerifiedEmail,
  validate(createRentalSchema),
  idempotency(),
  rentalController.create,
);
// rental get route 
router.get(
  '/',
  verifyRole(Role.CUSTOMER),
  validate(rentalQuerySchema, 'query'),
  rentalController.listOwn,
);

// Pricing breakdown for an order — owner customer/provider or admin.
// Declared before GET /:id so the more specific path wins.
router.get(
  '/:id/breakdown',
  validate(rentalIdParamSchema, 'params'),
  rentalController.getBreakdown,
);

// GET /:id is shared: a customer viewing their own order and a provider
// viewing an order on their gear both land here — ownership is checked
// inside the service (getRentalByIdForUser), not by role middleware.
router.get('/:id', validate(rentalIdParamSchema, 'params'), rentalController.getById);

// update rental route 
router.patch(
  '/:id/cancel',
  verifyRole(Role.CUSTOMER),
  validate(rentalIdParamSchema, 'params'),
  rentalController.cancel,
);

export default router;
