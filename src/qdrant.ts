import { QdrantClient } from "@qdrant/js-client-rest";

export interface IndexedDocumentChunk {
  id: string;
  path: string;
  title: string;
  chunkIndex: number;
  content: string;
  source: string;
}

export function createQdrant(url: string): QdrantClient {
  return new QdrantClient({ url });
}

export async function ensureCollection(client: QdrantClient, collection: string, size = 4): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === collection);
  if (!exists) {
    await client.createCollection(collection, {
      vectors: { size, distance: "Cosine" }
    });
  }
}

export async function getPathTree(client: QdrantClient, collection: string): Promise<Record<string, string[]>> {
  const result = await client.scroll(collection, {
    limit: 1,
    with_payload: true,
    with_vector: false,
    filter: {
      must: [{ key: "recordType", match: { value: "path_tree" } }]
    }
  });
  const payload = result.points[0]?.payload as { tree?: Record<string, string[]> } | undefined;
  return payload?.tree ?? { "/": ["kb", "workspace", "memory", "scratch", "tools"] };
}

export async function getFileByPath(client: QdrantClient, collection: string, path: string): Promise<string | null> {
  const result = await client.scroll(collection, {
    limit: 200,
    with_payload: true,
    with_vector: false,
    filter: {
      must: [
        { key: "recordType", match: { value: "chunk" } },
        { key: "path", match: { value: path } }
      ]
    }
  });
  const chunks = result.points
    .map((p) => p.payload as Record<string, unknown>)
    .sort((a, b) => Number(a.chunkIndex ?? 0) - Number(b.chunkIndex ?? 0))
    .map((p) => String(p.content ?? ""));
  return chunks.length ? chunks.join("\n") : null;
}

export async function grepCandidates(
  client: QdrantClient,
  collection: string,
  pattern: string,
  limit = 128
): Promise<string[]> {
  const result = await client.scroll(collection, {
    limit,
    with_payload: true,
    with_vector: false,
    filter: {
      must: [{ key: "recordType", match: { value: "chunk" } }],
      should: [{ key: "content", match: { text: pattern } }]
    }
  });
  const paths = new Set<string>();
  for (const p of result.points) {
    const payload = p.payload as Record<string, unknown>;
    if (typeof payload.path === "string") {
      paths.add(payload.path);
    }
  }
  return [...paths];
}

