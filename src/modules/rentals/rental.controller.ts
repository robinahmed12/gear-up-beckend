import { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { UnauthorizedError } from '../../errors/UnauthorizedError.js';
import * as rentalService from './rental.service.js';

/**
 * Controller: create
 * ------------------
 * Places a new rental order for the authenticated customer.
 * - Requires a logged-in user (throws UnauthorizedError if missing).
 * - Delegates order creation to rentalService.
 * - Responds with a 201 status and the created order details.
 */
export const create = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const order = await rentalService.createRentalOrder(req.user.id, req.body);

  sendSuccess(res, {
    statusCode: 201,
    message: 'Rental order placed successfully',
    data: order,
  });
});

/**
 * Controller: listOwn
 * -------------------
 * Retrieves rental orders belonging to the authenticated customer.
 * - Requires a logged-in user.
 * - Supports query parameters for pagination/filtering.
 * - Delegates retrieval to rentalService.
 */
export const listOwn = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const { items, meta } = await rentalService.getCustomerRentals(req.user.id, req.query as never);

  sendSuccess(res, {
    message: 'Your rental orders fetched successfully',
    data: items,
    meta,
  });
});

/**
 * Controller: getById
 * -------------------
 * Retrieves details of a specific rental order for the authenticated user.
 * - Requires a logged-in user.
 * - Accepts order ID from route params.
 * - Delegates retrieval to rentalService.
 */
export const getById = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const order = await rentalService.getRentalByIdForUser(req.params.id, req.user);

  sendSuccess(res, {
    message: 'Rental order details fetched successfully',
    data: order,
  });
});

/**
 * Controller: getBreakdown
 * ------------------------
 * Returns the frozen pricing breakdown (subtotal/fees/deposit/tax/total) and
 * itemized line items for an order. Visible to the owning customer, the
 * provider, or an admin — the service enforces this.
 */
export const getBreakdown = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const breakdown = await rentalService.getRentalBreakdown(req.params.id, req.user);

  sendSuccess(res, {
    message: 'Rental order breakdown fetched successfully',
    data: breakdown,
  });
});

/**
 * Controller: cancel
 * Cancels a rental order for the authenticated customer.
 * - Requires a logged-in user.
 * - Accepts order ID from route params.
 * - Delegates cancellation to rentalService.
 */
export const cancel = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const order = await rentalService.cancelRentalOrder(req.params.id, req.user.id);

  sendSuccess(res, {
    message: 'Rental order cancelled successfully',
    data: order,
  });
});

/**
 * Controller: listProviderOrders
 * ------------------------------
 * Retrieves incoming rental orders for a provider (gear owner).
 * - Requires a logged-in user.
 * - Supports query parameters for pagination/filtering.
 * - Delegates retrieval to rentalService.
 */
export const listProviderOrders = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const { items, meta } = await rentalService.getProviderOrders(req.user.id, req.query as never);

  sendSuccess(res, {
    message: 'Incoming orders fetched successfully',
    data: items,
    meta,
  });
});

/**
 * Controller: updateStatus
 * ------------------------
 * Updates the status of a rental order (e.g., accepted, rejected, completed).
 * - Requires a logged-in user.
 * - Accepts order ID from route params and status payload from request body.
 * - Delegates update logic to rentalService.
 */
export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const order = await rentalService.updateOrderStatus(req.params.id, req.user.id, req.body);

  sendSuccess(res, {
    message: 'Order status updated successfully',
    data: order,
  });
});

/**
 * Controller: listAllForAdmin
 * ---------------------------
 * Retrieves all rental orders for administrative purposes.
 * - Does not require authentication (assumed admin middleware handles access).
 * - Supports query parameters for pagination/filtering.
 * - Delegates retrieval to rentalService.
 */
export const listAllForAdmin = catchAsync(async (req: Request, res: Response) => {
  const { items, meta } = await rentalService.getAllRentalsForAdmin(req.query as never);

  sendSuccess(res, {
    message: 'All rental orders fetched successfully',
    data: items,
    meta,
  });
});
