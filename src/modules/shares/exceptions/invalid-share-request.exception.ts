import { BadRequestException } from '@nestjs/common';

/**
 * Thrown when a share request contains invalid data.
 */
export class InvalidShareRequestException extends BadRequestException {
  constructor(message = 'Invalid share request') {
    super({ error: 'INVALID_SHARE_REQUEST', message });
  }
}
