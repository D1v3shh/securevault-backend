import { AppLoggerService } from '../logger.service';

/**
 * These tests assert the Nest LoggerService contract rather than winston's
 * output: the previous implementation used a fixed (message, trace, context)
 * signature, so a plain `logger.error('msg', 'Context')` filed the context as a
 * stack trace.
 */
describe('AppLoggerService', () => {
  let service: AppLoggerService;
  let written: Array<{ level: string; message: string; meta: any }>;

  beforeEach(() => {
    service = new AppLoggerService();

    written = [];
    // Capture what reaches winston without asserting on its formatting.
    const winstonLogger = (service as any).logger as {
      info: (m: string, meta: any) => void;
    };
    for (const level of ['info', 'error', 'warn', 'debug', 'verbose']) {
      (winstonLogger as any)[level] = (message: string, meta: any) => {
        written.push({ level, message, meta });
      };
    }
  });

  it('should implement every method Nest may call', () => {
    for (const method of [
      'log',
      'error',
      'warn',
      'debug',
      'verbose',
      'fatal',
    ] as const) {
      expect(typeof service[method]).toBe('function');
    }
  });

  it('should treat a single trailing string as the context, not a stack trace', () => {
    service.error('something failed', 'FilesService');

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      level: 'error',
      message: 'something failed',
      meta: { context: 'FilesService', trace: undefined },
    });
  });

  it('should treat a multi-line single param as a stack trace', () => {
    const stack = 'Error: boom\n    at somewhere (file.ts:1:1)';

    service.error('boom', stack);

    expect(written[0].meta.trace).toBe(stack);
    expect(written[0].meta.context).toBeUndefined();
  });

  it('should split (stack, context) when Nest passes both', () => {
    const stack = 'Error: boom\n    at somewhere (file.ts:1:1)';

    service.error('boom', stack, 'FilesService');

    expect(written[0].meta).toMatchObject({
      context: 'FilesService',
      trace: stack,
    });
  });

  it('should record fatal at error level with a flag', () => {
    service.fatal('unrecoverable', 'Bootstrap');

    expect(written[0].level).toBe('error');
    expect(written[0].meta).toMatchObject({
      context: 'Bootstrap',
      fatal: true,
    });
  });

  it('should route log/warn/debug/verbose to the matching winston level', () => {
    service.log('a', 'Ctx');
    service.warn('b', 'Ctx');
    service.debug('c', 'Ctx');
    service.verbose('d', 'Ctx');

    expect(written.map((w) => w.level)).toEqual([
      'info',
      'warn',
      'debug',
      'verbose',
    ]);
    expect(written.every((w) => w.meta.context === 'Ctx')).toBe(true);
  });

  it('should stringify non-string messages instead of throwing', () => {
    service.log({ hello: 'world' });
    service.error(new Error('kaboom'));

    expect(written[0].message).toBe('{"hello":"world"}');
    expect(written[1].message).toContain('kaboom');
  });

  it('should not throw when called with no context at all', () => {
    expect(() => service.log('bare')).not.toThrow();
    expect(written[0].meta).toEqual({ context: undefined });
  });
});
