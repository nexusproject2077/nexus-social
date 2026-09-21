import { MongoClient } from "mongodb";

interface Env {
  MONGO_URL: string;
  DB_NAME?: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        status: "ok",
        service: "nexus-social-mongo",
        runtime: "cloudflare-workers-js",
        mongo_url_configured: Boolean(env.MONGO_URL),
      });
    }

    if (url.pathname !== "/health/mongodb") {
      return json({ error: "Not found" }, 404);
    }

    if (!env.MONGO_URL) {
      return json({
        status: "error",
        connected: false,
        detail: "MONGO_URL secret is not configured",
      }, 503);
    }

    const dbName = env.DB_NAME || "nexus_db";
    const client = new MongoClient(env.MONGO_URL, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    try {
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      const collections = await client.db(dbName).listCollections({}, { nameOnly: true }).toArray();

      return json({
        status: "ok",
        connected: true,
        database: dbName,
        collection_count: collections.length,
      });
    } catch (error) {
      return json({
        status: "error",
        connected: false,
        database: dbName,
        error_type: error instanceof Error ? error.name : "UnknownError",
        detail: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      }, 503);
    } finally {
      await client.close().catch(() => undefined);
    }
  },
};
