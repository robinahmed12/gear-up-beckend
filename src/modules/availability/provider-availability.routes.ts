import { Router } from 'express';
import * as availabilityController from './availability.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { verifyTokenMiddleware } from '../../middlewares/auth.middleware.js';
import { verifyRole } from '../../middlewares/role.middleware.js';
import { Role } from '../../constants/roles.js';
import {
  gearAvailabilityParamSchema,
  createBlockSchema,
  blockParamSchema,
} from './availability.validation.js';

// Mounted at `/api/provider/gear/:id/blocks` — mergeParams exposes `:id`.
const router = Router({ mergeParams: true });

router.use(verifyTokenMiddleware, verifyRole(Role.PROVIDER));

router.get('/', validate(gearAvailabilityParamSchema, 'params'), availabilityController.listBlocks);
router.post(
  '/',
  validate(gearAvailabilityParamSchema, 'params'),
  validate(createBlockSchema),
  availabilityController.createBlock,
);
router.delete(
  '/:blockId',
  validate(blockParamSchema, 'params'),
  availabilityController.deleteBlock,
);

export default router;
