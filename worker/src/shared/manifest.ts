import { z } from "zod";

export const liveManifestSchema = z.object({
  version: z.number().int().positive(),
  entryUrl: z.string().url(),
  cssUrls: z.array(z.string().url()).optional().default([]),
  chunkBaseUrl: z.string().url(),
  createdAt: z.number().int().positive(),
  appId: z.string(),
  stateSchemaVersion: z.number().int().positive(),
  stateJson: z.string(),
});

export type LiveManifest = z.infer<typeof liveManifestSchema>;
