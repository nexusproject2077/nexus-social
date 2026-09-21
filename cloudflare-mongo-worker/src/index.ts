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

      if (url.pathname === "/internal/users/search" && request.method === "POST") {
        let body: any; try { body = await request.json(); } catch { return json({ detail: "Invalid JSON" }, 400); }
        const userId = String(body?.user_id || "").trim(), q = String(body?.q || "").trim();
        if (!q) return json([]);
        const users = await db.collection("users").find({ $or: [{ username: { $regex: q, $options: "i" } }, { bio: { $regex: q, $options: "i" } }] }, { projection: { _id: 0, password: 0 } }).limit(20).toArray();
        const ids = users.map((u: any) => u.id).filter(Boolean);
        const follows = ids.length ? await db.collection("follows").find({ follower_id: userId, followed_id: { $in: ids } }, { projection: { _id: 0, followed_id: 1 } }).toArray() : [];
        const following = new Set(follows.map((x: any) => x.followed_id));
        return json(users.map((u: any) => ({ id:u.id, username:u.username, bio:u.bio||"", profile_pic:u.profile_pic||null, followers_count:u.followers_count||0, following_count:u.following_count||0, is_following:following.has(u.id), created_at:u.created_at, is_verified:Boolean(u.is_verified), is_premium:Boolean(u.is_premium) })));
      }

      if (url.pathname === "/internal/users/profile-views" && request.method === "POST") {
        let body: any; try { body = await request.json(); } catch { return json({ detail: "Invalid JSON" }, 400); }
        const userId = String(body?.user_id || "").trim();
        const user = await db.collection("users").findOne({ id: userId }, { projection: { _id:0, is_premium:1 } });
        if (!user) return json({ detail:"User not found" },404);
        const since = new Date(Date.now()-30*86400000).toISOString();
        const rows = await db.collection("profile_views").find({ profile_id:userId, ts:{ $gte:since } }, { projection:{ _id:0, viewer_id:1, ts:1 } }).sort({ts:-1}).limit(500).toArray();
        const ordered:string[]=[]; const seen=new Set<string>();
        for(const x of rows) if(x.viewer_id&&!seen.has(x.viewer_id)){seen.add(x.viewer_id);ordered.push(x.viewer_id);}
        let visitors:any[]=[]; const premium=Boolean(user.is_premium);
        if(premium&&ordered.length){const top=ordered.slice(0,12);const us=await db.collection("users").find({id:{$in:top}},{projection:{_id:0,id:1,username:1,profile_pic:1,is_verified:1,is_premium:1}}).toArray();const m=new Map(us.map((u:any)=>[u.id,u]));visitors=top.map(id=>m.get(id)).filter(Boolean);}
        return json({count:ordered.length,is_premium:premium,visitors});
      }

      if (url.pathname === "/internal/trending/hashtags" && request.method === "POST") {
        let body:any; try{body=await request.json();}catch{return json({detail:"Invalid JSON"},400);}
        const limit=Math.max(1,Math.min(50,Number(body?.limit||10))), since=new Date(Date.now()-86400000).toISOString();
        const posts=await db.collection("posts").find({created_at:{$gte:since},media_type:{$ne:"video"}},{projection:{_id:0,content:1,likes_count:1}}).sort({created_at:-1}).limit(3000).toArray();
        const stats=new Map<string,any>();
        for(const p of posts){const seen=new Set<string>();for(const m of String(p.content||"").matchAll(/#(\w+)/gu)){const display=m[1],key=display.toLowerCase();if(seen.has(key))continue;seen.add(key);const e=stats.get(key)||{display,count:0,likes:0};e.count++;e.likes+=Number(p.likes_count||0);stats.set(key,e);}}
        const trending=Array.from(stats.entries()).map(([key,e]:any)=>({tag:"#"+e.display,normalized:key,post_count:e.count,posts_24h:e.count,likes:e.likes,score:Math.round((e.count*3+e.likes*.1)*100)/100})).sort((a:any,b:any)=>b.score-a.score).slice(0,limit);
        return json({success:true,trending});
      }

      if (url.pathname === "/internal/sessions/start" && request.method === "POST") {
        let body:any;try{body=await request.json();}catch{return json({detail:"Invalid JSON"},400);} const userId=String(body?.user_id||"").trim();
        const user=await db.collection("users").findOne({id:userId},{projection:{_id:0,privacy_strict:1}});if(!user)return json({detail:"User not found"},404);
        const now=new Date().toISOString();if(user.privacy_strict)return json({success:true,session_id:"",started_at:now,privacy_strict:true});
        const sessionId=crypto.randomUUID();await db.collection("users").updateOne({id:userId},{$set:{last_active:now,last_session_start:now}});await db.collection("sessions").insertOne({id:sessionId,user_id:userId,started_at:now,last_activity:now,is_active:true});
        return json({success:true,session_id:sessionId,started_at:now});
      }
      if (url.pathname === "/internal/sessions/ping" && request.method === "POST") {
        let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400);}const now=new Date().toISOString();await db.collection("users").updateOne({id:b.user_id},{$set:{last_active:now}});await db.collection("sessions").updateOne({id:b.session_id,user_id:b.user_id},{$set:{last_activity:now}});return json({success:true,session_id:b.session_id});
      }
      if (url.pathname === "/internal/sessions/end" && request.method === "POST") {
        let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400);}await db.collection("sessions").updateOne({id:b.session_id,user_id:b.user_id},{$set:{is_active:false,ended_at:new Date().toISOString(),duration:Math.max(0,Number(b.duration||0))}});return json({success:true,session_id:b.session_id});
      }
      if (url.pathname === "/internal/screen-time/add" && request.method === "POST") {
        let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400);}const userId=String(b?.user_id||"").trim(),day=/^\d{4}-\d{2}-\d{2}$/.test(String(b?.day||""))?String(b.day):new Date().toISOString().slice(0,10),delta=Math.max(0,Math.min(3600,Math.floor(Number(b?.delta_seconds||0))));
        if(delta)await db.collection("screen_time").updateOne({user_id:userId,day},{$inc:{seconds:delta},$setOnInsert:{user_id:userId,day}},{upsert:true});const row=await db.collection("screen_time").findOne({user_id:userId,day},{projection:{_id:0,seconds:1}});return json({day,seconds:Number(row?.seconds||0)});
      }

      if (url.pathname === "/internal/analytics/stats" && request.method === "POST") {
        let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400);}const uid=String(b?.user_id||""),today=new Date().toISOString().slice(0,10);
        const posts=await db.collection("posts").find({author_id:uid},{projection:{_id:0,likes_count:1,comments_count:1,views:1,created_at:1}}).toArray();
        const followers=await db.collection("follows").countDocuments({followed_id:uid}),following=await db.collection("follows").countDocuments({follower_id:uid}),newFollowers=await db.collection("follows").countDocuments({followed_id:uid,created_at:{$gte:today}});
        const likes=posts.reduce((s:number,p:any)=>s+Number(p.likes_count||0),0),comments=posts.reduce((s:number,p:any)=>s+Number(p.comments_count||0),0),views=posts.reduce((s:number,p:any)=>s+Number(p.views||0),0);
        return json({total_posts:posts.length,posts_today:posts.filter((p:any)=>String(p.created_at||"")>=today).length,total_likes:likes,total_comments:comments,total_views:views,followers_count:followers,following_count:following,new_followers_today:newFollowers,engagement_rate:posts.length?Math.round(((likes+comments)/posts.length)*10)/10:0});
      }
      if (url.pathname === "/internal/analytics/trends" && request.method === "POST") {
        let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400);}const uid=String(b?.user_id||""),days=Math.max(1,Math.min(365,Number(b?.days||30))),since=new Date(Date.now()-days*86400000).toISOString(),start=since.slice(0,10);
        const posts=await db.collection("posts").find({author_id:uid,created_at:{$gte:since}},{projection:{_id:0,id:1,created_at:1}}).toArray(),ids=posts.map((p:any)=>p.id);
        const likes=ids.length?await db.collection("likes").find({post_id:{$in:ids},created_at:{$gte:since}},{projection:{_id:0,created_at:1}}).toArray():[],comments=ids.length?await db.collection("comments").find({post_id:{$in:ids},created_at:{$gte:since}},{projection:{_id:0,created_at:1}}).toArray():[],followers=await db.collection("follows").find({followed_id:uid,created_at:{$gte:since}},{projection:{_id:0,created_at:1}}).toArray();
        const count=(arr:any[])=>{const m:any={};for(const x of arr){const d=String(x.created_at||"").slice(0,10);m[d]=(m[d]||0)+1;}return m},pc=count(posts),lc=count(likes),cc=count(comments),fc=count(followers),out:any[]=[];
        for(let i=days-1;i>=0;i--){const d=new Date(Date.now()-i*86400000).toISOString().slice(0,10);out.push({date:d.slice(5),posts:pc[d]||0,likes:lc[d]||0,comments:cc[d]||0,followers:fc[d]||0});}return json(out);
      }
      if (url.pathname === "/internal/live/active" && request.method === "POST") {
        let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400);}const uid=String(b?.user_id||""),f=await db.collection("follows").find({follower_id:uid},{projection:{_id:0,followed_id:1}}).toArray(),allowed=[uid,...f.map((x:any)=>x.followed_id)],cutoff=new Date(Date.now()-12*3600000).toISOString();
        const rows=await db.collection("live_sessions").find({active:true,host_id:{$in:allowed},started_at:{$gte:cutoff}},{projection:{_id:0,host_id:1,host_username:1,host_profile_pic:1,room_id:1,started_at:1}}).toArray();return json(rows);
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
