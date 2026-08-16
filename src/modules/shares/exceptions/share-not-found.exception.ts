import { NotFoundException } from '@nestjs/common';

/**
 * Thrown when a share record cannot be found.
 */
export class ShareNotFoundException extends NotFoundException {
  constructor(message = 'Share not found') {
    super({ error: 'SHARE_NOT_FOUND', message });
  }
}
