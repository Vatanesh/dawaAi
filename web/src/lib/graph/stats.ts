import { getRepository, type GraphStats } from "./repository";

export type { GraphStats };

/** Live counts from the knowledge graph. Every number is a database count, never an estimate. */
export async function getStats(): Promise<GraphStats> {
  return (await getRepository()).stats();
}
