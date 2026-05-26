import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import Redis from 'ioredis';
import { JwtPayload, AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { APP_CONSTANTS, INJECTION_TOKENS } from '../../../shared/constants/app.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    @Inject(INJECTION_TOKENS.REDIS_CLIENT)
    private readonly redis: Redis,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.accessSecret')!,
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    // Check if token has been blacklisted (post-logout)
    const token = req.get('authorization')?.replace('Bearer ', '');
    if (token) {
      const isBlacklisted = await this.redis.get(
        `${APP_CONSTANTS.TOKEN_BLACKLIST_PREFIX}${token}`,
      );
      if (isBlacklisted) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    return {
      userId: payload.sub,
      uuid: payload.uuid,
      email: payload.email,
      role: payload.role,
    };
  }
}
