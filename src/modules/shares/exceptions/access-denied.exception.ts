import { ForbiddenException } from '@nestjs/common';

/**
 * Thrown when a user does not have sufficient permission to perform
 * the requested action on a shared file.
 */
export class AccessDeniedException extends ForbiddenException {
  constructor(message = 'ACCESS_DENIED') {
    super({ error: 'ACCESS_DENIED', message });
  }
}
