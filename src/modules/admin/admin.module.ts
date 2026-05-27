import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { SetupModule } from '../setup/setup.module';
import { DevicesModule } from '../devices/devices.module';

@Module({
  imports: [UsersModule, AuditModule, SetupModule, DevicesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
