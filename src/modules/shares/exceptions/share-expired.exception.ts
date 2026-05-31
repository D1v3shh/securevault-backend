import { GoneException } from '@nestjs/common';

/**
 * Thrown when an access check finds the share has expired.
 */
export class ShareExpiredException extends GoneException {
  constructor(message = 'Share has expired') {
    super({ error: 'SHARE_EXPIRED', message });
  }
}
