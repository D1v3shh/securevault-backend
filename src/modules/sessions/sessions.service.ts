import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SessionEntity, SessionDocument } from './schemas/session.schema';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectModel(SessionEntity.name)
    private readonly sessionModel: Model<SessionDocument>,
  ) {}

  /**
   * Create a new session after successful authentication.
   */
  async createSession(params: {
    userId: string;
    deviceId: string;
    certificateSerial?: string;
    ipAddress?: string;
    userAgent?: string;
    authMethod?: 'certificate' | 'password';
  }): Promise<SessionDocument> {
    // End any existing active sessions for this device
    await this.sessionModel.updateMany(
      {
        userId: new Types.ObjectId(params.userId),
        deviceId: params.deviceId,
        isActive: true,
      },
      {
        isActive: false,
        endedAt: new Date(),
      },
    );

    const session = await this.sessionModel.create({
      userId: new Types.ObjectId(params.userId),
      deviceId: params.deviceId,
      certificateSerial: params.certificateSerial || null,
      ipAddress: params.ipAddress || null,
      userAgent: params.userAgent || null,
      authMethod: params.authMethod || 'certificate',
      isActive: true,
      startedAt: new Date(),
      lastActivityAt: new Date(),
    });

    this.logger.log(`Session created: ${session.sessionId} for user ${params.userId}`);
    return session;
  }

  /**
   * End a session (logout).
   */
  async endSession(sessionId: string): Promise<void> {
    await this.sessionModel.updateOne(
      { sessionId },
      { isActive: false, endedAt: new Date() },
    );
    this.logger.log(`Session ended: ${sessionId}`);
  }

  /**
   * End all sessions for a user.
   */
  async endAllUserSessions(userId: string): Promise<void> {
    await this.sessionModel.updateMany(
      { userId: new Types.ObjectId(userId), isActive: true },
      { isActive: false, endedAt: new Date() },
    );
  }

  /**
   * End all sessions for a device.
   */
  async endDeviceSessions(deviceId: string): Promise<void> {
    await this.sessionModel.updateMany(
      { deviceId, isActive: true },
      { isActive: false, endedAt: new Date() },
    );
  }

  /**
   * Update last activity timestamp.
   */
  async updateActivity(sessionId: string): Promise<void> {
    await this.sessionModel.updateOne(
      { sessionId },
      { lastActivityAt: new Date() },
    );
  }

  /**
   * Get active sessions for a user.
   */
  async getActiveSessions(userId: string): Promise<SessionDocument[]> {
    return this.sessionModel.find({
      userId: new Types.ObjectId(userId),
      isActive: true,
    }).sort({ lastActivityAt: -1 }).exec();
  }

  /**
   * Find session by ID.
   */
  async findBySessionId(sessionId: string): Promise<SessionDocument | null> {
    return this.sessionModel.findOne({ sessionId });
  }

  /**
   * Count active sessions for a user.
   */
  async countActiveSessions(userId: string): Promise<number> {
    return this.sessionModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isActive: true,
    });
  }
}
