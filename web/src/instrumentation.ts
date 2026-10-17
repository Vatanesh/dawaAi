// Warm the Neo4j connection pool and catalogue caches when the server starts, so the first person
// to open the app doesn't pay for TLS + routing setup (slow on some networks). Not awaited, so it
// never delays server start.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  void import("./lib/graph/repository")
    .then(({ getRepository }) => getRepository())
    .then((repo) => repo.warm?.())
    .catch((err) => console.warn("[warm-up] Neo4j warm-up failed:", err instanceof Error ? err.message : err));
}
