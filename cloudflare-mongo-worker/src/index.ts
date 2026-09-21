import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

interface Env {
  MONGO_URL: string;
  DB_NAME?: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function publicUser(user: Record<string, any>) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    bio: user.bio || "",
    profile_pic: user.profile_pic ?? null,
    followers_count: user.followers_count || 0,
    following_count: user.following_count || 0,
    is_private: Boolean(user.is_private),
    is_minor: Boolean(user.is_minor),
    daily_time_limit: user.daily_time_limit ?? null,
    time_limit_enabled: user.time_limit_enabled !== false,
    privacy_strict: Boolean(user.privacy_strict),
    show_active_status: user.show_active_status !== false,
    read_receipts: user.read_receipts !== false,
    hide_political: Boolean(user.hide_political),
    muted_words: user.muted_words || [],
    created_at: user.created_at ?? null,
    email_verified: user.email_verified,
    twofa_enabled: Boolean(user.twofa_enabled),
    age_blocked: Boolean(user.age_blocked),
  };
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

    if (!env.MONGO_URL) {
      return json({ status: "error", detail: "Database is not configured" }, 503);
    }

    const dbName = env.DB_NAME || "nexus_db";
    const client = new MongoClient(env.MONGO_URL, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    try {
      await client.connect();
      const db = client.db(dbName);

      if (url.pathname === "/health/mongodb") {
        await client.db("admin").command({ ping: 1 });
        const collections = await db.listCollections({}, { nameOnly: true }).toArray();
        return json({ status: "ok", connected: true, database: dbName, collection_count: collections.length });
      }

      if (url.pathname === "/internal/auth/verify" && request.method === "POST") {
        let body: any;
        try { body = await request.json(); } catch { return json({ detail: "Invalid JSON" }, 400); }

        const email = String(body?.email || "").trim().toLowerCase();
        const password = String(body?.password || "");
        if (!email || !password) return json({ detail: "Email and password are required" }, 400);

        const user = await db.collection("users").findOne({ email });
        const hash = typeof user?.password === "string" ? user.password : "";
        const valid = hash ? await bcrypt.compare(password, hash) : false;

        if (!user || !valid) return json({ authenticated: false }, 401);
        if (user.age_blocked) return json({ authenticated: false, age_blocked: true }, 403);

        return json({ authenticated: true, user: publicUser(user as Record<string, any>) });
      }

      if (url.pathname === "/internal/auth/user-by-id" && request.method === "POST") {
        let body: any;
        try { body = await request.json(); } catch { return json({ detail: "Invalid JSON" }, 400); }

        const id = String(body?.id || "").trim();
        if (!id) return json({ detail: "User id is required" }, 400);

        const user = await db.collection("users").findOne(
          { id },
          { projection: { _id: 0, password: 0 } },
        );
        if (!user) return json({ found: false }, 404);
        return json({ found: true, user: publicUser(user as Record<string, any>) });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({
        status: "error",
        connected: false,
        database: dbName,
        error_type: error instanceof Error ? error.name : "UnknownError",
        detail: error instanceof Error ? error.message.slice(0, 500) : "Unexpected database error",
      }, 503);
    } finally {
      await client.close().catch(() => undefined);
    }
  },
};
