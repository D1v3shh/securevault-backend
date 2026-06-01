import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SessionsService } from '../sessions.service';
import { SessionEntity } from '../schemas/session.schema';

describe('SessionsService', () => {
  let service: SessionsService;
  let sessionModel: any;

  beforeEach(async () => {
    sessionModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn(),
      updateMany: jest.fn(),
      countDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: getModelToken(SessionEntity.name), useValue: sessionModel },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Create Session ──────────────────────────────────

  describe('createSession', () => {
    it('should end existing active sessions for the device before creating new one', async () => {
      const mockSession = { sessionId: 'new-session-id' };
      sessionModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
      sessionModel.create.mockResolvedValue(mockSession);

      const result = await service.createSession({
        userId: '507f1f77bcf86cd799439011',
        deviceId: 'device-1',
        certificateSerial: 'SN-123',
        ipAddress: '10.0.0.1',
        userAgent: 'App/1.0',
        authMethod: 'certificate',
      });

      expect(sessionModel.updateMany).toHaveBeenCalledWith(
        {
          userId: expect.any(Types.ObjectId),
          deviceId: 'device-1',
          isActive: true,
        },
        { isActive: false, endedAt: expect.any(Date) },
      );

      expect(sessionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'device-1',
          certificateSerial: 'SN-123',
          authMethod: 'certificate',
          isActive: true,
        }),
      );
      expect(result).toEqual(mockSession);
    });

    it('should default authMethod to certificate', async () => {
      sessionModel.updateMany.mockResolvedValue({});
      sessionModel.create.mockResolvedValue({ sessionId: 'session-2' });

      await service.createSession({
        userId: '507f1f77bcf86cd799439011',
        deviceId: 'device-1',
      });

      expect(sessionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ authMethod: 'certificate' }),
      );
    });

    it('should handle null optional fields', async () => {
      sessionModel.updateMany.mockResolvedValue({});
      sessionModel.create.mockResolvedValue({ sessionId: 'session-3' });

      await service.createSession({
        userId: '507f1f77bcf86cd799439011',
        deviceId: 'device-1',
      });

      expect(sessionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          certificateSerial: null,
          ipAddress: null,
          userAgent: null,
        }),
      );
    });
  });

  // ─── End Session ────────────────────────────────────

  describe('endSession', () => {
    it('should mark session as inactive', async () => {
      sessionModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.endSession('session-id-1');

      expect(sessionModel.updateOne).toHaveBeenCalledWith(
        { sessionId: 'session-id-1' },
        { isActive: false, endedAt: expect.any(Date) },
      );
    });
  });

  // ─── End All User Sessions ──────────────────────────

  describe('endAllUserSessions', () => {
    it('should end all active sessions for a user', async () => {
      sessionModel.updateMany.mockResolvedValue({ modifiedCount: 3 });

      await service.endAllUserSessions('507f1f77bcf86cd799439011');

      expect(sessionModel.updateMany).toHaveBeenCalledWith(
        {
          userId: expect.any(Types.ObjectId),
          isActive: true,
        },
        { isActive: false, endedAt: expect.any(Date) },
      );
    });
  });

  // ─── End Device Sessions ────────────────────────────

  describe('endDeviceSessions', () => {
    it('should end all active sessions for a device', async () => {
      sessionModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

      await service.endDeviceSessions('device-1');

      expect(sessionModel.updateMany).toHaveBeenCalledWith(
        { deviceId: 'device-1', isActive: true },
        { isActive: false, endedAt: expect.any(Date) },
      );
    });
  });

  // ─── Update Activity ────────────────────────────────

  describe('updateActivity', () => {
    it('should update last activity timestamp', async () => {
      sessionModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.updateActivity('session-1');

      expect(sessionModel.updateOne).toHaveBeenCalledWith(
        { sessionId: 'session-1' },
        { lastActivityAt: expect.any(Date) },
      );
    });
  });

  // ─── Get Active Sessions ─────────────────────────────

  describe('getActiveSessions', () => {
    it('should return active sessions sorted by last activity', async () => {
      const sessions = [{ sessionId: 's1' }, { sessionId: 's2' }];
      const execFn = jest.fn().mockResolvedValue(sessions);
      const sortFn = jest.fn().mockReturnValue({ exec: execFn });
      sessionModel.find.mockReturnValue({ sort: sortFn });

      const result = await service.getActiveSessions('507f1f77bcf86cd799439011');

      expect(sessionModel.find).toHaveBeenCalledWith({
        userId: expect.any(Types.ObjectId),
        isActive: true,
      });
      expect(sortFn).toHaveBeenCalledWith({ lastActivityAt: -1 });
      expect(result).toEqual(sessions);
    });
  });

  // ─── Find By Session ID ──────────────────────────────

  describe('findBySessionId', () => {
    it('should find session by sessionId', async () => {
      const session = { sessionId: 'target-session' };
      sessionModel.findOne.mockResolvedValue(session);

      const result = await service.findBySessionId('target-session');

      expect(result).toEqual(session);
    });

    it('should return null when session not found', async () => {
      sessionModel.findOne.mockResolvedValue(null);

      const result = await service.findBySessionId('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ─── Count Active Sessions ───────────────────────────

  describe('countActiveSessions', () => {
    it('should count active sessions for a user', async () => {
      sessionModel.countDocuments.mockResolvedValue(3);

      const result = await service.countActiveSessions('507f1f77bcf86cd799439011');

      expect(result).toBe(3);
    });
  });
});
