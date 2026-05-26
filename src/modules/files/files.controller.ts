import {
  Controller, Get, Post, Delete, Param, Query, Req, Res,
  UploadedFile, UseInterceptors, HttpCode, HttpStatus, Body,
  ParseFilePipe, MaxFileSizeValidator, StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody,
} from '@nestjs/swagger';
import * as express from 'express';
import { FilesService } from './files.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { QueryFilesDto } from './dto/query-files.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as JwtPayloadNs from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Files')
@ApiBearerAuth('access-token')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload an encrypted file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        description: { type: 'string' },
        accessLevel: { type: 'string', enum: ['private', 'internal', 'department', 'public'] },
        department: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 }), // 100MB
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: UploadFileDto,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const result = await this.filesService.uploadFile(file, dto, user, ip);

    return {
      uuid: result.uuid,
      originalName: result.originalName,
      mimeType: result.mimeType,
      size: result.size,
      accessLevel: result.accessLevel,
      description: result.description,
      createdAt: (result as any).createdAt,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List files accessible to current user' })
  async list(
    @Query() query: QueryFilesDto,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
  ) {
    return this.filesService.listFiles(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get file metadata' })
  async getMetadata(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
  ) {
    const file = await this.filesService.getFileMetadata(id, user);
    return {
      uuid: file.uuid,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      checksum: file.checksum,
      accessLevel: file.accessLevel,
      department: file.department,
      description: file.description,
      uploadedBy: file.uploadedBy,
      createdAt: (file as any).createdAt,
      updatedAt: (file as any).updatedAt,
    };
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download a decrypted file' })
  async download(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
    @Res() res: express.Response,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const { buffer, file } = await this.filesService.downloadFile(id, user, ip);

    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.originalName)}"`,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });

    res.send(buffer);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a file' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    await this.filesService.deleteFile(id, user, ip);
    return { message: 'File deleted successfully' };
  }
}
