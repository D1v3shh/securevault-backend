import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DeviceEntity, DeviceSchema } from './schemas/device.schema';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeviceEntity.name, schema: DeviceSchema },
    ]),
  ],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService, MongooseModule],
})
export class DevicesModule {}
