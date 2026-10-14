import { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { UnauthorizedError } from '../../errors/UnauthorizedError.js';
import * as paymentService from './payment.service.js';
import * as depositService from './deposit.service.js';
import * as refundService from './refund.service.js';

// ─── Admin oversight ───

export const listAll = catchAsync(async (req: Request, res: Response) => {
  const { items, meta } = await paymentService.listPaymentsForAdmin(req.query as never);

  sendSuccess(res, {
    message: 'Payments fetched successfully',
    data: items,
    meta,
  });
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const payment = await paymentService.getPaymentByIdForAdmin(req.params.id);

  sendSuccess(res, {
    message: 'Payment details fetched successfully',
    data: payment,
  });
});

// ─── Customer-facing ───

export const create = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const { payment, clientSecret, deposit } = await paymentService.createStripePayment(
    req.user.id,
    req.body,
  );

  sendSuccess(res, {
    statusCode: 201,
    message: 'Payment initiated successfully',
    data: { payment, clientSecret, deposit },
  });
});

// get payment history

export const listOwn = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const { items, meta } = await paymentService.getPaymentHistoryForCustomer(
    req.user.id,
    req.query as never,
  );

  sendSuccess(res, {
    message: 'Your payment history fetched successfully',
    data: items,
    meta,
  });
});

export const getOwnById = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();

  const payment = await paymentService.getPaymentByIdForCustomer(req.params.id, req.user.id);

  sendSuccess(res, {
    message: 'Payment details fetched successfully',
    data: payment,
  });
});

// ─── Refunds & security deposits (admin) ───

export const refund = catchAsync(async (req: Request, res: Response) => {
  const refund = await refundService.createRefund(req.body);

  sendSuccess(res, {
    statusCode: 201,
    message: 'Refund issued successfully',
    data: refund,
  });
});

export const captureDeposit = catchAsync(async (req: Request, res: Response) => {
  const { rentalOrderId, amount, reason } = req.body;
  const deposit = await depositService.captureDepositForOrder(rentalOrderId, { amount, reason });

  sendSuccess(res, {
    message: 'Security deposit captured successfully',
    data: deposit,
  });
});

export const releaseDeposit = catchAsync(async (req: Request, res: Response) => {
  const { rentalOrderId } = req.body;
  const deposit = await depositService.releaseDepositForOrder(rentalOrderId);

  sendSuccess(res, {
    message: 'Security deposit released successfully',
    data: deposit,
  });
});
