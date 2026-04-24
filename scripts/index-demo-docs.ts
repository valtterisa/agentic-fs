import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { createQdrant, ensureCollection } from "../src/qdrant";

const env = z
  .object({
    QDRANT_URL: z.string().default("http://localhost:6333"),
    QDRANT_COLLECTION: z.string().default("vfs_demo_docs")
  })
  .parse(process.env);

const schema = z.array(
  z.object({
    id: z.string(),
    vector: z.array(z.number()),
    payload: z.record(z.any())
  })
);

async function run(): Promise<void> {
  const qdrant = createQdrant(env.QDRANT_URL);
  const pointsPath = resolve(process.cwd(), "data/sources/demo/preembedded/points.json");
  const points = schema.parse(JSON.parse(readFileSync(pointsPath, "utf8")));
  const vectorSize = points[0]?.vector.length ?? 4;
  const normalizedPoints = points.map((point, index) => ({
    id: index + 1,
    vector: point.vector,
    payload: { ...point.payload, sourceId: point.id }
  }));
  await ensureCollection(qdrant, env.QDRANT_COLLECTION, vectorSize);
  await qdrant.upsert(env.QDRANT_COLLECTION, { wait: true, points: normalizedPoints });
  console.log(`indexed ${normalizedPoints.length} points into ${env.QDRANT_COLLECTION}`);
}

await run();

