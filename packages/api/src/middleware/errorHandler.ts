// ============================================
// LeadChat API — Global Error Handler Middleware
// Catches all unhandled errors and returns
// consistent API responses
// ============================================

import type { Request, Response, NextFunction } from 'express';

/** Custom application error with HTTP status code */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly details?: any,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Express global error handling middleware.
 * Must be registered AFTER all routes.
 *
 * Handles:
 * - AppError instances (known errors with status codes)
 * - Zod validation errors
 * - Unknown errors (500 with generic message)
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Log the full error in development
  if (process.env['NODE_ENV'] === 'development') {
    console.error('❌ Error:', err);
  } else {
    console.error('❌ Error:', err.message);
  }

  // Known application error
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code || 'APP_ERROR',
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  // Zod validation error
  if (err.name === 'ZodError') {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err,
      },
    });
    return;
  }

  // Unknown error — never leak internals to client
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
    },
  });
}
