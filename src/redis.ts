import { RedisClient } from "bun";

export async function openRedis(url: string): Promise<RedisClient> {
  const client = new RedisClient(url);
  await client.connect();
  return client;
}

