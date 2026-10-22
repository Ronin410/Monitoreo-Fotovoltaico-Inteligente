import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { assertSafeKey, type StorageProvider, type StoredObject } from './types.js';

export type S3Config = { endpoint: string; bucket: string; accessKey: string; secretKey: string };

/** S3 compatible (Cloudflare R2 o S3) para producción. */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      // R2 usa "auto"; para S3 la región va implícita en el endpoint.
      region: 'auto',
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      if (!res.Body) return null;
      return {
        body: Buffer.from(await res.Body.transformToByteArray()),
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
