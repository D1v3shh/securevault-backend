import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DeviceEntity, DeviceSchema } from './schemas/device.schema';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeviceEntity.name, schema: DeviceSchema },
    ]),
    // Revoking or blocking a device ends its sessions.
    SessionsModule,
  ],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService, MongooseModule],
})
export class DevicesModule {}
