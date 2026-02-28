import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { RedisService } from '../redis/redis.service';

/**
 * StorageService — uploads voucher images to Cloudflare R2.
 *
 * Cloudflare R2 is S3-compatible, so we use the standard AWS SDK.
 * Objects are stored with a key pattern:
 *   vouchers/{year}/{month}/{partnerId}_{timestamp}.{ext}
 *
 * A lifecycle rule on the R2 bucket auto-deletes objects after 60 days.
 *
 * Required env vars:
 *   R2_ACCOUNT_ID        – Cloudflare account ID
 *   R2_ACCESS_KEY_ID     – R2 API token access key
 *   R2_SECRET_ACCESS_KEY – R2 API token secret key
 *   R2_BUCKET_NAME       – R2 bucket name (e.g. "natillera-vouchers")
 *   R2_PUBLIC_URL        – (optional) custom domain or R2.dev public URL
 */
/** Redis key prefix for cached presigned URLs */
const KEY_VOUCHER_URL = 'voucher:url:';
/** Cache TTL: 55 minutes (presigned URLs expire in 60 min) */
const PRESIGNED_CACHE_TTL = 55 * 60;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3: S3Client;
  private bucketName: string;
  private publicUrl: string | null;
  private enabled = false;

  constructor(private readonly redisService: RedisService) {}

  onModuleInit() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    this.bucketName = process.env.R2_BUCKET_NAME || 'natillera-vouchers';
    this.publicUrl = process.env.R2_PUBLIC_URL || null;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'R2 storage not configured (missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY). ' +
        'Voucher images will NOT be persisted to cloud storage.',
      );
      this.enabled = false;
      return;
    }

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    this.enabled = true;
    this.logger.log(`R2 storage configured — bucket: ${this.bucketName}`);
  }

  /**
   * Whether cloud storage is properly configured and available.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Upload a voucher image buffer to R2.
   *
   * @param buffer    – image binary data
   * @param key       – object key (path inside the bucket)
   * @param mimeType  – e.g. "image/jpeg"
   * @returns the public/presigned URL, or null on failure
   */
  async uploadVoucher(
    buffer: Buffer,
    key: string,
    mimeType: string = 'image/jpeg',
  ): Promise<string | null> {
    if (!this.enabled) {
      this.logger.warn('R2 storage not enabled — skipping upload');
      return null;
    }

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );

      const url = this.getUrl(key);
      this.logger.log(`Voucher uploaded to R2: ${key} (${buffer.length} bytes)`);
      return url;
    } catch (error) {
      this.logger.error(`Failed to upload voucher to R2 (${key}):`, error);
      return null;
    }
  }

  /**
   * Generate a presigned URL for temporary access (valid for 1 hour).
   * Useful when the bucket is not publicly accessible.
   */
  async getPresignedUrl(key: string, expiresInSeconds: number = 3600): Promise<string | null> {
    if (!this.enabled) return null;

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      return await getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
    } catch (error) {
      this.logger.error(`Failed to generate presigned URL for ${key}:`, error);
      return null;
    }
  }

  /**
   * Get a presigned URL with Redis caching.
   * Checks Redis first (key = voucher:url:{paymentId}); on miss, generates
   * a fresh presigned URL (1 h), caches it for 55 min, and returns it.
   *
   * @param paymentId   – payment ID used as Redis cache key
   * @param storageKey  – R2 object key
   * @param fallbackUrl – optional raw URL to return when R2 is disabled
   */
  async getCachedPresignedUrl(
    paymentId: string,
    storageKey?: string,
    fallbackUrl?: string,
  ): Promise<string | null> {
    if (!storageKey && !fallbackUrl) return null;

    const cacheKey = KEY_VOUCHER_URL + paymentId;

    // 1. Check Redis cache
    try {
      const cached = await this.redisService.get<string>(cacheKey);
      if (cached) return cached;
    } catch (err) {
      this.logger.warn(`Redis read failed for ${cacheKey}:`, err);
    }

    // 2. Generate presigned URL from R2
    if (storageKey && this.enabled) {
      const presigned = await this.getPresignedUrl(storageKey, 3600);
      if (presigned) {
        // 3. Cache in Redis
        try {
          await this.redisService.set(cacheKey, presigned, PRESIGNED_CACHE_TTL);
        } catch (err) {
          this.logger.warn(`Redis write failed for ${cacheKey}:`, err);
        }
        return presigned;
      }
    }

    // 4. Fallback to stored URL
    return fallbackUrl || null;
  }

  /**
   * Delete a voucher from R2 (manual cleanup if needed).
   */
  async deleteVoucher(key: string): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
      this.logger.log(`Voucher deleted from R2: ${key}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete voucher from R2 (${key}):`, error);
      return false;
    }
  }

  /**
   * Build the object key for a voucher image.
   * Pattern: vouchers/{year}/{month}/{partnerId}_{timestamp}.{ext}
   */
  buildVoucherKey(
    partnerId: string,
    voucherType: string,
    mimeType: string = 'image/jpeg',
  ): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = now.getTime();
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const safeType = voucherType.toLowerCase().replace(/[^a-z0-9]/g, '');

    return `vouchers/${year}/${month}/${partnerId}_${safeType}_${timestamp}.${ext}`;
  }

  /**
   * Get the URL for a stored object.
   * Uses public URL if configured, otherwise returns the S3-style URL.
   */
  private getUrl(key: string): string {
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/$/, '')}/${key}`;
    }
    // Fallback: construct R2 URL (requires public access enabled on bucket)
    const accountId = process.env.R2_ACCOUNT_ID;
    return `https://${this.bucketName}.${accountId}.r2.cloudflarestorage.com/${key}`;
  }
}
