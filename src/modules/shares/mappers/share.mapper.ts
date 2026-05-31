import { FileAccessDocument } from '../schemas/file-access.schema';
import { ShareFileResponse } from '../dto/share-file-response.dto';
import { SharedFileResponse } from '../dto/shared-file-response.dto';

/**
 * Maps FileAccess documents to response DTOs.
 * NestJS uses plain object mapping instead of MapStruct — this provides
 * the same encapsulation and single-responsibility mapping layer.
 */
export class ShareMapper {
  /**
   * Map a newly created share document to a ShareFileResponse.
   */
  static toShareFileResponse(doc: FileAccessDocument): ShareFileResponse {
    return {
      shareId: doc._id.toString(),
      fileId: doc.fileId.toString(),
      ownerId: doc.ownerId.toString(),
      sharedWithUserId: doc.sharedWithUserId.toString(),
      permission: doc.permission,
      status: doc.status,
      sharedAt: doc.sharedAt.toISOString(),
      expiresAt: doc.expiresAt.toISOString(),
      maxDownloads: doc.maxDownloads,
      oneTimeAccess: doc.oneTimeAccess,
      watermarkEnabled: doc.watermarkEnabled,
      createdAt: (doc as any).createdAt?.toISOString() ?? doc.sharedAt.toISOString(),
    };
  }

  /**
   * Map a populated share document (with file and user refs) to SharedFileResponse.
   * Expects fileId, ownerId, and sharedWithUserId to be populated.
   */
  static toSharedFileResponse(doc: any): SharedFileResponse {
    const file = doc.fileId;
    const owner = doc.ownerId;
    const sharedWith = doc.sharedWithUserId;

    return {
      shareId: doc._id.toString(),
      file: {
        fileId: file?.uuid ?? file?._id?.toString() ?? '',
        originalName: file?.originalName ?? '',
        mimeType: file?.mimeType ?? '',
        size: file?.size ?? 0,
      },
      owner: {
        userId: owner?._id?.toString() ?? '',
        email: owner?.email ?? '',
        firstName: owner?.firstName ?? '',
        lastName: owner?.lastName ?? '',
      },
      sharedWith: {
        userId: sharedWith?._id?.toString() ?? '',
        email: sharedWith?.email ?? '',
        firstName: sharedWith?.firstName ?? '',
        lastName: sharedWith?.lastName ?? '',
      },
      permission: doc.permission,
      status: doc.status,
      sharedAt: doc.sharedAt?.toISOString() ?? '',
      expiresAt: doc.expiresAt?.toISOString() ?? '',
      maxDownloads: doc.maxDownloads,
      downloadCount: doc.downloadCount,
      oneTimeAccess: doc.oneTimeAccess,
      watermarkEnabled: doc.watermarkEnabled,
      createdAt: doc.createdAt?.toISOString() ?? '',
    };
  }

  /**
   * Map an array of populated share documents to SharedFileResponse[].
   */
  static toSharedFileResponseList(docs: any[]): SharedFileResponse[] {
    return docs.map((doc) => ShareMapper.toSharedFileResponse(doc));
  }
}
