export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'AppError';
    // Maintains proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 422, 'VALIDATION_ERROR');
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class InsufficientFundsError extends AppError {
  constructor() {
    super('Insufficient funds', 422, 'INSUFFICIENT_FUNDS');
    Object.setPrototypeOf(this, InsufficientFundsError.prototype);
  }
}
