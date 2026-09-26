import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

export interface Env {\n  REALTIME?: DurableObjectNamespace;
  MONGO_URL: string;
  DB_NAME?: string;
  SECRET_KEY?: string;
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
}

function corsHeaders(request?: Request): Record<string,string> {
  const origin = request?.headers.get("Origin") || "";
  const allowed = origin === "https://nexus-social.merickoken54.workers.dev" ? origin : "";
  return {
    "Cache-Control": "no-store",
    ...(allowed ? { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Credentials": "true" } : {}),
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Vary": "Origin",
  };
}
function json(data: unknown, status = 200, request?: Request): Response {
  return Response.json(data, { status, headers: corsHeaders(request) });
}
function b64url(input: Uint8Array|string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary=""; for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function hmac(secret:string, data:string): Promise<string> {
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(data))));
}
async function issueToken(secret:string,userId:string):Promise<string>{
  const now=Math.floor(Date.now()/1000), head=b64url(JSON.stringify({alg:"HS256",typ:"JWT"})), body=b64url(JSON.stringify({sub:userId,iat:now,exp:now+7*86400}));
  return head+"."+body+"."+await hmac(secret,head+"."+body);
}

function b64urlDecode(input:string):string {
  const normalized=input.replace(/-/g,"+").replace(/_/g,"/");
  const padded=normalized+"=".repeat((4-normalized.length%4)%4);
  return atob(padded);
}
async function otpHash(code:string):Promise<string>{
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("nexus-otp:"+code));
  return Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function sendBrevoEmail(env:Env,to:string,code:string):Promise<void>{
  if(!env.BREVO_API_KEY) throw new Error("Email service is not configured");
  const response=await fetch("https://api.brevo.com/v3/smtp/email",{
    method:"POST",
    headers:{"Content-Type":"application/json","api-key":env.BREVO_API_KEY,"accept":"application/json"},
    body:JSON.stringify({
      sender:{email:env.BREVO_SENDER_EMAIL||"noreply@nexussocial.com",name:env.BREVO_SENDER_NAME||"Nexus Social"},
      to:[{email:to}],
      subject:"Ton code de connexion Nexus Social",
      htmlContent:`<p>Voici ton code de connexion :</p><p style="font-size:26px;font-weight:bold;letter-spacing:4px">${code}</p><p>Ce code expire dans 10 minutes. Si ce n'est pas toi, change ton mot de passe.</p>`
    })
  });
  if(!response.ok) throw new Error("Unable to send authentication email");
}
async function realtimeSend(env:Env,userId:string,payload:any):Promise<void>{if(!env.REALTIME)return;try{const id=env.REALTIME.idFromName(userId);await env.REALTIME.get(id).fetch("https://realtime.internal/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});}catch{}}\nasync function authUser(request:Request, secret:string, db:any):Promise<any|null>{
  const raw=request.headers.get("Authorization")||""; if(!raw.toLowerCase().startsWith("bearer ")) return null;
  const token=raw.slice(7).trim(), parts=token.split("."); if(parts.length!==3) return null;
  if(await hmac(secret,parts[0]+"."+parts[1])!==parts[2]) return null;
  try { const p=JSON.parse(b64urlDecode(parts[1])); if(!p.sub||Number(p.exp||0)<Math.floor(Date.now()/1000)) return null;
    return await db.collection("users").findOne({id:String(p.sub)});
  } catch { return null; }
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

export class RealtimeHub {
  state: DurableObjectState;
  sockets: Set<WebSocket>;
  constructor(state: DurableObjectState) { this.state=state; this.sockets=new Set(); }
  async fetch(request: Request): Promise<Response> {
    const u=new URL(request.url); if(u.pathname==="/publish"&&request.method==="POST"){const payload=await request.text();for(const ws of this.sockets){try{ws.send(payload);}catch{this.sockets.delete(ws);}}return new Response(null,{status:204});}\n    if ((request.headers.get("Upgrade")||"").toLowerCase() !== "websocket") return new Response("Expected WebSocket",{status:426});
    const pair=new WebSocketPair(); const client=pair[0],server=pair[1];
    server.accept(); this.sockets.add(server);
    server.addEventListener("message",(event:any)=>{ if(event.data==="ping"){try{server.send(JSON.stringify({type:"pong"}));}catch{}} });
    const drop=()=>this.sockets.delete(server); server.addEventListener("close",drop); server.addEventListener("error",drop);
    return new Response(null,{status:101,webSocket:client});
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null,{status:204,headers:corsHeaders(request)});
    const wsMatch=url.pathname.match(/^\/ws\/([^/]+)$/);
    if(wsMatch && (request.headers.get("Upgrade")||"").toLowerCase()==="websocket"){
      if(!env.REALTIME||!env.SECRET_KEY) return new Response("Realtime unavailable",{status:503});
      const userId=decodeURIComponent(wsMatch[1]),raw=url.searchParams.get("token")||"",parts=raw.split(".");
      if(parts.length!==3||await hmac(env.SECRET_KEY,parts[0]+"."+parts[1])!==parts[2])return new Response("Unauthorized",{status:401});
      try{const p=JSON.parse(b64urlDecode(parts[1]));if(String(p.sub)!==userId||Number(p.exp||0)<Math.floor(Date.now()/1000))return new Response("Unauthorized",{status:401});}catch{return new Response("Unauthorized",{status:401});}
      return env.REALTIME.get(env.REALTIME.idFromName(userId)).fetch(request);
    }

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

      if (url.pathname === "/api/health") return json({status:"ok",service:"nexus-social-api-ts",database:dbName},200,request);
      if (url.pathname === "/api/health/mongodb" && request.method === "GET") {
        await client.db("admin").command({ ping: 1 });
        const collections = await db.listCollections({}, { nameOnly: true }).toArray();
        return json({ status: "ok", connected: true, database: dbName, collection_count: collections.length }, 200, request);
      }

      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        if(!env.SECRET_KEY) return json({detail:"Authentication secret is not configured"},503,request);
        let body:any; try{body=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}
        const email=String(body?.email||"").trim().toLowerCase(), password=String(body?.password||"");
        const user=await db.collection("users").findOne({email}); const hash=typeof user?.password==="string"?user.password:"";
        if(!user||!hash||!(await bcrypt.compare(password,hash))) return json({detail:"Invalid email or password"},401,request);
        if(user.age_blocked) return json({detail:"Ce compte n'est pas eligible."},403,request);
        if(user.twofa_enabled) {
          const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0");
          const codeHash=await otpHash(code);
          const expiresAt=new Date(Date.now()+10*60*1000).toISOString();
          await db.collection("verification_codes").updateOne(
            {user_id:user.id,kind:"2fa"},
            {$set:{code_hash:codeHash,expires_at:expiresAt,attempts:0}},
            {upsert:true}
          );
          try { await sendBrevoEmail(env,String(user.email),code); }
          catch { return json({detail:"Unable to send authentication email"},503,request); }
          return json({twofa_required:true,email:user.email},200,request);
        }
        return json({token:await issueToken(env.SECRET_KEY,String(user.id)),user:publicUser(user)},200,request);
      }
      if (url.pathname === "/api/auth/login/2fa" && request.method === "POST") {
        if(!env.SECRET_KEY) return json({detail:"Authentication secret is not configured"},503,request);
        let body:any; try{body=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}
        const email=String(body?.email||"").trim().toLowerCase(), code=String(body?.code||"").trim();
        if(!/^\\d{6}$/.test(code)) return json({detail:"Code invalide ou expire."},400,request);
        const user=await db.collection("users").findOne({email});
        if(!user) return json({detail:"Code invalide ou expire."},400,request);
        const rec=await db.collection("verification_codes").findOne({user_id:user.id,kind:"2fa"});
        if(!rec||String(rec.expires_at||"")<new Date().toISOString()||Number(rec.attempts||0)>=5) return json({detail:"Code invalide ou expire."},400,request);
        if(String(rec.code_hash||"")!==await otpHash(code)){
          await db.collection("verification_codes").updateOne({user_id:user.id,kind:"2fa"},{$inc:{attempts:1}});
          return json({detail:"Code invalide ou expire."},400,request);
        }
        await db.collection("verification_codes").deleteOne({user_id:user.id,kind:"2fa"});
        return json({token:await issueToken(env.SECRET_KEY,String(user.id)),user:publicUser(user)},200,request);
      }
      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        if(!env.SECRET_KEY) return json({detail:"Authentication secret is not configured"},503,request);
        const user=await authUser(request,env.SECRET_KEY,db); if(!user)return json({detail:"Not authenticated"},401,request);
        return json(publicUser(user),200,request);
      }

      const user = url.pathname.startsWith("/api/") && env.SECRET_KEY ? await authUser(request,env.SECRET_KEY,db) : null;
      if (url.pathname.startsWith("/api/") && !user) return json({detail:"Not authenticated"},401,request);
      const uid=String(user?.id||"");
      const userRoute = url.pathname.match(/^\/api\/users\/([^/]+)(?:\/(stats|posts|follow-status|reposts|mentions|follow))?$/);
      if (userRoute) {
        const targetId = decodeURIComponent(userRoute[1]);
        const action = userRoute[2] || "profile";
        const target = await db.collection("users").findOne({ id: targetId }, { projection: { _id: 0, password: 0 } });
        if (!target) return json({ detail: "User not found" }, 404, request);

        const canViewTarget = async () => {
          if (targetId === uid || !target.is_private) return true;
          return Boolean(await db.collection("follows").findOne({ follower_id: uid, followed_id: targetId, status: "following" }));
        };

        if (action === "profile" && request.method === "GET") {
          if (targetId !== uid) {
            await db.collection("profile_views").insertOne({ profile_id: targetId, viewer_id: uid, ts: new Date().toISOString() }).catch(() => undefined);
          }
          return json(publicUser(target as Record<string, any>), 200, request);
        }
        if (action === "stats" && request.method === "GET") {
          const [followers, following, posts] = await Promise.all([
            db.collection("follows").countDocuments({ followed_id: targetId, status: "following" }),
            db.collection("follows").countDocuments({ follower_id: targetId, status: "following" }),
            db.collection("posts").countDocuments({ author_id: targetId }),
          ]);
          return json({ followers, following, posts }, 200, request);
        }
        if (action === "follow-status" && request.method === "GET") {
          if (targetId === uid) return json({ status: "self" }, 200, request);
          const followed = await db.collection("follows").findOne({ follower_id: uid, followed_id: targetId, status: "following" });
          if (followed) return json({ status: "following" }, 200, request);
          const pending = await db.collection("follow_requests").findOne({ requester_id: uid, target_id: targetId });
          return json({ status: pending ? "pending" : "not_following" }, 200, request);
        }
        if (action === "posts" && request.method === "GET") {
          if (!(await canViewTarget())) return json({ detail: "Private profile" }, 403, request);
          const posts = await db.collection("posts").find({ author_id: targetId }, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(200).toArray();
          const ids = posts.map((p:any) => p.id).filter(Boolean);
          const [liked, saved] = ids.length ? await Promise.all([
            db.collection("likes").find({ user_id: uid, post_id: { $in: ids } }, { projection: { _id: 0, post_id: 1 } }).toArray(),
            db.collection("saved_posts").find({ user_id: uid, post_id: { $in: ids } }, { projection: { _id: 0, post_id: 1 } }).toArray(),
          ]) : [[], []];
          const likedSet = new Set(liked.map((x:any) => x.post_id)), savedSet = new Set(saved.map((x:any) => x.post_id));
          return json(posts.map((p:any) => ({ ...p, is_liked: likedSet.has(p.id), is_saved: savedSet.has(p.id) })), 200, request);
        }
        if ((action === "reposts" || action === "mentions") && request.method === "GET") {
          if (!(await canViewTarget())) return json({ detail: "Private profile" }, 403, request);
          const query:any = action === "reposts"
            ? { author_id: targetId, repost_of: { $ne: null } }
            : { mentioned_user_ids: targetId, repost_of: null };
          const posts = await db.collection("posts").find(query, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(50).toArray();
          const ids = posts.map((p:any) => p.id).filter(Boolean);
          const liked = ids.length ? await db.collection("likes").find({ user_id: uid, post_id: { $in: ids } }, { projection: { _id: 0, post_id: 1 } }).toArray() : [];
          const likedSet = new Set(liked.map((x:any) => x.post_id));
          return json(posts.map((p:any) => ({ ...p, is_liked: likedSet.has(p.id), is_reposted: action === "reposts" && targetId === uid })), 200, request);
        }
        if (action === "follow" && request.method === "POST") {
          if (targetId === uid) return json({ detail: "Cannot follow yourself" }, 400, request);
          const existing = await db.collection("follows").findOne({ follower_id: uid, followed_id: targetId });
          if (existing) {
            await db.collection("follows").deleteOne({ _id: existing._id });
            await Promise.all([
              db.collection("users").updateOne({ id: uid }, { $inc: { following_count: -1 } }),
              db.collection("users").updateOne({ id: targetId }, { $inc: { followers_count: -1 } }),
            ]);
            return json({ following: false, status: "not_following" }, 200, request);
          }
          if (target.is_private) {
            const pending = await db.collection("follow_requests").findOne({ requester_id: uid, target_id: targetId });
            if (pending) {
              await db.collection("follow_requests").deleteOne({ _id: pending._id });
              return json({ following: false, status: "not_following" }, 200, request);
            }
            await db.collection("follow_requests").insertOne({ id: crypto.randomUUID(), requester_id: uid, target_id: targetId, created_at: new Date().toISOString() });
            return json({ following: false, status: "pending" }, 200, request);
          }
          await db.collection("follows").insertOne({ id: crypto.randomUUID(), follower_id: uid, followed_id: targetId, status: "following", created_at: new Date().toISOString() });
          await Promise.all([
            db.collection("users").updateOne({ id: uid }, { $inc: { following_count: 1 } }),
            db.collection("users").updateOne({ id: targetId }, { $inc: { followers_count: 1 } }),
          ]);
          return json({ following: true, status: "following" }, 200, request);
        }
        if (action === "follow" && request.method === "DELETE") {
          const result = await db.collection("follows").deleteOne({ follower_id: uid, followed_id: targetId });
          if (result.deletedCount) {
            await Promise.all([
              db.collection("users").updateOne({ id: uid }, { $inc: { following_count: -1 } }),
              db.collection("users").updateOne({ id: targetId }, { $inc: { followers_count: -1 } }),
            ]);
          }
          await Promise.all([
            db.collection("follow_requests").deleteMany({ requester_id: uid, target_id: targetId }),
            db.collection("notifications").deleteMany({ type: "follow_request", from_user_id: uid, user_id: targetId }),
          ]);
          return json({ following: false, status: "not_following" }, 200, request);
        }
      }

      if (url.pathname === "/api/stories/feed" && request.method === "GET") {
        const follows=await db.collection("follows").find({follower_id:uid,status:"following"},{projection:{_id:0,followed_id:1}}).toArray();
        const allowed=[uid,...follows.map((x:any)=>x.followed_id)], cutoff=new Date(Date.now()-86400000).toISOString();
        const stories=await db.collection("stories").find({author_id:{$in:allowed},created_at:{$gte:cutoff}},{projection:{_id:0}}).sort({created_at:-1}).limit(500).toArray();
        const authorIds=[...new Set(stories.map((s:any)=>s.author_id).filter(Boolean))], users=authorIds.length?await db.collection("users").find({id:{$in:authorIds}},{projection:{_id:0,id:1,username:1,profile_pic:1,is_verified:1}}).toArray():[];
        const userMap=new Map(users.map((u:any)=>[u.id,u])), groups=new Map<string,any>();
        for(const s of stories){const a:any=userMap.get(s.author_id)||{};if(!groups.has(s.author_id))groups.set(s.author_id,{user_id:s.author_id,username:a.username||s.author_username||"",profile_pic:a.profile_pic||s.author_profile_pic||null,is_verified:Boolean(a.is_verified),stories:[],last_story_time:s.created_at});groups.get(s.author_id).stories.push(s);}
        const out=Array.from(groups.values());for(const g of out)g.stories.sort((a:any,b:any)=>String(a.created_at).localeCompare(String(b.created_at)));out.sort((a:any,b:any)=>a.user_id===uid?-1:b.user_id===uid?1:String(b.last_story_time).localeCompare(String(a.last_story_time)));
        return json(out,200,request);
      }
      if (url.pathname === "/api/users/search" && request.method === "GET") {
        const q=String(url.searchParams.get("q")||"").trim();if(!q)return json([],200,request);const safeQ=q.replace(/[.*+?^${}()|[\\]\\\\]/g,"\\\\const q=String(url.searchParams.get("q")||"").trim();if(!q)return json([],200,request);");
        const users=await db.collection("users").find({$or:[{username:{$regex:safeQ,$options:"i"}},{bio:{$regex:safeQ,$options:"i"}}]},{projection:{_id:0,password:0}}).limit(20).toArray(),ids=users.map((u:any)=>u.id).filter(Boolean);
        const follows=ids.length?await db.collection("follows").find({follower_id:uid,followed_id:{$in:ids},status:"following"},{projection:{_id:0,followed_id:1}}).toArray():[], following=new Set(follows.map((x:any)=>x.followed_id));
        return json(users.map((u:any)=>({id:u.id,username:u.username,bio:u.bio||"",profile_pic:u.profile_pic||null,followers_count:u.followers_count||0,following_count:u.following_count||0,is_following:following.has(u.id),created_at:u.created_at,is_verified:Boolean(u.is_verified),is_premium:Boolean(u.is_premium)})),200,request);
      }
      if (url.pathname === "/api/trending/hashtags" && request.method === "GET") {
        const limit=Math.max(1,Math.min(50,Number(url.searchParams.get("limit")||10))),since=new Date(Date.now()-86400000).toISOString(),posts=await db.collection("posts").find({created_at:{$gte:since},media_type:{$ne:"video"}},{projection:{_id:0,content:1,likes_count:1}}).sort({created_at:-1}).limit(3000).toArray(),stats=new Map<string,any>();
        for(const p of posts){const seen=new Set<string>();for(const m of String(p.content||"").matchAll(/#(\w+)/gu)){const display=m[1],key=display.toLowerCase();if(seen.has(key))continue;seen.add(key);const e=stats.get(key)||{display,count:0,likes:0};e.count++;e.likes+=Number(p.likes_count||0);stats.set(key,e);}}
        const trending=Array.from(stats.entries()).map(([key,e]:any)=>({tag:"#"+e.display,normalized:key,post_count:e.count,posts_24h:e.count,likes:e.likes,score:Math.round((e.count*3+e.likes*.1)*100)/100})).sort((a:any,b:any)=>b.score-a.score).slice(0,limit);return json({success:true,trending},200,request);
      }
      if (url.pathname === "/api/geo/language" && request.method === "GET") {
        const country=String((request as any).cf?.country||"").toUpperCase()||null,langs:any={FR:"fr",BE:"fr",CH:"fr",CA:"fr",TR:"tr",ES:"es",MX:"es",DE:"de",AT:"de",IT:"it",PT:"pt",BR:"pt",GB:"en",US:"en",IE:"en",AU:"en"},language=(country&&langs[country])||"en";return json({country,language,supported:["de","en","es","fr","it","pt","tr"]},200,request);
      }
      if (url.pathname === "/api/geo/status" && request.method === "GET") {
        const country=String((request as any).cf?.country||"").toUpperCase()||null,eu=new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]).has(country||""),langs:any={FR:"fr",BE:"fr",CH:"fr",CA:"fr",TR:"tr",ES:"es",MX:"es",DE:"de",AT:"de",IT:"it",PT:"pt",BR:"pt"};return json({profile:eu?"EU_STANDARD":"GLOBAL_STANDARD",country,eu,restricted:eu,minimum_age:15,consent_style:eu?"explicit":"standard",read_only:false,suggested_language:(country&&langs[country])||"en"},200,request);
      }
      if (url.pathname === "/api/weather" && request.method === "GET") {
        const lat=Number(url.searchParams.get("lat")),lon=Number(url.searchParams.get("lon"));if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat>90||lon< -180||lon>180)return json({detail:"Coordonnées invalides"},400,request);try{const r=await fetch("https://api.open-meteo.com/v1/forecast?latitude="+encodeURIComponent(lat)+"&longitude="+encodeURIComponent(lon)+"&current=temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m&timezone=auto");return json({weather:r.ok?await r.json():null},200,request);}catch{return json({weather:null},200,request);}
      }
      if (url.pathname === "/api/finance" && request.method === "GET") {
        const catalog:any={bitcoin:"Bitcoin",ethereum:"Ethereum",solana:"Solana",cardano:"Cardano",ripple:"XRP",dogecoin:"Dogecoin"},cfg:any=user.widget_stack_config||{},ids=(url.searchParams.get("ids")||"").split(",").map(x=>x.trim()).filter(Boolean),want=(ids.length?ids:(cfg.finance_assets||["bitcoin","ethereum","solana"])).filter((x:any)=>catalog[x]).slice(0,10);try{const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids="+encodeURIComponent(want.join(","))+"&vs_currencies=eur&include_24hr_change=true"),d:any=r.ok?await r.json():{};return json({assets:want.map((id:any)=>({id,name:catalog[id],price_eur:d[id]?.eur??null,change_24h:d[id]?.eur_24h_change??null})),catalog},200,request);}catch{return json({assets:[],catalog},200,request);}
      }
      if (url.pathname === "/api/livescores" && request.method === "GET") {
        const now=new Date(),from=new Date(now.getTime()-6*3600000).toISOString(),to=new Date(now.getTime()+48*3600000).toISOString();
        const rows=await db.collection("live_scores").find({$or:[{starts_at:{$gte:from,$lte:to}},{status:{$in:["live","in_progress"]}}]},{projection:{_id:0}}).sort({starts_at:1}).limit(100).toArray();
        return json({matches:rows,updated_at:now.toISOString(),source:rows.length?"cache":"none"},200,request);
      }
      if (url.pathname === "/api/users/me/profile-views" && request.method === "GET") {
        const since=new Date(Date.now()-30*86400000).toISOString(),rows=await db.collection("profile_views").find({profile_id:uid,ts:{$gte:since}},{projection:{_id:0,viewer_id:1,ts:1}}).sort({ts:-1}).limit(500).toArray(),ordered:string[]=[],seen=new Set<string>();for(const x of rows)if(x.viewer_id&&!seen.has(x.viewer_id)){seen.add(x.viewer_id);ordered.push(x.viewer_id);}let visitors:any[]=[];if(user.is_premium&&ordered.length){const top=ordered.slice(0,12),us=await db.collection("users").find({id:{$in:top}},{projection:{_id:0,id:1,username:1,profile_pic:1,is_verified:1,is_premium:1}}).toArray(),m=new Map(us.map((u:any)=>[u.id,u]));visitors=top.map(id=>m.get(id)).filter(Boolean);}return json({count:ordered.length,is_premium:Boolean(user.is_premium),visitors},200,request);
      }
      if (url.pathname === "/api/users/me/sessions/start" && request.method === "POST") {
        const now=new Date().toISOString();if(user.privacy_strict)return json({success:true,session_id:"",started_at:now,privacy_strict:true},200,request);const sessionId=crypto.randomUUID();await db.collection("users").updateOne({id:uid},{$set:{last_active:now,last_session_start:now}});await db.collection("sessions").insertOne({id:sessionId,user_id:uid,started_at:now,last_activity:now,is_active:true});return json({success:true,session_id:sessionId,started_at:now},200,request);
      }
      if (url.pathname === "/api/users/me/sessions/ping" && request.method === "POST") {let b:any={};try{b=await request.json();}catch{}const now=new Date().toISOString();await db.collection("users").updateOne({id:uid},{$set:{last_active:now}});if(b?.session_id)await db.collection("sessions").updateOne({id:b.session_id,user_id:uid},{$set:{last_activity:now}});return json({success:true,session_id:b?.session_id||""},200,request);}
      if (url.pathname === "/api/users/me/sessions/end" && request.method === "POST") {let b:any={};try{b=await request.json();}catch{}if(b?.session_id)await db.collection("sessions").updateOne({id:b.session_id,user_id:uid},{$set:{is_active:false,ended_at:new Date().toISOString(),duration:Math.max(0,Number(b.duration||0))}});return json({success:true,session_id:b?.session_id||""},200,request);}
      if (url.pathname === "/api/users/me/screen-time" && request.method === "GET") {const day=/^\d{4}-\d{2}-\d{2}$/.test(String(url.searchParams.get("day")||""))?String(url.searchParams.get("day")):new Date().toISOString().slice(0,10),row=await db.collection("screen_time").findOne({user_id:uid,day},{projection:{_id:0,seconds:1}});return json({day,seconds:Number(row?.seconds||0)},200,request);}\n      if (url.pathname === "/api/users/me/screen-time" && request.method === "POST") {let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const day=/^\d{4}-\d{2}-\d{2}$/.test(String(b?.day||""))?String(b.day):new Date().toISOString().slice(0,10),delta=Math.max(0,Math.min(3600,Math.floor(Number(b?.delta_seconds??b?.seconds??0))));if(delta)await db.collection("screen_time").updateOne({user_id:uid,day},{$inc:{seconds:delta},$setOnInsert:{user_id:uid,day}},{upsert:true});const row=await db.collection("screen_time").findOne({user_id:uid,day},{projection:{_id:0,seconds:1}});return json({day,seconds:Number(row?.seconds||0)},200,request);}
      if (url.pathname === "/api/sessions/start" && request.method === "POST") {
        const user=await db.collection("users").findOne({id:uid},{projection:{_id:0,privacy_strict:1}}),now=new Date().toISOString();if(user?.privacy_strict)return json({success:true,session_id:"",started_at:now,privacy_strict:true},200,request);const sessionId=crypto.randomUUID();await db.collection("users").updateOne({id:uid},{$set:{last_active:now,last_session_start:now}});await db.collection("sessions").insertOne({id:sessionId,user_id:uid,started_at:now,last_activity:now,is_active:true});return json({success:true,session_id:sessionId,started_at:now},200,request);
      }
      if (url.pathname === "/api/sessions/ping" && request.method === "POST") {let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const now=new Date().toISOString();await db.collection("users").updateOne({id:uid},{$set:{last_active:now}});if(b?.session_id)await db.collection("sessions").updateOne({id:b.session_id,user_id:uid},{$set:{last_activity:now}});return json({success:true,session_id:b?.session_id||""},200,request);}
      if (url.pathname === "/api/sessions/end" && request.method === "POST") {let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}if(b?.session_id)await db.collection("sessions").updateOne({id:b.session_id,user_id:uid},{$set:{is_active:false,ended_at:new Date().toISOString(),duration:Math.max(0,Number(b.duration||0))}});return json({success:true,session_id:b?.session_id||""},200,request);}
      if (url.pathname === "/api/screen-time/add" && request.method === "POST") {let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const day=/^\d{4}-\d{2}-\d{2}$/.test(String(b?.day||""))?String(b.day):new Date().toISOString().slice(0,10),delta=Math.max(0,Math.min(3600,Math.floor(Number(b?.delta_seconds||0))));if(delta)await db.collection("screen_time").updateOne({user_id:uid,day},{$inc:{seconds:delta},$setOnInsert:{user_id:uid,day}},{upsert:true});const row=await db.collection("screen_time").findOne({user_id:uid,day},{projection:{_id:0,seconds:1}});return json({day,seconds:Number(row?.seconds||0)},200,request);}
      if (["/api/analytics/stats","/api/analytics/me/stats"].includes(url.pathname) && request.method === "GET") {
        const today=new Date().toISOString().slice(0,10),posts=await db.collection("posts").find({author_id:uid},{projection:{_id:0,likes_count:1,comments_count:1,views:1,created_at:1}}).toArray(),[followers,following,newFollowers]=await Promise.all([db.collection("follows").countDocuments({followed_id:uid,status:"following"}),db.collection("follows").countDocuments({follower_id:uid,status:"following"}),db.collection("follows").countDocuments({followed_id:uid,status:"following",created_at:{$gte:today}})]),likes=posts.reduce((s:number,p:any)=>s+Number(p.likes_count||0),0),comments=posts.reduce((s:number,p:any)=>s+Number(p.comments_count||0),0),views=posts.reduce((s:number,p:any)=>s+Number(p.views||0),0);return json({total_posts:posts.length,posts_today:posts.filter((p:any)=>String(p.created_at||"")>=today).length,total_likes:likes,total_comments:comments,total_views:views,followers_count:followers,following_count:following,new_followers_today:newFollowers,engagement_rate:posts.length?Math.round(((likes+comments)/posts.length)*10)/10:0},200,request);
      }
      if (["/api/analytics/trends","/api/analytics/me/trends"].includes(url.pathname) && request.method === "GET") {
        const days=Math.max(1,Math.min(365,Number(url.searchParams.get("days")||30))),since=new Date(Date.now()-days*86400000).toISOString(),posts=await db.collection("posts").find({author_id:uid,created_at:{$gte:since}},{projection:{_id:0,id:1,created_at:1}}).toArray(),ids=posts.map((p:any)=>p.id),[likes,comments,followers]=await Promise.all([ids.length?db.collection("likes").find({post_id:{$in:ids},created_at:{$gte:since}},{projection:{_id:0,created_at:1}}).toArray():Promise.resolve([]),ids.length?db.collection("comments").find({post_id:{$in:ids},created_at:{$gte:since}},{projection:{_id:0,created_at:1}}).toArray():Promise.resolve([]),db.collection("follows").find({followed_id:uid,status:"following",created_at:{$gte:since}},{projection:{_id:0,created_at:1}}).toArray()]),count=(arr:any[])=>{const m:any={};for(const x of arr){const d=String(x.created_at||"").slice(0,10);m[d]=(m[d]||0)+1;}return m},pc=count(posts),lc=count(likes),cc=count(comments),fc=count(followers),out:any[]=[];for(let i=days-1;i>=0;i--){const d=new Date(Date.now()-i*86400000).toISOString().slice(0,10);out.push({date:d.slice(5),posts:pc[d]||0,likes:lc[d]||0,comments:cc[d]||0,followers:fc[d]||0});}return json(out,200,request);
      }

      if(url.pathname==="/api/messages/conversations"&&request.method==="GET"){
        const now=new Date().toISOString(),msgs=await db.collection("messages").find({$or:[{sender_id:uid},{recipient_id:uid}]},{projection:{_id:0,content:1,sender_id:1,recipient_id:1,created_at:1,media_type:1,expires_at:1,read:1}}).sort({created_at:-1}).limit(1000).toArray(),clears=await db.collection("conversation_clears").find({user_id:uid},{projection:{_id:0,peer_id:1,cleared_at:1}}).toArray(),prefs=await db.collection("conversation_prefs").find({user_id:uid},{projection:{_id:0}}).toArray(),clearMap=new Map(clears.map((x:any)=>[x.peer_id,x.cleared_at])),prefMap=new Map(prefs.map((x:any)=>[x.target_id,x])),latest=new Map<string,any>();
        for(const m of msgs){const peer=m.sender_id===uid?m.recipient_id:m.sender_id;if(latest.has(peer)||(m.expires_at&&m.expires_at<=now)||(clearMap.get(peer)&&String(m.created_at||"")<=String(clearMap.get(peer))))continue;latest.set(peer,m);}
        const ids=[...latest.keys()];if(!ids.length)return json([],200,request);const users=await db.collection("users").find({id:{$in:ids}},{projection:{_id:0,id:1,username:1,profile_pic:1,last_active:1,show_active_status:1}}).toArray(),userMap=new Map(users.map((x:any)=>[x.id,x])),unreads=await db.collection("messages").aggregate([{$match:{sender_id:{$in:ids},recipient_id:uid,read:false}},{$group:{_id:"$sender_id",n:{$sum:1}}}]).toArray(),unreadMap=new Map(unreads.map((x:any)=>[x._id,x.n])),cutoff=new Date(Date.now()-120000).toISOString(),out:any[]=[];
        for(const [peer,m] of latest){const u:any=userMap.get(peer);if(!u)continue;const p:any=prefMap.get(peer)||{},content=String(m.content||"");out.push({user_id:u.id,username:u.username,profile_pic:u.profile_pic||null,last_message:content?content.slice(0,120):(m.media_type==="audio"?"🎤 Message vocal":m.media_type?"📷 Photo":""),last_message_time:m.created_at,unread_count:Number(unreadMap.get(peer)||0),pinned:Boolean(p.pinned),muted:Boolean(p.muted),marked_unread:Boolean(p.marked_unread),is_online:u.show_active_status!==false&&String(u.last_active||"")>=cutoff});}return json(out,200,request);
      }
      if(url.pathname==="/api/notes"){
        if(request.method==="GET"){const now=new Date().toISOString(),following=await db.collection("follows").find({follower_id:uid,status:"following"},{projection:{_id:0,followed_id:1,following_id:1}}).toArray(),followers=await db.collection("follows").find({$or:[{followed_id:uid},{following_id:uid}],status:"following"},{projection:{_id:0,follower_id:1}}).toArray(),a=new Set(following.map((x:any)=>x.followed_id||x.following_id).filter(Boolean)),b=new Set(followers.map((x:any)=>x.follower_id).filter(Boolean)),ids=[uid,...[...a].filter(x=>b.has(x))],notes=await db.collection("notes").find({user_id:{$in:ids},expires_at:{$gt:now}},{projection:{_id:0}}).sort({created_at:-1}).limit(100).toArray(),users=await db.collection("users").find({id:{$in:ids}},{projection:{_id:0,id:1,username:1,profile_pic:1}}).toArray(),um=new Map(users.map((x:any)=>[x.id,x]));const out=notes.map((n:any)=>{const u:any=um.get(n.user_id)||{};return{id:n.id,user_id:n.user_id,username:u.username,profile_pic:u.profile_pic||null,content:n.content||"",created_at:n.created_at,is_self:n.user_id===uid}}).sort((x:any,y:any)=>Number(y.is_self)-Number(x.is_self));return json({success:true,notes:out},200,request);}
        if(request.method==="POST"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const content=String(b?.content||"").trim().slice(0,80);if(!content)return json({detail:"Note vide"},400,request);const now=new Date(),note={id:crypto.randomUUID(),user_id:uid,content,created_at:now.toISOString(),expires_at:new Date(now.getTime()+86400000).toISOString()};await db.collection("notes").deleteMany({user_id:uid});await db.collection("notes").insertOne(note);return json({success:true,note:{...note,username:user.username,profile_pic:user.profile_pic||null,is_self:true}},200,request);}
        if(request.method==="DELETE"){await db.collection("notes").deleteMany({user_id:uid});return json({success:true},200,request);}
      }
      const clearConversation=url.pathname.match(/^\/api\/messages\/conversations\/([^/]+)$/);
      if(clearConversation&&request.method==="DELETE"){await db.collection("conversation_clears").updateOne({user_id:uid,peer_id:decodeURIComponent(clearConversation[1])},{$set:{cleared_at:new Date().toISOString()}},{upsert:true});return json({success:true},200,request);}
      if(url.pathname==="/api/messages/groups-list"&&request.method==="GET"){const groups=await db.collection("group_chats").find({member_ids:uid},{projection:{_id:0}}).limit(100).toArray(),ids=groups.map((g:any)=>g.id),prefs=await db.collection("conversation_prefs").find({user_id:uid,target_id:{$in:ids}},{projection:{_id:0}}).toArray(),pm=new Map(prefs.map((p:any)=>[p.target_id,p]));const out=[];for(const g of groups){const last=await db.collection("group_messages").find({group_id:g.id,deleted_for:{$ne:uid}},{projection:{_id:0,content:1,media_urls:1,created_at:1,sender_username:1}}).sort({created_at:-1}).limit(1).next(),p:any=pm.get(g.id)||{};out.push({...g,last_message:last?(last.media_urls?.length?"📷 Photo":String(last.content||"").slice(0,120)):"",last_message_time:last?.created_at||g.created_at,pinned:Boolean(p.pinned),muted:Boolean(p.muted),marked_unread:Boolean(p.marked_unread)});}return json({success:true,groups:out},200,request);}
      if(url.pathname==="/api/messages/scheduled"){
        if(request.method==="GET"){const peer=url.searchParams.get("peer_id")||"",q:any={sender_id:uid,status:"pending"};if(peer)q.recipient_id=peer;const rows=await db.collection("scheduled_messages").find(q,{projection:{_id:0}}).sort({scheduled_at:1}).limit(100).toArray();return json(rows,200,request);}
        if(request.method==="POST"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const recipientId=String(b?.recipient_id||"").trim(),content=String(b?.content||"").trim(),media=b?.media_url||null,when=new Date(String(b?.scheduled_at||""));if(!recipientId||(!content&&!media))return json({detail:"Destinataire et contenu requis"},400,request);if(Number.isNaN(when.getTime()))return json({detail:"Date de planification invalide"},400,request);const now=Date.now();if(when.getTime()<=now+30000)return json({detail:"Choisissez une heure dans le futur"},400,request);if(when.getTime()>now+30*86400000)return json({detail:"30 jours maximum"},400,request);const recipient=await db.collection("users").findOne({id:recipientId});if(!recipient)return json({detail:"Recipient not found"},404,request);if(recipient.is_minor&&!user.is_minor){const [a,z]=await Promise.all([db.collection("follows").findOne({follower_id:uid,followed_id:recipientId,status:"following"}),db.collection("follows").findOne({follower_id:recipientId,followed_id:uid,status:"following"})]);if(!a||!z)return json({detail:"Abonnement mutuel requis pour écrire à ce compte."},403,request);}const row={id:crypto.randomUUID(),sender_id:uid,recipient_id:recipientId,content:content.slice(0,10000),media_url:media,media_type:b?.media_type||null,scheduled_at:when.toISOString(),status:"pending",created_at:new Date().toISOString()};await db.collection("scheduled_messages").insertOne(row);return json({success:true,id:row.id,scheduled_at:row.scheduled_at},200,request);}
      }
      const scheduled=url.pathname.match(/^\/api\/messages\/scheduled\/([^/]+)(?:\/(send-now))?$/);
      if(scheduled){const id=decodeURIComponent(scheduled[1]),action=scheduled[2],s=await db.collection("scheduled_messages").findOne({id,sender_id:uid,status:"pending"});if(!s)return json({detail:"Message planifié introuvable"},404,request);if(request.method==="DELETE"&&!action){await db.collection("scheduled_messages").deleteOne({id,sender_id:uid,status:"pending"});return json({success:true},200,request);}if(request.method==="PUT"&&!action){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const when=new Date(String(b?.scheduled_at||"")),now=Date.now();if(Number.isNaN(when.getTime()))return json({detail:"Date invalide"},400,request);if(when.getTime()<=now+30000||when.getTime()>now+30*86400000)return json({detail:"Heure hors limites"},400,request);await db.collection("scheduled_messages").updateOne({id},{$set:{scheduled_at:when.toISOString()}});return json({success:true,scheduled_at:when.toISOString()},200,request);}if(request.method==="POST"&&action==="send-now"){const recipient=await db.collection("users").findOne({id:s.recipient_id});if(!recipient)return json({detail:"Envoi impossible"},409,request);const claim=await db.collection("scheduled_messages").updateOne({id,status:"pending"},{$set:{status:"sending"}});if(!claim.modifiedCount)return json({detail:"Envoi impossible"},409,request);const key=[uid,s.recipient_id].sort().join(":"),settings=await db.collection("conversation_settings").findOne({pair_key:key}),ttl=Number(settings?.ephemeral_ttl||0),now=new Date(),msg={id:crypto.randomUUID(),sender_id:uid,sender_username:user.username,sender_profile_pic:user.profile_pic||null,recipient_id:s.recipient_id,recipient_username:recipient.username,content:s.content||"",media_url:s.media_url||null,media_type:s.media_type||null,reply_to_id:null,expires_at:ttl>0?new Date(now.getTime()+ttl*1000).toISOString():null,read:false,created_at:now.toISOString()};await db.collection("messages").insertOne(msg);await db.collection("scheduled_messages").updateOne({id},{$set:{status:"sent",sent_at:now.toISOString(),message_id:msg.id}});return json({success:true},200,request);}}
      const groupBase=url.pathname.match(/^\/api\/messages\/groups\/([^/]+)$/);
      if(groupBase){const gid=decodeURIComponent(groupBase[1]),g=await db.collection("group_chats").findOne({id:gid},{projection:{_id:0}});if(!g)return json({detail:"Group not found"},404,request);if(request.method==="GET"){if(!g.member_ids?.includes(uid))return json({detail:"Not a member"},403,request);return json({success:true,group:g},200,request);}if(request.method==="PUT"){if(!g.admin_ids?.includes(uid))return json({detail:"Seuls les admins peuvent modifier le groupe"},403,request);let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const update:any={updated_at:new Date().toISOString()};if("name" in b){const name=String(b.name||"").trim();if(!name)return json({detail:"Le nom du groupe doit être une chaîne non vide"},400,request);update.name=name;}if("avatar_url" in b)update.avatar_url=b.avatar_url||null;if(Object.keys(update).length===1)return json({detail:"Aucune donnée à mettre à jour"},400,request);await db.collection("group_chats").updateOne({id:gid},{$set:update});return json({success:true,group:await db.collection("group_chats").findOne({id:gid},{projection:{_id:0}})},200,request);}}
      if(url.pathname==="/api/messages/groups"&&request.method==="POST"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const name=String(b?.name||"").trim(),members=Array.isArray(b?.member_ids)?b.member_ids:[];if(!name)return json({detail:"Le nom du groupe est requis"},400,request);if(members.length&&await db.collection("users").countDocuments({id:{$in:members}})!==new Set(members).size)return json({detail:"Certains utilisateurs n'existent pas"},400,request);const now=new Date().toISOString(),g={id:crypto.randomUUID(),name,avatar_url:b?.avatar_url||null,creator_id:uid,admin_ids:[uid],member_ids:[uid,...members.filter((x:any)=>x!==uid)],settings:{allow_members_to_add:b?.allow_members_to_add!==false,allow_members_to_send_media:b?.allow_members_to_send_media!==false},created_at:now,updated_at:now};await db.collection("group_chats").insertOne(g);return json({success:true,group:g},200,request);}
      const groupMsgs=url.pathname.match(/^\/api\/messages\/groups\/([^/]+)\/messages$/);
      if(groupMsgs){const gid=decodeURIComponent(groupMsgs[1]),g=await db.collection("group_chats").findOne({id:gid});if(!g)return json({detail:"Group not found"},404,request);if(!g.member_ids?.includes(uid))return json({detail:"Not a member"},403,request);if(request.method==="GET"){const limit=Math.min(Math.max(Number(url.searchParams.get("limit")||50),1),100),skip=Math.max(Number(url.searchParams.get("skip")||0),0),msgs=await db.collection("group_messages").find({group_id:gid,deleted_for:{$ne:uid}},{projection:{_id:0}}).sort({created_at:-1}).skip(skip).limit(limit).toArray();msgs.reverse();return json({success:true,messages:msgs},200,request);}if(request.method==="POST"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const content=String(b?.content||"").trim(),media_urls=Array.isArray(b?.media_urls)?b.media_urls:[];if(!content&&!media_urls.length)return json({detail:"Le contenu du message est requis"},400,request);const msg={id:crypto.randomUUID(),group_id:gid,sender_id:uid,sender_username:user.username,sender_profile_pic:user.profile_pic||null,content:content.slice(0,10000),media_urls,reply_to_id:b?.reply_to_id||null,reactions:[],read_by:[uid],deleted_for:[],created_at:new Date().toISOString()};await db.collection("group_messages").insertOne(msg);for(const memberId of (g.member_ids||[]))if(memberId!==uid)await realtimeSend(env,memberId,{type:"group_message",data:msg});return json({success:true,message:msg},200,request);}}
      const groupMembers=url.pathname.match(/^\/api\/messages\/groups\/([^/]+)\/members$/);
      if(groupMembers){const gid=decodeURIComponent(groupMembers[1]),g=await db.collection("group_chats").findOne({id:gid});if(!g)return json({detail:"Group not found"},404,request);if(request.method==="GET"){if(!g.member_ids?.includes(uid))return json({detail:"Not a member"},403,request);const users=await db.collection("users").find({id:{$in:g.member_ids||[]}},{projection:{_id:0,id:1,username:1,profile_pic:1}}).toArray(),members=users.map((u:any)=>({...u,is_admin:g.admin_ids?.includes(u.id)||false,is_creator:u.id===g.creator_id})).sort((a:any,b:any)=>Number(b.is_creator)-Number(a.is_creator)||Number(b.is_admin)-Number(a.is_admin)||String(a.username||"").localeCompare(String(b.username||"")));return json({success:true,members,is_admin:g.admin_ids?.includes(uid)||false,creator_id:g.creator_id},200,request);}if(request.method==="POST"){if(!g.admin_ids?.includes(uid))return json({detail:"Admin only"},403,request);let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const member=String(b?.user_id||"");if(!await db.collection("users").findOne({id:member}))return json({detail:"User not found"},404,request);await db.collection("group_chats").updateOne({id:gid},{$addToSet:{member_ids:member},$set:{updated_at:new Date().toISOString()}});return json({success:true,message:"Member added"},200,request);}}
      const removeMember=url.pathname.match(/^\/api\/messages\/groups\/([^/]+)\/members\/([^/]+)$/);
      if(removeMember&&request.method==="DELETE"){const gid=decodeURIComponent(removeMember[1]),member=decodeURIComponent(removeMember[2]),g=await db.collection("group_chats").findOne({id:gid});if(!g)return json({detail:"Group not found"},404,request);const self=member===uid;if(!self&&!g.admin_ids?.includes(uid))return json({detail:"Seuls les admins peuvent retirer un membre"},403,request);if(member===g.creator_id&&!self)return json({detail:"Impossible de retirer le créateur du groupe"},400,request);const remaining=(g.member_ids||[]).filter((x:any)=>x!==member),admins=(g.admin_ids||[]).filter((x:any)=>x!==member);if(!remaining.length){await db.collection("group_chats").deleteOne({id:gid});await db.collection("group_messages").deleteMany({group_id:gid});return json({success:true,message:"Group deleted (last member left)"},200,request);}const set:any={member_ids:remaining,admin_ids:admins,updated_at:new Date().toISOString()};if(member===g.creator_id){const owner=admins[0]||remaining[0];set.creator_id=owner;if(!admins.includes(owner))set.admin_ids=[...admins,owner];}await db.collection("group_chats").updateOne({id:gid},{$set:set});return json({success:true,message:"Member removed"},200,request);}
      const groupAdmins=url.pathname.match(/^\/api\/messages\/groups\/([^/]+)\/admins(?:\/([^/]+))?$/);
      if(groupAdmins){const gid=decodeURIComponent(groupAdmins[1]),target=groupAdmins[2]?decodeURIComponent(groupAdmins[2]):null,g=await db.collection("group_chats").findOne({id:gid});if(!g)return json({detail:"Group not found"},404,request);if(!g.admin_ids?.includes(uid))return json({detail:"Admin only"},403,request);if(request.method==="POST"&&!target){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const member=String(b?.user_id||"");if(!g.member_ids?.includes(member))return json({detail:"Not a member"},400,request);await db.collection("group_chats").updateOne({id:gid},{$addToSet:{admin_ids:member},$set:{updated_at:new Date().toISOString()}});return json({success:true},200,request);}if(request.method==="DELETE"&&target){if(target===g.creator_id)return json({detail:"Impossible de rétrograder le créateur"},400,request);await db.collection("group_chats").updateOne({id:gid},{$pull:{admin_ids:target},$set:{updated_at:new Date().toISOString()}});return json({success:true},200,request);}}

      const messageStatus=url.pathname.match(/^\/api\/messages\/([^/]+)\/status$/);
      if(messageStatus&&request.method==="PUT"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const id=decodeURIComponent(messageStatus[1]),m=await db.collection("messages").findOne({id});if(!m)return json({detail:"Message not found"},404,request);if(m.recipient_id!==uid)return json({detail:"Not authorized"},403,request);const status=String(b?.status||""),now=new Date().toISOString();if(status==="read"&&user.read_receipts===false){await db.collection("messages").updateOne({id},{$set:{read:true,updated_at:now}});return json({success:true,status:"delivered"},200,request);}const update:any={status,updated_at:now};if(status==="delivered"&&!m.delivered_at)update.delivered_at=now;if(status==="read"){if(!m.read_at)update.read_at=now;update.read=true;if(!m.delivered_at)update.delivered_at=now;}await db.collection("messages").updateOne({id},{$set:update});return json({success:true,status},200,request);}
      const messageReact=url.pathname.match(/^\/api\/messages\/([^/]+)\/react$/);
      if(messageReact){const id=decodeURIComponent(messageReact[1]),m=await db.collection("messages").findOne({id});if(!m)return json({detail:"Message not found"},404,request);if(![m.sender_id,m.recipient_id].includes(uid))return json({detail:"Not authorized"},403,request);let reactions=Array.isArray(m.reactions)?m.reactions:[];if(request.method==="DELETE"){reactions=reactions.filter((r:any)=>r.user_id!==uid);await db.collection("messages").updateOne({id},{$set:{reactions}});return json({success:true,reactions},200,request);}if(request.method==="POST"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const emoji=String(b?.emoji||"");if(!emoji)return json({detail:"Emoji requis"},400,request);const existing=reactions.find((r:any)=>r.user_id===uid),toggled_off=Boolean(existing&&existing.emoji===emoji);reactions=reactions.filter((r:any)=>r.user_id!==uid);if(!toggled_off)reactions.push({user_id:uid,emoji,created_at:new Date().toISOString()});await db.collection("messages").updateOne({id},{$set:{reactions}});if(!toggled_off&&m.sender_id!==uid){const n={id:crypto.randomUUID(),user_id:m.sender_id,type:"reaction",from_user_id:uid,from_username:user.username,from_profile_pic:user.profile_pic||null,comment_content:emoji,read:false,created_at:new Date().toISOString()};await db.collection("notifications").insertOne(n);await realtimeSend(env,m.sender_id,{type:"notification",data:n});}return json({success:true,reactions,toggled_off},200,request);}}
      const deleteMessage=url.pathname.match(/^\/api\/messages\/([^/]+)$/);
      if(deleteMessage&&request.method==="DELETE"){const id=decodeURIComponent(deleteMessage[1]);let b:any={};try{b=await request.json();}catch{}const m=await db.collection("messages").findOne({id});if(!m)return json({detail:"Message not found"},404,request);if(![m.sender_id,m.recipient_id].includes(uid))return json({detail:"Not authorized"},403,request);if(b?.delete_for==="everyone"){if(m.sender_id!==uid)return json({detail:"Not authorized"},403,request);await db.collection("messages").deleteOne({id});return json({success:true,message:"Message deleted for everyone"},200,request);}await db.collection("messages").updateOne({id},{$addToSet:{deleted_by:uid}});return json({success:true,message:"Message deleted for you"},200,request);}

      const dmRoute=url.pathname.match(/^\/api\/messages\/([^/]+)$/);
      if(dmRoute&&request.method==="GET"){const peer=decodeURIComponent(dmRoute[1]),now=new Date().toISOString();await db.collection("messages").deleteMany({expires_at:{$ne:null,$lte:now},$or:[{sender_id:uid,recipient_id:peer},{sender_id:peer,recipient_id:uid}]});const clear=await db.collection("conversation_clears").findOne({user_id:uid,peer_id:peer}),q:any={deleted_by:{$ne:uid},$or:[{sender_id:uid,recipient_id:peer},{sender_id:peer,recipient_id:uid}],$and:[{$or:[{expires_at:null},{expires_at:{$gt:now}}]}]};if(clear?.cleared_at)q.created_at={$gt:clear.cleared_at};const msgs=await db.collection("messages").find(q,{projection:{_id:0}}).sort({created_at:-1}).limit(60).toArray();msgs.reverse();const reveal=user.read_receipts!==false,update:any=reveal?{read:true,status:"read",read_at:now}:{read:true};await db.collection("messages").updateMany({sender_id:peer,recipient_id:uid,read:false},{$set:update});return json(msgs,200,request);}
      if(url.pathname==="/api/messages"&&request.method==="POST"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const recipientId=String(b?.recipient_id||""),recipient=await db.collection("users").findOne({id:recipientId},{projection:{_id:0,password:0}});if(!recipient)return json({detail:"Recipient not found"},404,request);const content=String(b?.content||"").trim();if(!content&&!b?.media_url)return json({detail:"Message vide"},400,request);if(recipient.is_minor&&!user.is_minor){const mutual=await Promise.all([db.collection("follows").findOne({follower_id:uid,followed_id:recipientId,status:"following"}),db.collection("follows").findOne({follower_id:recipientId,followed_id:uid,status:"following"})]);if(!mutual[0]||!mutual[1])return json({detail:"Pour protéger les mineurs, un abonnement mutuel est requis pour envoyer un message à ce compte."},403,request);}const key=[uid,recipientId].sort().join(":"),settings=await db.collection("conversation_settings").findOne({pair_key:key}),ttl=Number(settings?.ephemeral_ttl||0),now=new Date(),msg={id:crypto.randomUUID(),sender_id:uid,sender_username:user.username,sender_profile_pic:user.profile_pic||null,recipient_id:recipientId,recipient_username:recipient.username,content:content.slice(0,10000),media_url:b?.media_url||null,media_type:b?.media_type||null,reply_to_id:b?.reply_to_id||null,expires_at:ttl>0?new Date(now.getTime()+ttl*1000).toISOString():null,read:false,created_at:now.toISOString()};await db.collection("messages").insertOne(msg);await realtimeSend(env,recipientId,{type:"new_message",data:msg});return json(msg,200,request);}
      const markRead=url.pathname.match(/^\/api\/messages\/mark-as-read\/([^/]+)$/);
      if(markRead&&request.method==="PUT"){const peer=decodeURIComponent(markRead[1]),now=new Date().toISOString(),reveal=user.read_receipts!==false,res=await db.collection("messages").updateMany({sender_id:peer,recipient_id:uid,read:false},{$set:reveal?{status:"read",read:true,read_at:now,updated_at:now}:{read:true,updated_at:now}});await db.collection("conversation_prefs").updateOne({user_id:uid,target_id:peer},{$set:{marked_unread:false}},{upsert:true});return json({success:true,marked_count:res.modifiedCount},200,request);}
      const eph=url.pathname.match(/^\/api\/messages\/conversations\/([^/]+)\/ephemeral$/);
      if(eph){const peer=decodeURIComponent(eph[1]),key=[uid,peer].sort().join(":");if(request.method==="GET"){const d=await db.collection("conversation_settings").findOne({pair_key:key});return json({ttl_seconds:Number(d?.ephemeral_ttl||0)},200,request);}if(request.method==="PUT"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const ttl=Number(b?.ttl_seconds||0);if(![0,300,3600,86400].includes(ttl))return json({detail:"Durée non autorisée"},400,request);await db.collection("conversation_settings").updateOne({pair_key:key},{$set:{ephemeral_ttl:ttl,updated_by:uid,updated_at:new Date().toISOString()}},{upsert:true});return json({success:true,ttl_seconds:ttl},200,request);}}
      const pref=url.pathname.match(/^\/api\/messages\/prefs\/([^/]+)$/);
      if(pref&&request.method==="POST"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const update:any={updated_at:new Date().toISOString()};for(const k of ["pinned","muted","marked_unread"])if(k in b)update[k]=Boolean(b[k]);if(Object.keys(update).length===1)return json({detail:"Aucune préférence fournie"},400,request);await db.collection("conversation_prefs").updateOne({user_id:uid,target_id:decodeURIComponent(pref[1])},{$set:update},{upsert:true});const d=await db.collection("conversation_prefs").findOne({user_id:uid,target_id:decodeURIComponent(pref[1])});return json({success:true,pinned:Boolean(d?.pinned),muted:Boolean(d?.muted),marked_unread:Boolean(d?.marked_unread)},200,request);}

      if(url.pathname==="/api/posts/saved"&&request.method==="GET"){const saved=await db.collection("saved_posts").find({user_id:uid},{projection:{_id:0}}).sort({created_at:-1}).limit(200).toArray(),order=saved.map((x:any)=>x.post_id);if(!order.length)return json([],200,request);const posts=await db.collection("posts").find({id:{$in:order}},{projection:{_id:0}}).toArray(),byId=new Map(posts.map((p:any)=>[p.id,p])),likes=await db.collection("likes").find({post_id:{$in:order},user_id:uid},{projection:{_id:0,post_id:1}}).toArray(),liked=new Set(likes.map((x:any)=>x.post_id));return json(order.map((id:any)=>byId.get(id)).filter(Boolean).map((p:any)=>({...p,is_liked:liked.has(p.id),is_saved:true})),200,request);}
      const postAction=url.pathname.match(/^\/api\/posts\/([^/]+)\/(save|repost|vote)$/);
      if(postAction){const postId=decodeURIComponent(postAction[1]),action=postAction[2],original=await db.collection("posts").findOne({id:postId},{projection:{_id:0}});if(!original)return json({detail:"Post not found"},404,request);
        if(action==="save"&&request.method==="POST"){const existing=await db.collection("saved_posts").findOne({post_id:postId,user_id:uid});if(existing){await db.collection("saved_posts").deleteOne({_id:existing._id});return json({saved:false},200,request);}await db.collection("saved_posts").insertOne({id:crypto.randomUUID(),post_id:postId,user_id:uid,created_at:new Date().toISOString()});return json({saved:true},200,request);}
        if(action==="repost"&&request.method==="POST"){if(original.author_id===uid)return json({detail:"Vous ne pouvez pas reposter votre propre publication"},400,request);if(await db.collection("posts").findOne({repost_of:postId,author_id:uid}))return json({detail:"Vous avez déjà reposté cette publication"},400,request);const repost={id:crypto.randomUUID(),author_id:uid,author_username:user.username,author_profile_pic:user.profile_pic||null,author_is_verified:Boolean(user.is_verified),content:original.content||"",media_type:original.media_type||null,media_url:original.media_url||null,likes_count:0,comments_count:0,shares_count:0,repost_of:postId,original_author_username:original.author_username,original_author_id:original.author_id,original_author_profile_pic:original.author_profile_pic||null,original_author_is_verified:Boolean(original.author_is_verified),created_at:new Date().toISOString()};await db.collection("posts").insertOne(repost);await db.collection("posts").updateOne({id:postId},{$inc:{shares_count:1}});await db.collection("notifications").insertOne({id:crypto.randomUUID(),user_id:original.author_id,type:"repost",from_user_id:uid,from_username:user.username,from_profile_pic:user.profile_pic||null,post_id:postId,read:false,created_at:new Date().toISOString()});return json({...repost,is_liked:false,is_reposted:true},200,request);}
        if(action==="repost"&&request.method==="DELETE"){const existing=await db.collection("posts").findOne({repost_of:postId,author_id:uid});if(!existing)return json({detail:"Vous n'avez pas reposté cette publication"},404,request);await db.collection("posts").deleteOne({id:existing.id});await db.collection("posts").updateOne({id:postId,shares_count:{$gt:0}},{$inc:{shares_count:-1}});await db.collection("notifications").deleteMany({type:"repost",post_id:postId,from_user_id:uid});const updated=await db.collection("posts").findOne({id:postId},{projection:{_id:0,shares_count:1}});return json({reposted:false,shares_count:Number(updated?.shares_count||0)},200,request);}
        if(action==="vote"&&request.method==="POST"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const optionId=String(b?.option_id||""),poll:any=original.poll;if(!poll)return json({detail:"Ce post ne contient pas de sondage"},400,request);const options=Array.isArray(poll.options)?poll.options.map((o:any)=>({...o})):[];if(!options.some((o:any)=>String(o.id)===optionId))return json({detail:"Option invalide"},400,request);const voters={...(poll.voters||{})},previous=voters[uid];if(previous!==optionId){for(const o of options){if(previous&&String(o.id)===String(previous))o.votes=Math.max(0,Number(o.votes||0)-1);if(String(o.id)===optionId)o.votes=Number(o.votes||0)+1;}voters[uid]=optionId;const updated={options,total_votes:Number(poll.total_votes||0)+(previous?0:1),voters};await db.collection("posts").updateOne({id:postId},{$set:{poll:updated}});original.poll=updated;}const liked=await db.collection("likes").findOne({post_id:postId,user_id:uid});return json({...original,is_liked:Boolean(liked),poll_user_vote:optionId},200,request);}
      }

      const postRoute=url.pathname.match(/^\/api\/posts\/([^/]+)(?:\/(like|comments))?$/);
      if(postRoute){
        let postId=decodeURIComponent(postRoute[1]),action=postRoute[2]||"post";
        const requestedPostId=postId;
        const raw=await db.collection("posts").findOne({id:postId},{projection:{_id:0}});
        if(!raw)return json({detail:"Post not found"},404,request);
        if(action==="post"&&request.method==="DELETE"){if(raw.author_id!==uid)return json({detail:"Not authorized"},403,request);await Promise.all([db.collection("posts").deleteOne({id:requestedPostId}),db.collection("likes").deleteMany({post_id:requestedPostId}),db.collection("comments").deleteMany({post_id:requestedPostId})]);if(raw.repost_of)await db.collection("posts").updateOne({id:raw.repost_of,shares_count:{$gt:0}},{$inc:{shares_count:-1}});return json({message:"Post deleted successfully"},200,request);}
        if(raw.repost_of){const orig=await db.collection("posts").findOne({id:raw.repost_of},{projection:{_id:0}});if(orig){postId=String(raw.repost_of);Object.assign(raw,orig);}}
        if(action==="post"&&request.method==="GET"){const liked=await db.collection("likes").findOne({post_id:postId,user_id:uid});return json({...raw,is_liked:Boolean(liked)},200,request);}
        if(action==="like"&&request.method==="POST"){const existing=await db.collection("likes").findOne({post_id:postId,user_id:uid});if(existing){await db.collection("likes").deleteOne({_id:existing._id});await db.collection("posts").updateOne({id:postId,likes_count:{$gt:0}},{$inc:{likes_count:-1}});return json({liked:false},200,request);}await db.collection("likes").insertOne({id:crypto.randomUUID(),post_id:postId,user_id:uid,created_at:new Date().toISOString()});await db.collection("posts").updateOne({id:postId},{$inc:{likes_count:1}});if(raw.author_id!==uid){const n={id:crypto.randomUUID(),user_id:raw.author_id,type:"like",from_user_id:uid,from_username:user.username,from_profile_pic:user.profile_pic||null,post_id:postId,read:false,created_at:new Date().toISOString()};await db.collection("notifications").insertOne(n);await realtimeSend(env,raw.author_id,{type:"notification",data:n});}return json({liked:true},200,request);}
        if(action==="comments"&&request.method==="GET"){const comments=await db.collection("comments").find({post_id:postId},{projection:{_id:0}}).sort({created_at:-1}).limit(100).toArray(),ids=comments.map((x:any)=>x.id),likes=ids.length?await db.collection("comment_likes").find({comment_id:{$in:ids},user_id:uid},{projection:{_id:0,comment_id:1}}).toArray():[],liked=new Set(likes.map((x:any)=>x.comment_id));return json(comments.map((x:any)=>({...x,is_liked:liked.has(x.id)})),200,request);}
        if(action==="comments"&&request.method==="POST"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const content=String(b?.content||"").trim();if(!content)return json({detail:"Comment content is required"},400,request);const comment={id:crypto.randomUUID(),post_id:postId,author_id:uid,author_username:user.username,author_profile_pic:user.profile_pic||null,author_is_verified:Boolean(user.is_verified),content,created_at:new Date().toISOString()};await db.collection("comments").insertOne(comment);await db.collection("posts").updateOne({id:postId},{$inc:{comments_count:1}});if(raw.author_id!==uid){const n={id:crypto.randomUUID(),user_id:raw.author_id,type:"comment",from_user_id:uid,from_username:user.username,from_profile_pic:user.profile_pic||null,post_id:postId,comment_content:content,read:false,created_at:new Date().toISOString()};await db.collection("notifications").insertOne(n);await realtimeSend(env,raw.author_id,{type:"notification",data:n});}return json(comment,200,request);}
      }
      const commentRoute=url.pathname.match(/^\/api\/posts\/([^/]+)\/comments\/([^/]+)$/);
      if(commentRoute&&request.method==="DELETE"){const postId=decodeURIComponent(commentRoute[1]),commentId=decodeURIComponent(commentRoute[2]),comment=await db.collection("comments").findOne({id:commentId,post_id:postId});if(!comment)return json({detail:"Comment not found"},404,request);if(comment.author_id!==uid)return json({detail:"Not authorized"},403,request);await Promise.all([db.collection("comments").deleteOne({id:commentId}),db.collection("comment_replies").deleteMany({parent_comment_id:commentId}),db.collection("comment_likes").deleteMany({comment_id:commentId})]);await db.collection("posts").updateOne({id:postId,comments_count:{$gt:0}},{$inc:{comments_count:-1}});return json({message:"Comment deleted successfully"},200,request);}
      const commentLike=url.pathname.match(/^\/api\/comments\/([^/]+)\/like$/);
      if(commentLike&&request.method==="POST"){const commentId=decodeURIComponent(commentLike[1]),comment=await db.collection("comments").findOne({id:commentId});if(!comment)return json({detail:"Comment not found"},404,request);const existing=await db.collection("comment_likes").findOne({comment_id:commentId,user_id:uid});if(existing){await db.collection("comment_likes").deleteOne({_id:existing._id});return json({liked:false},200,request);}await db.collection("comment_likes").insertOne({id:crypto.randomUUID(),comment_id:commentId,user_id:uid,created_at:new Date().toISOString()});return json({liked:true},200,request);}

      if (url.pathname === "/api/feed/following" && request.method === "GET") {
        const skip=Math.max(0,Number(url.searchParams.get("skip")||0)),limit=Math.max(1,Math.min(30,Number(url.searchParams.get("limit")||10)));
        const follows=await db.collection("follows").find({follower_id:uid,status:"following"},{projection:{_id:0,followed_id:1,following_id:1}}).toArray(),authorIds=[uid,...follows.map((x:any)=>x.followed_id||x.following_id).filter(Boolean)];
        const query:any={author_id:{$in:authorIds}};if(user.hide_political===true)query.is_political={$ne:true};
        const posts=await db.collection("posts").find(query,{projection:{_id:0}}).sort({created_at:-1}).skip(skip).limit(limit).toArray(),ids=posts.map((p:any)=>p.id).filter(Boolean);
        const [liked,saved]=ids.length?await Promise.all([db.collection("likes").find({user_id:uid,post_id:{$in:ids}},{projection:{_id:0,post_id:1}}).toArray(),db.collection("saved_posts").find({user_id:uid,post_id:{$in:ids}},{projection:{_id:0,post_id:1}}).toArray()]):[[],[]],ls=new Set(liked.map((x:any)=>x.post_id)),ss=new Set(saved.map((x:any)=>x.post_id));
        return json(posts.map((p:any)=>({...p,is_liked:ls.has(p.id),is_saved:ss.has(p.id)})),200,request);
      }
      if (url.pathname === "/api/feed/foryou" && request.method === "GET") {
        const skip=Math.max(0,Number(url.searchParams.get("skip")||0)),limit=Math.max(1,Math.min(30,Number(url.searchParams.get("limit")||10)));
        const query:any={}; if(user.hide_political===true)query.is_political={$ne:true};
        const posts=await db.collection("posts").find(query,{projection:{_id:0}}).sort({created_at:-1}).skip(skip).limit(limit).toArray();
        const ids=posts.map((p:any)=>p.id).filter(Boolean);
        const [liked,saved]=ids.length?await Promise.all([db.collection("likes").find({user_id:uid,post_id:{$in:ids}},{projection:{_id:0,post_id:1}}).toArray(),db.collection("saved_posts").find({user_id:uid,post_id:{$in:ids}},{projection:{_id:0,post_id:1}}).toArray()]):[[],[]];
        const ls=new Set(liked.map((x:any)=>x.post_id)),ss=new Set(saved.map((x:any)=>x.post_id));
        return json(posts.map((p:any)=>({...p,is_liked:ls.has(p.id),is_saved:ss.has(p.id)})),200,request);
      }
      if (url.pathname === "/api/posts" && request.method === "POST") {
        let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const content=String(b?.content||"").trim(),mediaType=b?.media_type||null,mediaUrl=b?.media_url||null;if(!content&&!mediaUrl)return json({detail:"Post vide"},400,request);if(content.length>10000)return json({detail:"Post trop long"},400,request);
        const safeLink=typeof b?.affiliate_link==="string"&&/^https?:\/\//i.test(b.affiliate_link)?b.affiliate_link:null,mentioned=[...new Set([...content.matchAll(/@([A-Za-z0-9_.-]{1,40})/g)].map((m:any)=>m[1]))],mentionedUsers=mentioned.length?await db.collection("users").find({username:{$in:mentioned}},{projection:{_id:0,id:1}}).toArray():[],mentionedIds=mentionedUsers.map((x:any)=>x.id).filter((x:any)=>x!==uid),opts=Array.isArray(b?.poll_options)?b.poll_options.map((x:any)=>String(x||"").trim()).filter(Boolean).slice(0,6):[],poll=opts.length>=2?{options:opts.map((text:string)=>({id:crypto.randomUUID(),text,votes:0})),total_votes:0,voters:{}}:null,id=crypto.randomUUID(),now=new Date().toISOString();
        const post:any={id,author_id:uid,author_username:user.username,author_profile_pic:user.profile_pic||null,author_is_verified:Boolean(user.is_verified),content,media_type:mediaType,media_url:mediaUrl,likes_count:0,comments_count:0,shares_count:0,poll,affiliate_link:safeLink,affiliate_clicks:0,mentioned_user_ids:mentionedIds,created_at:now};await db.collection("posts").insertOne(post);for(const target of mentionedIds)await db.collection("notifications").insertOne({id:crypto.randomUUID(),user_id:target,type:"mention",from_user_id:uid,from_username:user.username,from_profile_pic:user.profile_pic||null,post_id:id,read:false,created_at:now});return json({...post,is_liked:false,poll_user_vote:null},200,request);
      }
      const affiliateClick=url.pathname.match(/^\/api\/posts\/([^/]+)\/affiliate-click$/);if(affiliateClick&&request.method==="POST"){const r=await db.collection("posts").updateOne({id:decodeURIComponent(affiliateClick[1]),affiliate_link:{$ne:null}},{$inc:{affiliate_clicks:1}});return r.matchedCount?json({success:true},200,request):json({detail:"Lien affilié introuvable"},404,request);}
      if (url.pathname === "/api/notifications" && request.method === "GET") {const skip=Math.max(0,Number(url.searchParams.get("skip")||0)),limit=Math.max(1,Math.min(50,Number(url.searchParams.get("limit")||30)));return json(await db.collection("notifications").find({user_id:uid},{projection:{_id:0}}).sort({created_at:-1}).skip(skip).limit(limit).toArray(),200,request);}
      if (url.pathname === "/api/notifications/read-all" && request.method === "PUT") {await db.collection("notifications").updateMany({user_id:uid,read:false},{$set:{read:true}});return json({success:true},200,request);}
      if (url.pathname === "/api/notifications" && request.method === "DELETE") {await db.collection("notifications").deleteMany({user_id:uid});return json({success:true},200,request);}
      const notifRoute=url.pathname.match(/^\/api\/notifications\/([^/]+)$/);if(notifRoute&&request.method==="DELETE"){const r=await db.collection("notifications").deleteOne({id:decodeURIComponent(notifRoute[1]),user_id:uid});return r.deletedCount?json({success:true},200,request):json({detail:"Notification not found"},404,request);}
      const notifRead=url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);if(notifRead&&request.method==="PUT"){const r=await db.collection("notifications").updateOne({id:decodeURIComponent(notifRead[1]),user_id:uid},{$set:{read:true}});return r.matchedCount?json({message:"Notification marked as read"},200,request):json({detail:"Notification not found"},404,request);}
      const notifTypes=["like","comment","follow","follow_request","mention","repost","message"];
      if (url.pathname === "/api/notifications/settings" && request.method === "GET") {const p=await db.collection("notification_prefs").findOne({user_id:uid},{projection:{_id:0}});return json({types:notifTypes,disabled_types:p?.disabled_types||[],muted_accounts:p?.muted_accounts||[]},200,request);}
      if (url.pathname === "/api/notifications/settings" && request.method === "PUT") {let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const disabled=Array.isArray(b?.disabled_types)?b.disabled_types.filter((x:any)=>notifTypes.includes(String(x))):[];await db.collection("notification_prefs").updateOne({user_id:uid},{$set:{disabled_types:disabled}},{upsert:true});return json({success:true},200,request);}
      if (url.pathname === "/api/notifications/preferences" && request.method === "GET") {const p:any=user.notif_prefs||{},out:any={};for(const t of notifTypes)out[t]=p[t]!==false;return json(out,200,request);}
      if (url.pathname === "/api/notifications/preferences" && request.method === "PUT") {let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const src=b?.prefs||{},clean:any={};for(const t of notifTypes)if(t in src)clean[t]=Boolean(src[t]);await db.collection("users").updateOne({id:uid},{$set:{notif_prefs:clean}});return json({success:true,prefs:clean},200,request);}
      const muteNotif=url.pathname.match(/^\/api\/notifications\/mute\/([^/]+)$/);if(muteNotif&&request.method==="POST"){const target=decodeURIComponent(muteNotif[1]),p=await db.collection("notification_prefs").findOne({user_id:uid}),muted=new Set<string>(p?.muted_accounts||[]);let state;if(muted.has(target)){muted.delete(target);state=false;}else{muted.add(target);state=true;}await db.collection("notification_prefs").updateOne({user_id:uid},{$set:{muted_accounts:[...muted]}},{upsert:true});return json({success:true,muted:state},200,request);}
      if (url.pathname === "/api/push/vapid-public-key" && request.method === "GET") return json({public_key:"",enabled:false},200,request);
      if (url.pathname === "/api/push/subscribe" && request.method === "POST") {let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const sub=b?.subscription||b,endpoint=String(sub?.endpoint||"");if(!endpoint)return json({detail:"Abonnement invalide"},400,request);await db.collection("push_subscriptions").updateOne({endpoint},{$set:{user_id:uid,subscription:sub,endpoint,updated_at:new Date().toISOString()}},{upsert:true});return json({success:true},200,request);}
      if (url.pathname === "/api/push/unsubscribe" && request.method === "POST") {let b:any={};try{b=await request.json();}catch{}const endpoint=String((b?.subscription||b)?.endpoint||"");if(endpoint)await db.collection("push_subscriptions").deleteOne({endpoint,user_id:uid});return json({success:true},200,request);}
      if (url.pathname === "/api/users/me/settings" && request.method === "GET") {const profile=publicUser(user as Record<string,any>),privacy={is_private:Boolean(user.is_private),hide_political:Boolean(user.hide_political),privacy_strict:Boolean(user.privacy_strict)};return json({profile,privacy,time_limit_enabled:Boolean(user.time_limit_enabled),is_premium:Boolean(user.is_premium)},200,request);}
      if (url.pathname === "/api/users/me/stats" && request.method === "GET") {const [posts,followers,following]=await Promise.all([db.collection("posts").countDocuments({author_id:uid}),db.collection("follows").countDocuments({followed_id:uid,status:"following"}),db.collection("follows").countDocuments({follower_id:uid,status:"following"})]);return json({posts_count:posts,followers_count:followers,following_count:following},200,request);}
      if (url.pathname === "/api/users/me/sport-alerts" && request.method === "GET") {const a:any=user.sport_alerts||{};return json({goals:a.goals!==false,match:Boolean(a.match),mma:a.mma!==false},200,request);}
      if (url.pathname === "/api/users/me/sport-alerts" && request.method === "PUT") {let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const allowed=["goals","match","mma"],set:any={};for(const k of allowed)if(k in b)set["sport_alerts."+k]=Boolean(b[k]);if(Object.keys(set).length)await db.collection("users").updateOne({id:uid},{$set:set});return json({success:true},200,request);}
      if (url.pathname === "/api/billing/connect/status" && request.method === "GET") return json({enabled:false,connected:false,charges_enabled:false},200,request);
      if (url.pathname === "/api/billing/paypal/status" && request.method === "GET") return json({enabled:false,connected:false,receivable:false},200,request);
      if (url.pathname === "/api/users/me/widget-stack" && request.method === "GET") {const cfg:any=user.widget_stack_config||{},valid=["trends","screentime","weather","finance","football","mma","wwe","profile_views","ai_analytics","astro_lifestyle"];return json({smart_rotate:cfg.smart_rotate!==false,order:Array.isArray(cfg.order)?cfg.order.filter((x:any)=>valid.includes(x)):valid,finance_assets:Array.isArray(cfg.finance_assets)?cfg.finance_assets:["bitcoin","ethereum","solana"],weather_city:cfg.weather_city||null},200,request);}
      if (url.pathname === "/api/users/me/widget-stack" && request.method === "PUT") {let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const valid=["trends","screentime","weather","finance","football","mma","wwe","profile_views","ai_analytics","astro_lifestyle"],cfg:any={...(user.widget_stack_config||{})};if("smart_rotate" in b)cfg.smart_rotate=Boolean(b.smart_rotate);if(Array.isArray(b.order))cfg.order=[...new Set(b.order.map(String).filter((x:string)=>valid.includes(x)))];if(Array.isArray(b.finance_assets))cfg.finance_assets=[...new Set(b.finance_assets.map(String))].slice(0,10);if(b.weather_city===null)cfg.weather_city=null;else if(b.weather_city&&Number.isFinite(Number(b.weather_city.lat))&&Number.isFinite(Number(b.weather_city.lon)))cfg.weather_city={name:String(b.weather_city.name||"").slice(0,80),lat:Number(b.weather_city.lat),lon:Number(b.weather_city.lon)};await db.collection("users").updateOne({id:uid},{$set:{widget_stack_config:cfg}});return json({success:true,...cfg},200,request);}
      if (url.pathname === "/api/instants/inbox" && request.method === "GET") {const now=new Date().toISOString(),seen=await db.collection("instant_views").find({user_id:uid},{projection:{_id:0,instant_id:1}}).toArray(),seenIds=new Set(seen.map((x:any)=>x.instant_id)),rows=await db.collection("instants").find({recipient_ids:uid,canceled:{$ne:true},expires_at:{$gt:now}},{projection:{_id:0}}).sort({created_at:-1}).limit(500).toArray();return json(rows.filter((x:any)=>!seenIds.has(x.id)).map((x:any)=>({id:x.id,author_id:x.author_id,author_username:x.author_username,author_avatar:x.author_avatar||null,created_at:x.created_at})),200,request);}
      if (url.pathname === "/api/instants/archive" && request.method === "GET") {const now=new Date().toISOString(),rows=await db.collection("instants").find({author_id:uid,archive_expires_at:{$gt:now}},{projection:{_id:0}}).sort({created_at:-1}).limit(500).toArray(),ids=rows.map((x:any)=>x.id),views=ids.length?await db.collection("instant_views").find({instant_id:{$in:ids}},{projection:{_id:0}}).toArray():[],by=new Map<string,any[]>();for(const v of views){const a=by.get(v.instant_id)||[];a.push(v);by.set(v.instant_id,a);}return json(rows.map((x:any)=>{const vs=by.get(x.id)||[];return{id:x.id,media_url:x.media_url,caption:x.caption||"",audience:x.audience,created_at:x.created_at,expires_at:x.expires_at,canceled:Boolean(x.canceled),recipients:(x.recipient_ids||[]).length,seen:vs.length,reactions:vs.filter((v:any)=>v.reaction).map((v:any)=>({user_id:v.user_id,emoji:v.reaction})),active:!x.canceled&&x.expires_at>now};}),200,request);}
      if (url.pathname === "/api/instants/close-friends" && request.method === "GET") {const ids=user.close_friends||[];if(!ids.length)return json([],200,request);return json(await db.collection("users").find({id:{$in:ids}},{projection:{_id:0,id:1,username:1,profile_pic:1}}).toArray(),200,request);}
      if (url.pathname === "/api/instants/close-friends" && request.method === "PUT") {let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const ids=[...new Set((Array.isArray(b?.ids)?b.ids:[]).map(String).filter((x:string)=>x&&x!==uid))].slice(0,500);await db.collection("users").updateOne({id:uid},{$set:{close_friends:ids}});return json({success:true,count:ids.length},200,request);}
      if (url.pathname === "/api/instants" && request.method === "POST") {let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const media=String(b?.media||"").trim();if(!(media.startsWith("data:image")||media.startsWith("data:video")))return json({detail:"Média invalide (photo ou vidéo prise en direct)."},400,request);if(media.length>12000000)return json({detail:"Média trop lourd."},413,request);const audience=["close_friends","mutuals","manual"].includes(b?.audience)?b.audience:"mutuals";let recipients:string[]=[];if(audience==="manual")recipients=(b.recipient_ids||[]).map(String).filter((x:string)=>x&&x!==uid);else if(audience==="close_friends")recipients=(user.close_friends||[]).filter((x:string)=>x!==uid);else{const mine=await db.collection("follows").find({follower_id:uid,status:"following"},{projection:{_id:0,followed_id:1}}).toArray(),incoming=await db.collection("follows").find({followed_id:uid,status:"following"},{projection:{_id:0,follower_id:1}}).toArray(),inc=new Set(incoming.map((x:any)=>x.follower_id));recipients=mine.map((x:any)=>x.followed_id).filter((x:string)=>inc.has(x));}recipients=[...new Set(recipients)];if(recipients.length){const valid=await db.collection("users").find({id:{$in:recipients}},{projection:{_id:0,id:1}}).toArray(),ok=new Set(valid.map((x:any)=>x.id));recipients=recipients.filter(x=>ok.has(x));}const now=new Date(),id=crypto.randomUUID(),doc:any={id,author_id:uid,author_username:user.username,author_avatar:user.profile_pic||null,media_url:media,caption:String(b?.caption||"").trim().slice(0,280),audience,recipient_ids:recipients,created_at:now.toISOString(),expires_at:new Date(now.getTime()+86400000).toISOString(),archive_expires_at:new Date(now.getTime()+365*86400000).toISOString(),canceled:false};await db.collection("instants").insertOne(doc);for(const rid of recipients)await db.collection("notifications").insertOne({id:crypto.randomUUID(),user_id:rid,type:"instant",from_user_id:uid,from_username:user.username,from_profile_pic:user.profile_pic||null,read:false,created_at:now.toISOString()});return json({success:true,instant:{id,caption:doc.caption,audience,created_at:doc.created_at,expires_at:doc.expires_at},recipients:recipients.length},200,request);}
      const instantView=url.pathname.match(/^\/api\/instants\/([^/]+)\/view$/);if(instantView&&request.method==="POST"){const id=decodeURIComponent(instantView[1]),d=await db.collection("instants").findOne({id},{projection:{_id:0}}),now=new Date().toISOString();if(!d)return json({detail:"Instantané introuvable."},404,request);if(!(d.recipient_ids||[]).includes(uid))return json({detail:"Non autorisé."},403,request);if(d.canceled||d.expires_at<=now)return json({detail:"Cet instantané a disparu."},410,request);if(await db.collection("instant_views").findOne({instant_id:id,user_id:uid}))return json({detail:"Déjà vu — un instantané n'est visible qu'une fois."},410,request);await db.collection("instant_views").insertOne({id:crypto.randomUUID(),instant_id:id,user_id:uid,viewed_at:now,reaction:null});return json({id:d.id,media_url:d.media_url,caption:d.caption||"",author_id:d.author_id,author_username:d.author_username,author_avatar:d.author_avatar||null,created_at:d.created_at},200,request);}
      const instantReact=url.pathname.match(/^\/api\/instants\/([^/]+)\/react$/);if(instantReact&&request.method==="POST"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const id=decodeURIComponent(instantReact[1]),emoji=String(b?.emoji||"").trim().slice(0,8);if(!emoji)return json({detail:"Emoji requis."},400,request);const v=await db.collection("instant_views").findOne({instant_id:id,user_id:uid});if(!v)return json({detail:"Vous devez d'abord voir l'instantané."},403,request);await db.collection("instant_views").updateOne({instant_id:id,user_id:uid},{$set:{reaction:emoji,reacted_at:new Date().toISOString()}});const d=await db.collection("instants").findOne({id},{projection:{_id:0,author_id:1}});if(d)await db.collection("notifications").insertOne({id:crypto.randomUUID(),user_id:d.author_id,type:"instant_reaction",from_user_id:uid,from_username:user.username,read:false,created_at:new Date().toISOString()});return json({success:true,emoji},200,request);}
      const instantReply=url.pathname.match(/^\/api\/instants\/([^/]+)\/reply$/);if(instantReply&&request.method==="POST"){let b:any;try{b=await request.json();}catch{return json({detail:"Invalid JSON"},400,request);}const content=String(b?.content||"").trim(),id=decodeURIComponent(instantReply[1]);if(!content)return json({detail:"Message vide."},400,request);const d=await db.collection("instants").findOne({id},{projection:{_id:0}});if(!d)return json({detail:"Instantané introuvable."},404,request);if(!(d.recipient_ids||[]).includes(uid))return json({detail:"Non autorisé."},403,request);const author=await db.collection("users").findOne({id:d.author_id},{projection:{_id:0,username:1}}),now=new Date().toISOString();await db.collection("messages").insertOne({id:crypto.randomUUID(),sender_id:uid,sender_username:user.username,sender_profile_pic:user.profile_pic||null,recipient_id:d.author_id,recipient_username:author?.username||"",content,media_url:null,media_type:null,reply_to_id:null,instant_id:id,expires_at:null,read:false,created_at:now});return json({success:true},200,request);}
      const instantDelete=url.pathname.match(/^\/api\/instants\/([^/]+)$/);if(instantDelete&&request.method==="DELETE"){const id=decodeURIComponent(instantDelete[1]),r=await db.collection("instants").updateOne({id,author_id:uid},{$set:{canceled:true}});return r.matchedCount?json({success:true},200,request):json({detail:"Instantané introuvable."},404,request);}
      if (url.pathname === "/api/clips" && request.method === "GET") {const skip=Math.max(0,Number(url.searchParams.get("skip")||0)),limit=Math.max(1,Math.min(40,Number(url.searchParams.get("limit")||20))),q:any={media_type:"video",media_url:{$ne:null},repost_of:null,is_draft:{$ne:true}};if(user.hide_political===true)q.is_political={$ne:true};const rows=await db.collection("posts").find(q,{projection:{_id:0}}).sort({created_at:-1}).skip(skip).limit(limit).toArray(),ids=rows.map((x:any)=>x.id),[liked,saved]=ids.length?await Promise.all([db.collection("likes").find({user_id:uid,post_id:{$in:ids}},{projection:{_id:0,post_id:1}}).toArray(),db.collection("saved_posts").find({user_id:uid,post_id:{$in:ids}},{projection:{_id:0,post_id:1}}).toArray()]):[[],[]],ls=new Set(liked.map((x:any)=>x.post_id)),ss=new Set(saved.map((x:any)=>x.post_id));return json(rows.map((p:any)=>({...p,is_liked:ls.has(p.id),is_saved:ss.has(p.id)})),200,request);}
      const clipView=url.pathname.match(/^\/api\/clips\/([^/]+)\/view$/);if(clipView&&request.method==="POST"){let id=decodeURIComponent(clipView[1]),p=await db.collection("posts").findOne({id},{projection:{_id:0,id:1,repost_of:1,views:1}});if(!p)return json({detail:"Clip introuvable"},404,request);if(p.repost_of){id=p.repost_of;p=await db.collection("posts").findOne({id},{projection:{_id:0,id:1,views:1}});if(!p)return json({detail:"Clip introuvable"},404,request);}const existing=await db.collection("clip_views").findOne({clip_id:id,user_id:uid});if(existing)return json({success:true,views:Number(p.views||0),counted:false},200,request);try{await db.collection("clip_views").insertOne({clip_id:id,user_id:uid,created_at:new Date().toISOString()});await db.collection("posts").updateOne({id},{$inc:{views:1}});}catch{return json({success:true,views:Number(p.views||0),counted:false},200,request);}const updated=await db.collection("posts").findOne({id},{projection:{_id:0,views:1}});return json({success:true,views:Number(updated?.views||0),counted:true},200,request);}
      const clipWatch=url.pathname.match(/^\/api\/clips\/([^/]+)\/watch$/);if(clipWatch&&request.method==="POST"){let b:any={};try{b=await request.json();}catch{}let id=decodeURIComponent(clipWatch[1]),p=await db.collection("posts").findOne({id},{projection:{_id:0,repost_of:1}});if(p?.repost_of)id=p.repost_of;const watched=Math.max(0,Math.min(600000,Math.floor(Number(b?.watched_ms||0)))),duration=Math.max(0,Math.floor(Number(b?.duration_ms||0)));if(watched<300)return json({success:true,counted:false},200,request);const completion=duration>0?Math.min(1,watched/duration):(b?.completed?1:0);await db.collection("clip_watch_events").insertOne({id:crypto.randomUUID(),clip_id:id,user_id:uid,watched_ms:watched,duration_ms:duration,completion,completed:Boolean(b?.completed),created_at:new Date().toISOString()});await db.collection("posts").updateOne({id},{$inc:{watch_ms_total:watched,watch_sessions:1,completion_total:completion}});return json({success:true,counted:true},200,request);}
      if (url.pathname === "/api/badges" && request.method === "GET") {
        const [messages,notifications,instants]=await Promise.all([db.collection("messages").countDocuments({recipient_id:uid,read:false}),db.collection("notifications").countDocuments({user_id:uid,read:false}),db.collection("instants").countDocuments({recipient_ids:uid,canceled:{$ne:true},expires_at:{$gt:new Date().toISOString()}})]);
        return json({messages,notifications,instants},200,request);
      }
      if (url.pathname === "/api/live/active" && request.method === "GET") {
        const f=await db.collection("follows").find({follower_id:uid},{projection:{_id:0,followed_id:1}}).toArray(),allowed=[uid,...f.map((x:any)=>x.followed_id)],cutoff=new Date(Date.now()-12*3600000).toISOString();
        return json(await db.collection("live_sessions").find({active:true,host_id:{$in:allowed},started_at:{$gte:cutoff}},{projection:{_id:0}}).toArray(),200,request);
      }

      if (url.pathname === "/health/mongodb") {
        await client.db("admin").command({ ping: 1 });
        const collections = await db.listCollections({}, { nameOnly: true }).toArray();
        return json({ status: "ok", connected: true, database: dbName, collection_count: collections.length });
      }

      if (url.pathname.startsWith("/internal/")) return json({detail:"Not found"},404,request);\n\n      if (url.pathname === "/internal/auth/verify" && request.method === "POST") {
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

      if (url.pathname === "/internal/users/profile" && request.method === "POST") {
        let b:any; try { b = await request.json(); } catch { return json({detail:"Invalid JSON"},400); }
        const userId=String(b?.user_id||"").trim(), viewerId=String(b?.viewer_id||"").trim();
        const user=await db.collection("users").findOne({id:userId},{projection:{_id:0,password:0}});
        if(!user)return json({detail:"User not found"},404);
        if(viewerId && viewerId!==userId) {
          await db.collection("profile_views").insertOne({profile_id:userId,viewer_id:viewerId,ts:new Date().toISOString()}).catch(()=>undefined);
        }
        return json(publicUser(user as Record<string,any>));
      }

      if (url.pathname === "/internal/users/stats" && request.method === "POST") {
        let b:any; try { b = await request.json(); } catch { return json({detail:"Invalid JSON"},400); }
        const userId=String(b?.user_id||"").trim();
        const user=await db.collection("users").findOne({id:userId},{projection:{_id:0,id:1}});
        if(!user)return json({detail:"User not found"},404);
        const [followers,following,posts]=await Promise.all([
          db.collection("follows").countDocuments({followed_id:userId}),
          db.collection("follows").countDocuments({follower_id:userId}),
          db.collection("posts").countDocuments({author_id:userId})
        ]);
        return json({followers,following,posts});
      }

      if (url.pathname === "/internal/users/posts" && request.method === "POST") {
        let b:any; try { b = await request.json(); } catch { return json({detail:"Invalid JSON"},400); }
        const userId=String(b?.user_id||"").trim(), viewerId=String(b?.viewer_id||"").trim();
        const user=await db.collection("users").findOne({id:userId},{projection:{_id:0,is_private:1}});
        if(!user)return json({detail:"User not found"},404);
        if(user.is_private && viewerId!==userId) {
          const follow=await db.collection("follows").findOne({follower_id:viewerId,followed_id:userId,status:"following"});
          if(!follow)return json({detail:"Private profile"},403);
        }
        const posts=await db.collection("posts").find({author_id:userId},{projection:{_id:0}}).sort({created_at:-1}).limit(200).toArray();
        const ids=posts.map((p:any)=>p.id).filter(Boolean);
        const [liked,saved]=ids.length ? await Promise.all([
          db.collection("likes").find({user_id:viewerId,post_id:{$in:ids}},{projection:{_id:0,post_id:1}}).toArray(),
          db.collection("saved_posts").find({user_id:viewerId,post_id:{$in:ids}},{projection:{_id:0,post_id:1}}).toArray()
        ]) : [[],[]];
        const ls=new Set(liked.map((x:any)=>x.post_id)), ss=new Set(saved.map((x:any)=>x.post_id));
        return json(posts.map((p:any)=>({...p,is_liked:ls.has(p.id),is_saved:ss.has(p.id)})));
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
