import { Router } from 'express';
import * as authController from './auth.controller';
import { validate } from '../../middlewares/validate.middleware';
import { authRateLimiter } from '../../middlewares/rateLimit.middleware';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  tokenSchema,
  verifyRegistrationOtpSchema,
  resendRegistrationOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  changePasswordSchema,
} from './auth.validation';
import { verifyTokenMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
// auth related endpoint
router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post(
  '/register/verify-otp',
  authRateLimiter,
  validate(verifyRegistrationOtpSchema),
  authController.verifyRegistrationOtp,
);
router.post(
  '/register/resend-otp',
  authRateLimiter,
  validate(resendRegistrationOtpSchema),
  authController.resendRegistrationOtp,
);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authRateLimiter, validate(refreshTokenSchema), authController.refresh);
router.post('/logout', authRateLimiter, validate(refreshTokenSchema), authController.logout);
router.post('/logout-all', verifyTokenMiddleware, authController.logoutAll);
router.post('/verify-email', authRateLimiter, validate(tokenSchema), authController.verifyEmail);
router.post(
  '/forgot-password',
  authRateLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword,
);
router.post(
  '/reset-password',
  authRateLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword,
);

router.get('/me', verifyTokenMiddleware, authController.getMe);
router.patch(
  '/me',
  verifyTokenMiddleware,
  validate(updateProfileSchema),
  authController.updateProfile,
);
// reset password
router.patch(
  '/me/password',
  verifyTokenMiddleware,
  validate(changePasswordSchema),
  authController.changePassword,
);

export default router;
