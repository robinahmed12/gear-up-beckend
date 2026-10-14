import { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { UnauthorizedError } from '../../errors/UnauthorizedError.js';
import * as availabilityService from './availability.service.js';

// Public: check whether a gear item is free for a given window.
export const getAvailability = catchAsync(async (req: Request, res: Response) => {
  const availability = await availabilityService.getGearAvailability(
    req.params.id,
    req.query as never,
  );

  sendSuccess(res, {
    message: availability.available
      ? 'Gear is available for the selected dates'
      : 'Gear is not available for the selected dates',
    data: availability,
  });
});

// Provider: list blackout blocks for one of their gear items.
export const listBlocks = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const blocks = await availabilityService.listGearBlocks(req.params.id, req.user.id);

  sendSuccess(res, {
    message: 'Availability blocks fetched successfully',
    data: blocks,
  });
});

// Provider: create a blackout block.
export const createBlock = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const block = await availabilityService.createGearBlock(req.params.id, req.user.id, req.body);

  sendSuccess(res, {
    statusCode: 201,
    message: 'Availability block created successfully',
    data: block,
  });
});

// Provider: remove a blackout block.
export const deleteBlock = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  await availabilityService.deleteGearBlock(req.params.id, req.params.blockId, req.user.id);

  sendSuccess(res, {
    message: 'Availability block deleted successfully',
  });
});
