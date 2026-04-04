import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { WorkerConfig } from "./config";
import type { ArtifactFile } from "./build";

export type UploadArtifactResult = {
  key: string;
  bytes: number;
  contentType: string;
  action: "uploaded" | "skipped";
};

export type UploadArtifactsSummary = {
  uploaded: UploadArtifactResult[];
  skipped: UploadArtifactResult[];
};

export type DeleteArtifactsSummary = {
  deleted: number;
};

export class R2Uploader {
  private readonly client: S3Client;
  private readonly existingKeys = new Set<string>();

  constructor(private readonly config: WorkerConfig) {
    this.client = new S3Client({
      region: "auto",
      endpoint: config.r2Endpoint,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    });
  }

  private async objectExists(key: string): Promise<boolean> {
    if (this.existingKeys.has(key)) {
      return true;
    }

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.r2Bucket,
          Key: key,
        }),
      );
      this.existingKeys.add(key);
      return true;
    } catch (error) {
      if (
        error instanceof NoSuchKey ||
        (typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "NotFound")
      ) {
        return false;
      }
      throw error;
    }
  }

  async uploadArtifacts(artifacts: ArtifactFile[]): Promise<UploadArtifactsSummary> {
    const concurrency = Math.max(1, this.config.r2UploadConcurrency);
    const queue = [...artifacts];
    const uploaded: UploadArtifactResult[] = [];
    const skipped: UploadArtifactResult[] = [];
    const workers = Array.from(
      { length: Math.min(concurrency, Math.max(1, queue.length)) },
      async () => {
        while (queue.length > 0) {
          const artifact = queue.shift();
          if (!artifact) {
            return;
          }
          if (await this.objectExists(artifact.key)) {
            skipped.push({
              key: artifact.key,
              bytes: artifact.body.byteLength,
              contentType: artifact.contentType,
              action: "skipped",
            });
            continue;
          }
          await this.client.send(
            new PutObjectCommand({
              Bucket: this.config.r2Bucket,
              Key: artifact.key,
              Body: artifact.body,
              ContentType: artifact.contentType,
            }),
          );
          this.existingKeys.add(artifact.key);
          uploaded.push({
            key: artifact.key,
            bytes: artifact.body.byteLength,
            contentType: artifact.contentType,
            action: "uploaded",
          });
        }
      },
    );

    await Promise.all(workers);

    return { uploaded, skipped };
  }

  async deleteAppArtifacts(appId: string): Promise<DeleteArtifactsSummary> {
    const prefix = `apps/${appId}/`;
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.r2Bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const entry of page.Contents ?? []) {
        if (entry.Key) {
          keys.push(entry.Key);
        }
      }

      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    for (let index = 0; index < keys.length; index += 1000) {
      const batch = keys.slice(index, index + 1000);
      if (batch.length === 0) {
        continue;
      }
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.config.r2Bucket,
          Delete: {
            Objects: batch.map((key) => ({ Key: key })),
            Quiet: true,
          },
        }),
      );
    }

    for (const key of keys) {
      this.existingKeys.delete(key);
    }

    return { deleted: keys.length };
  }
}
