import { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/ApiResponse';
import * as authService from './auth.service';
import { SessionMeta } from './auth.service';
import { UnauthorizedError } from '../../errors/UnauthorizedError';

const sessionMeta = (req: Request): SessionMeta => ({
  userAgent: req.headers['user-agent'],
  ip: req.ip,
});

// register user
export const register = catchAsync(async (req: Request, res: Response) => {
  const { user, token, refreshToken } = await authService.registerUser(req.body, sessionMeta(req));

  sendSuccess(res, {
    statusCode: 201,
    message: 'Account created successfully. Please check your email to verify your account.',
    data: { user, token, refreshToken },
  });
});

// login user
export const login = catchAsync(async (req: Request, res: Response) => {
  const { user, token, refreshToken } = await authService.loginUser(req.body, sessionMeta(req));

  sendSuccess(res, {
    statusCode: 200,
    message: 'Logged in successfully',
    data: { user, token, refreshToken },
  });
});

// exchange a valid refresh token for a new access + refresh token pair
export const refresh = catchAsync(async (req: Request, res: Response) => {
  const { user, token, refreshToken } = await authService.refreshSession(
    req.body.refreshToken,
    sessionMeta(req),
  );

  sendSuccess(res, {
    message: 'Token refreshed successfully',
    data: { user, token, refreshToken },
  });
});

export const logout = catchAsync(async (req: Request, res: Response) => {
  await authService.logout(req.body.refreshToken);
  sendSuccess(res, { message: 'Logged out successfully' });
});

export const logoutAll = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  await authService.logoutAll(req.user.id);
  sendSuccess(res, { message: 'Logged out from all devices successfully' });
});

export const verifyEmail = catchAsync(async (req: Request, res: Response) => {
  await authService.verifyEmail(req.body.token);
  sendSuccess(res, { message: 'Email verified successfully' });
});

export const resendVerification = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  await authService.resendVerification(req.user.id);
  sendSuccess(res, { message: 'Verification email sent' });
});

export const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  await authService.requestPasswordReset(req.body.email);
  sendSuccess(res, {
    message: 'If an account with that email exists, a reset link has been sent.',
  });
});

export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body.token, req.body.newPassword);
  sendSuccess(res, { message: 'Password reset successfully. Please log in again.' });
});

// fetched logged in user details
export const getMe = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  const user = await authService.getCurrentUser(req.user.id);

  sendSuccess(res, {
    statusCode: 200,
    message: 'Current user fetched successfully',
    data: { user },
  });
});

// profile manage
export const updateProfile = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  const user = await authService.updateProfile(req.user.id, req.body);

  sendSuccess(res, {
    message: 'Profile updated successfully',
    data: { user },
  });
});

export const changePassword = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  await authService.changePassword(req.user.id, req.body);

  sendSuccess(res, {
    message: 'Password changed successfully',
  });
});
