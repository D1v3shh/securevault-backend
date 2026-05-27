import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SessionEntity, SessionSchema } from './schemas/session.schema';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SessionEntity.name, schema: SessionSchema },
    ]),
  ],
  providers: [SessionsService],
  exports: [SessionsService, MongooseModule],
})
export class SessionsModule {}
