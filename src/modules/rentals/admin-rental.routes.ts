import { Router } from 'express';
import * as rentalController from './rental.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { verifyTokenMiddleware } from '../../middlewares/auth.middleware.js';
import { verifyRole } from '../../middlewares/role.middleware.js';
import { Role } from '../../constants/roles.js';
import { rentalIdParamSchema, adminRentalQuerySchema, adminUpdateRentalStatusSchema } from './rental.validation.js';

const router = Router();

/**
 * Admin Rental Routes
 * -------------------
 * All routes in this file are restricted to ADMIN users.
 * - Token verification and role check are applied globally via router.use().
 * - Routes provide administrative access to rental orders, including listing
 *   all orders and retrieving details by ID.
 */
router.use(verifyTokenMiddleware, verifyRole(Role.ADMIN));

/**
 * GET /
 * -----
 * Retrieves all rental orders for administrative purposes.
 * - Supports query parameters for filtering, sorting, and pagination.
 * - Validates query against adminRentalQuerySchema.
 */
router.get('/', validate(adminRentalQuerySchema, 'query'), rentalController.listAllForAdmin);

/**
 * GET /:id
 * --------
 * Retrieves details of a specific rental order by ID.
 * - Validates route params against rentalIdParamSchema.
 * - Reuses the same controller handler used by customers/providers,
 *   but grants access when requester has ADMIN role.
 */
router.get('/:id', validate(rentalIdParamSchema, 'params'), rentalController.getById);

/**
 * PATCH /:id/status
 * -----------------
 * Admin override: force any order status, bypassing the normal transition
 * graph (e.g. to recover a mis-sequenced order).
 */
router.patch(
  '/:id/status',
  validate(rentalIdParamSchema, 'params'),
  validate(adminUpdateRentalStatusSchema),
  rentalController.adminUpdateStatus,
);

export default router;
