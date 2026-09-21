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
        // Never bypass an existing second factor during the migration.
        if (user.twofa_enabled) return json({ authenticated: false, twofa_required: true, email: user.email }, 428);

        return json({ authenticated: true, user: publicUser(user as Record<string, any>) });
      }

      if (url.pathname === "/internal/auth/otp/issue" && request.method === "POST") {
        let body: any;
        try { body = await request.json(); } catch { return json({ detail: "Invalid JSON" }, 400); }
        const email = String(body?.email || "").trim().toLowerCase();
        const kind = String(body?.kind || "");
        const codeHash = String(body?.code_hash || "");
        const expiresAt = String(body?.expires_at || "");
        if (!email || !["2fa", "reset", "email"].includes(kind) || !codeHash || !expiresAt) {
          return json({ detail: "Invalid OTP request" }, 400);
        }
        const user = await db.collection("users").findOne({ email }, { projection: { _id: 0, id: 1, email: 1, twofa_enabled: 1, age_blocked: 1 } });
        if (!user) return json({ found: false }, 404);
        if (kind === "2fa" && !user.twofa_enabled) return json({ detail: "2FA is not enabled" }, 409);
        if (user.age_blocked) return json({ detail: "Account blocked" }, 403);
        await db.collection("verification_codes").updateOne(
          { user_id: user.id, kind },
          { $set: { code_hash: codeHash, expires_at: expiresAt, attempts: 0 } },
          { upsert: true },
        );
        return json({ issued: true, user_id: user.id, email: user.email });
      }

      if (url.pathname === "/internal/auth/otp/verify" && request.method === "POST") {
        let body: any;
        try { body = await request.json(); } catch { return json({ detail: "Invalid JSON" }, 400); }
        const email = String(body?.email || "").trim().toLowerCase();
        const kind = String(body?.kind || "");
        const codeHash = String(body?.code_hash || "");
        if (!email || !["2fa", "reset", "email"].includes(kind) || !codeHash) return json({ detail: "Invalid OTP request" }, 400);
        const user = await db.collection("users").findOne({ email });
        if (!user) return json({ valid: false }, 400);
        const rec = await db.collection("verification_codes").findOne({ user_id: user.id, kind });
        const now = new Date().toISOString();
        if (!rec || String(rec.expires_at || "") < now || Number(rec.attempts || 0) >= 5) return json({ valid: false }, 400);
        if (String(rec.code_hash || "") !== codeHash) {
          await db.collection("verification_codes").updateOne({ user_id: user.id, kind }, { $inc: { attempts: 1 } });
          return json({ valid: false }, 400);
        }
        await db.collection("verification_codes").deleteOne({ user_id: user.id, kind });
        return json({ valid: true, user: publicUser(user as Record<string, any>) });
      }

      if (url.pathname === "/internal/feed/foryou" && request.method === "POST") {
        let body: any;
        try { body = await request.json(); } catch { return json({ detail: "Invalid JSON" }, 400); }
        const userId = String(body?.user_id || "").trim();
        const skip = Math.max(0, Number(body?.skip || 0));
        const limit = Math.max(1, Math.min(30, Number(body?.limit || 10)));
        if (!userId) return json({ detail: "User id is required" }, 400);
        const viewer = await db.collection("users").findOne({ id: userId });
        if (!viewer) return json({ detail: "User not found" }, 404);
        const query: any = {};
        if (viewer.hide_political === true) query.is_political = { $ne: true };
        const posts = await db.collection("posts").find(query, { projection: { _id: 0 } })
          .sort({ created_at: -1 }).skip(skip).limit(limit).toArray();
        const ids = posts.map((p: any) => p.id).filter(Boolean);
        const liked = ids.length ? await db.collection("likes").find({ user_id: userId, post_id: { $in: ids } }, { projection: { _id: 0, post_id: 1 } }).toArray() : [];
        const saved = ids.length ? await db.collection("saved_posts").find({ user_id: userId, post_id: { $in: ids } }, { projection: { _id: 0, post_id: 1 } }).toArray() : [];
        const likedSet = new Set(liked.map((x: any) => x.post_id));
        const savedSet = new Set(saved.map((x: any) => x.post_id));
        return json(posts.map((p: any) => ({ ...p, is_liked: likedSet.has(p.id), is_saved: savedSet.has(p.id) })));
      }

      if (url.pathname === "/internal/feed/following" && request.method === "POST") {
        let body: any;
        try { body = await request.json(); } catch { return json({ detail: "Invalid JSON" }, 400); }
        const userId = String(body?.user_id || "").trim();
        const skip = Math.max(0, Number(body?.skip || 0));
        const limit = Math.max(1, Math.min(30, Number(body?.limit || 10)));
        if (!userId) return json({ detail: "User id is required" }, 400);
        const follows = await db.collection("follows").find({ follower_id: userId, status: "following" }, { projection: { _id: 0, followed_id: 1, following_id: 1 } }).toArray();
        const authorIds = follows.map((x: any) => x.followed_id || x.following_id).filter(Boolean);
        authorIds.push(userId);
        const posts = await db.collection("posts").find({ author_id: { $in: authorIds } }, { projection: { _id: 0 } })
          .sort({ created_at: -1 }).skip(skip).limit(limit).toArray();
        const ids = posts.map((p: any) => p.id).filter(Boolean);
        const liked = ids.length ? await db.collection("likes").find({ user_id: userId, post_id: { $in: ids } }, { projection: { _id: 0, post_id: 1 } }).toArray() : [];
        const saved = ids.length ? await db.collection("saved_posts").find({ user_id: userId, post_id: { $in: ids } }, { projection: { _id: 0, post_id: 1 } }).toArray() : [];
        const likedSet = new Set(liked.map((x: any) => x.post_id));
        const savedSet = new Set(saved.map((x: any) => x.post_id));
        return json(posts.map((p: any) => ({ ...p, is_liked: likedSet.has(p.id), is_saved: savedSet.has(p.id) })));
      }

      if (url.pathname === "/internal/stories/feed" && request.method === "POST") {
        let body: any;
        try { body = await request.json(); } catch { return json({ detail: "Invalid JSON" }, 400); }
        const userId = String(body?.user_id || "").trim();
        if (!userId) return json({ detail: "User id is required" }, 400);
        const follows = await db.collection("follows").find({ follower_id: userId }, { projection: { _id: 0, followed_id: 1, following_id: 1 } }).toArray();
        const authorIds = follows.map((x: any) => x.followed_id || x.following_id).filter(Boolean);
        authorIds.push(userId);
        const now = new Date().toISOString();
        const stories = await db.collection("stories").find({ author_id: { $in: authorIds }, expires_at: { $gt: now } }, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(1000).toArray();
        const ids = stories.map((s: any) => s.id).filter(Boolean);
        const views = ids.length ? await db.collection("story_views").find({ user_id: userId, story_id: { $in: ids } }, { projection: { _id: 0, story_id: 1 } }).toArray() : [];
        const viewed = new Set(views.map((v: any) => v.story_id));
        const groups = new Map<string, any>();
        for (const s of stories) {
          const aud = s.audience || "everyone";
          if (s.author_id !== userId && aud === "custom" && !(s.recipient_ids || []).includes(userId)) continue;
          if (s.author_id !== userId && aud === "close_friends") {
            const author = await db.collection("users").findOne({ id: s.author_id }, { projection: { close_friends: 1 } });
            if (!(author?.close_friends || []).includes(userId)) continue;
          }
          const item = { ...s, has_viewed: viewed.has(s.id), is_mine: s.author_id === userId };
          if (!groups.has(s.author_id)) groups.set(s.author_id, { user_id: s.author_id, username: s.author_username, profile_pic: s.author_profile_pic ?? null, stories: [], last_story_time: s.created_at });
          groups.get(s.author_id).stories.push(item);
        }
        const out = Array.from(groups.values());
        for (const g of out) g.stories.sort((a: any,b: any) => String(a.created_at).localeCompare(String(b.created_at)));
        out.sort((a: any,b: any) => (a.user_id === userId ? -1 : b.user_id === userId ? 1 : String(b.last_story_time).localeCompare(String(a.last_story_time))));
        return json(out);
      }

      if (url.pathname === "/internal/badges" && request.method === "POST") {
        let body: any;
        try { body = await request.json(); } catch { return json({ detail: "Invalid JSON" }, 400); }
        const userId = String(body?.user_id || "").trim();
        if (!userId) return json({ detail: "User id is required" }, 400);
        const [messages, notifications] = await Promise.all([
          db.collection("messages").countDocuments({ recipient_id: userId, read: false }),
          db.collection("notifications").countDocuments({ user_id: userId, read: false }),
        ]);
        return json({ messages, notifications });
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
