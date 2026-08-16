import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import * as express from 'express';
import { ShareService } from './services/share.service';
import { ShareFileRequest } from './dto/share-file-request.dto';
import { ShareFileResponse } from './dto/share-file-response.dto';
import { SharedFileResponse } from './dto/shared-file-response.dto';
import { QuerySharesDto } from './dto/query-shares.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as JwtPayloadNs from '../auth/interfaces/jwt-payload.interface';

@ApiTags('File Sharing')
@ApiBearerAuth('access-token')
@Controller('shares')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  // ─── Share a File ──────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Share a file with another user',
    description:
      'Grant another user access to a file with configurable permission level and expiration. ' +
      'Only the file owner can create shares. Duplicate active shares are prevented.',
  })
  @ApiResponse({
    status: 201,
    description: 'Share created successfully',
    type: ShareFileResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid share request — validation failure',
    schema: {
      example: {
        statusCode: 400,
        error: 'INVALID_SHARE_REQUEST',
        message: 'Expiration date must be in the future',
        timestamp: '2026-05-31T12:00:00.000Z',
        path: '/api/v1/shares',
        method: 'POST',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Access denied — not the file owner',
    schema: {
      example: {
        statusCode: 403,
        error: 'ACCESS_DENIED',
        message: 'Only the file owner can share this file',
        timestamp: '2026-05-31T12:00:00.000Z',
        path: '/api/v1/shares',
        method: 'POST',
      },
    },
  })
  async shareFile(
    @Body() dto: ShareFileRequest,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
  ): Promise<ShareFileResponse> {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return this.shareService.shareFile(dto, user, ip);
  }

  // ─── Revoke a Share ────────────────────────────────────

  @Delete(':shareId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke a file share',
    description:
      'Revoke access to a shared file. Only the file owner can revoke. ' +
      'Status changes to REVOKED and access becomes immediately invalid.',
  })
  @ApiParam({
    name: 'shareId',
    description: 'MongoDB ObjectId of the share record',
    example: '665b9876abcd5678ef901234',
  })
  @ApiResponse({
    status: 200,
    description: 'Share revoked successfully',
    schema: {
      example: { message: 'Share revoked successfully' },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Share not found',
    schema: {
      example: {
        statusCode: 404,
        error: 'SHARE_NOT_FOUND',
        message: 'Share not found',
      },
    },
  })
  async revokeShare(
    @Param('shareId') shareId: string,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
  ): Promise<{ message: string }> {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    await this.shareService.revokeShare(shareId, user, ip);
    return { message: 'Share revoked successfully' };
  }

  // ─── List Shares: Shared With Me ───────────────────────

  @Get('shared-with-me')
  @ApiOperation({
    summary: 'List files shared with the current user',
    description:
      'Returns paginated list of active file shares where the current user is the recipient. ' +
      'Supports filtering by status, sorting by created date / expiration / file name, and search.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of shares',
  })
  async getSharedWithMe(
    @Query() query: QuerySharesDto,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
  ) {
    return this.shareService.getSharedWithMe(query, user);
  }

  // ─── List Shares: Shared By Me ─────────────────────────

  @Get('shared-by-me')
  @ApiOperation({
    summary: 'List files shared by the current user',
    description:
      'Returns paginated list of active file shares created by the current user. ' +
      'Supports filtering by status, sorting, and search.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of shares',
  })
  async getSharedByMe(
    @Query() query: QuerySharesDto,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
  ) {
    return this.shareService.getSharedByMe(query, user);
  }

  // ─── Get Share Details ─────────────────────────────────

  @Get(':shareId')
  @ApiOperation({
    summary: 'Get details of a specific share',
    description:
      'Retrieve full details of a share record. Only accessible by the file owner or the shared-with user.',
  })
  @ApiParam({
    name: 'shareId',
    description: 'MongoDB ObjectId of the share record',
    example: '665b9876abcd5678ef901234',
  })
  @ApiResponse({
    status: 200,
    description: 'Share details',
    type: SharedFileResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'Share not found',
  })
  async getShareById(
    @Param('shareId') shareId: string,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
  ): Promise<SharedFileResponse> {
    return this.shareService.getShareById(shareId, user);
  }
}
