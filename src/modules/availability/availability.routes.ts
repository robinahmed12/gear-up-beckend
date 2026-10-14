import { Router } from 'express';
import * as availabilityController from './availability.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { gearAvailabilityParamSchema, availabilityQuerySchema } from './availability.validation.js';

// Mounted at `/api/gear/:id/availability` — mergeParams exposes `:id`.
const router = Router({ mergeParams: true });

router.get(
  '/',
  validate(gearAvailabilityParamSchema, 'params'),
  validate(availabilityQuerySchema, 'query'),
  availabilityController.getAvailability,
);

export default router;
