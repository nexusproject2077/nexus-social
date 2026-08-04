import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API } from "../App";
import Layout from "../components/Layout";

const C = {
  bg: "#0b1326", surface: "#171f33", high: "#222a3d",
  cyan: (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee",
  onSurface: "#dae2fd", outline: "#859397",
};

const TABS = [
  { key: "top", label: "Top" },
  { key: "videos", label: "Vidéos" },
  { key: "users", label: "Comptes" },
  { key: "posts", label: "Posts" },
  { key: "hashtags", label: "Hashtags" },
  { key: "live", label: "LIVE" },
];

const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : n || 0);

/**
 * Recherche dédiée à Nexus Clips (distincte de /search) : barre avec
 * autocomplétion temps réel, onglets horizontaux (façon TikTok), résultats en
 * direct pendant la frappe, scroll infini, hashtags propres aux Clips.
 */
export default function ClipsSearchPage({ user, setUser }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [tab, setTab] = useState("top");
  const [data, setData] = useState({ videos: [], users: [], hashtags: [], posts: [], lives: [] });
  const [loading, setLoading] = useState(false);
  const [suggests, setSuggests] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const debounceRef = useRef(null);
  const sentinelRef = useRef(null);
  const inputRef = useRef(null);

  // Recherche principale (debounce 250 ms) — relancée à chaque frappe / onglet.
  const runSearch = useCallback(async (query, type, reset = true) => {
    if (!query.trim()) { setData({ videos: [], users: [], hashtags: [], posts: [], lives: [] }); return; }
    setLoading(true);
    try {
      const sk = reset ? 0 : page * 20;
      const res = await axios.get(`${API}/clips/search`, { params: { q: query, type, skip: sk, limit: 20 } });
      const d = res.data || {};
      if (reset) {
        setData({ videos: d.videos || [], users: d.users || [], hashtags: d.hashtags || [], posts: d.posts || [], lives: d.lives || [] });
        setPage(1);
        setHasMore((d.videos?.length || d.users?.length || d.posts?.length || 0) >= 20);
      } else {
        setData((prev) => ({
          ...prev,
          videos: [...prev.videos, ...(d.videos || [])],
          users: [...prev.users, ...(d.users || [])],
          posts: [...prev.posts, ...(d.posts || [])],
        }));
        setPage((p) => p + 1);
        const got = (d.videos?.length || 0) + (d.users?.length || 0) + (d.posts?.length || 0);
        setHasMore(got >= 20);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [page]);

  // Frappe → suggestions + recherche, tout en debounce.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (q.trim()) {
        try {
          const s = await axios.get(`${API}/clips/search/suggest`, { params: { q } });
          setSuggests(s.data?.suggestions || []);
        } catch { setSuggests([]); }
        runSearch(q, tab, true);
        setParams({ q }, { replace: true });
      } else {
        setSuggests([]);
        setData({ videos: [], users: [], hashtags: [], posts: [], lives: [] });
      }
    }, 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
    // eslint-disable-next-line
  }, [q, tab]);

  // Scroll infini pour les onglets paginés.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loading && ["videos", "users", "posts"].includes(tab)) {
        runSearch(q, tab, false);
      }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, tab, q, runSearch]);

  const pickSuggest = (s) => {
    setShowSuggest(false);
    if (s.type === "user") { setQ(s.value); setTab("users"); }
    else { setQ(s.value); setTab("videos"); }
    inputRef.current?.blur();
  };

  const openHashtag = (tagObj) => { setQ(tagObj.tag || tagObj); setTab("videos"); inputRef.current?.blur(); };

  const Avatar = ({ pic, name, size = "w-11 h-11" }) => (
    pic ? <img src={pic} alt="" className={`${size} rounded-full object-cover flex-shrink-0`} />
        : <div className={`${size} rounded-full flex items-center justify-center font-bold flex-shrink-0`}
               style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#00363e" }}>{(name || "?")[0]?.toUpperCase()}</div>
  );

  const VideoGrid = ({ items }) => (
    <div className="grid grid-cols-3 gap-1.5">
      {items.map((v) => (
        <button key={v.id} onClick={() => navigate(`/nexus-clips/${v.id}`)}
                className="relative rounded-lg overflow-hidden active:scale-95 transition-transform" style={{ aspectRatio: "9/16", background: "#111" }}>
          <video src={v.media_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent 55%)" }} />
          <div className="absolute bottom-1 left-1.5 right-1.5 flex items-center gap-1 text-white text-[11px]">
            <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1", color: "#f87171" }}>favorite</span>
            <span className="font-bold">{fmt(v.likes_count)}</span>
          </div>
        </button>
      ))}
    </div>
  );

  const UserRow = ({ u }) => (
    <button onClick={() => navigate(`/profil/${u.id}`)} className="w-full flex items-center gap-3 py-2.5 text-left">
      <Avatar pic={u.profile_pic} name={u.username} />
      <div className="min-w-0">
        <p className="font-bold text-sm flex items-center gap-1" style={{ color: C.onSurface }}>
          @{u.username}
          {u.is_verified && <span className="material-symbols-outlined text-sm" style={{ color: "#3b82f6", fontVariationSettings: "'FILL' 1" }}>verified</span>}
          {u.is_premium && <span className="material-symbols-outlined text-sm" style={{ color: C.cyan, fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>}
        </p>
        <p className="text-xs truncate" style={{ color: C.outline }}>{fmt(u.followers_count)} abonnés{u.bio ? ` · ${u.bio}` : ""}</p>
      </div>
    </button>
  );

  const HashRow = ({ t }) => (
    <button onClick={() => openHashtag(t)} className="w-full flex items-center gap-3 py-2.5 text-left">
      <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: C.high }}>
        <span className="material-symbols-outlined" style={{ color: C.cyan }}>tag</span>
      </div>
      <div>
        <p className="font-bold text-sm" style={{ color: C.onSurface }}>{t.tag}</p>
        <p className="text-xs" style={{ color: C.outline }}>{t.post_count} clip{t.post_count > 1 ? "s" : ""}</p>
      </div>
    </button>
  );

  const PostRow = ({ p }) => (
    <button onClick={() => navigate(`/post/${p.id}`)} className="w-full flex items-start gap-3 py-2.5 text-left">
      <Avatar pic={p.author_profile_pic} name={p.author_username} size="w-9 h-9" />
      <div className="min-w-0">
        <p className="font-bold text-xs" style={{ color: C.onSurface }}>@{p.author_username}</p>
        <p className="text-sm line-clamp-2" style={{ color: C.outline }}>{p.content}</p>
      </div>
    </button>
  );

  const LiveRow = ({ l }) => (
    <button onClick={() => navigate(`/live/${l.room_id}`)} className="w-full flex items-center gap-3 py-2.5 text-left">
      <div className="relative"><Avatar pic={l.host_profile_pic} name={l.host_username} />
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-black px-1.5 rounded-full" style={{ background: "#ef4444", color: "#fff" }}>LIVE</span>
      </div>
      <p className="font-bold text-sm" style={{ color: C.onSurface }}>@{l.host_username}</p>
    </button>
  );

  const Empty = ({ label }) => (
    <p className="text-center text-sm py-10" style={{ color: C.outline }}>{q.trim() ? `Aucun résultat pour « ${q} »` : label}</p>
  );

  const renderTab = () => {
    if (loading && page === 0) return <p className="text-center text-sm py-10" style={{ color: C.outline }}>Recherche…</p>;
    if (tab === "top") {
      const nothing = !data.videos.length && !data.users.length && !data.hashtags.length && !data.posts.length && !data.lives.length;
      if (nothing) return <Empty label="Cherche des clips, comptes ou #hashtags" />;
      return (
        <div className="space-y-5">
          {data.lives.length > 0 && <div><h3 className="text-xs font-bold uppercase mb-1" style={{ color: C.cyan }}>En direct</h3>{data.lives.map((l) => <LiveRow key={l.room_id} l={l} />)}</div>}
          {data.users.length > 0 && <div><h3 className="text-xs font-bold uppercase mb-1" style={{ color: C.cyan }}>Comptes</h3>{data.users.map((u) => <UserRow key={u.id} u={u} />)}</div>}
          {data.hashtags.length > 0 && <div><h3 className="text-xs font-bold uppercase mb-1" style={{ color: C.cyan }}>Hashtags</h3>{data.hashtags.slice(0, 5).map((t) => <HashRow key={t.tag} t={t} />)}</div>}
          {data.videos.length > 0 && <div><h3 className="text-xs font-bold uppercase mb-2" style={{ color: C.cyan }}>Vidéos</h3><VideoGrid items={data.videos} /></div>}
          {data.posts.length > 0 && <div><h3 className="text-xs font-bold uppercase mb-1" style={{ color: C.cyan }}>Posts</h3>{data.posts.map((p) => <PostRow key={p.id} p={p} />)}</div>}
        </div>
      );
    }
    if (tab === "videos") return data.videos.length ? <VideoGrid items={data.videos} /> : <Empty label="Cherche des vidéos" />;
    if (tab === "users") return data.users.length ? <div>{data.users.map((u) => <UserRow key={u.id} u={u} />)}</div> : <Empty label="Cherche des comptes" />;
    if (tab === "posts") return data.posts.length ? <div>{data.posts.map((p) => <PostRow key={p.id} p={p} />)}</div> : <Empty label="Cherche des posts" />;
    if (tab === "hashtags") return data.hashtags.length ? <div>{data.hashtags.map((t) => <HashRow key={t.tag} t={t} />)}</div> : <Empty label="Cherche des hashtags" />;
    if (tab === "live") return data.lives.length ? <div>{data.lives.map((l) => <LiveRow key={l.room_id} l={l} />)}</div> : <Empty label="Aucun direct" />;
    return null;
  };

  return (
    <Layout user={user} setUser={setUser} compact hideMobileHeader>
      <div className="max-w-2xl mx-auto min-h-screen" style={{ background: C.bg }}>
        {/* Barre de recherche */}
        <div className="sticky top-0 z-30 px-3 pt-safe-3 pb-2" style={{ background: "rgba(11,19,38,0.9)", backdropFilter: "blur(16px)" }}>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/nexus-clips")} className="w-9 h-9 flex items-center justify-center rounded-full" style={{ color: C.onSurface }}>
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <div className="flex-1 flex items-center gap-2 px-3 h-10 rounded-full" style={{ background: C.high }}>
              <span className="material-symbols-outlined text-lg" style={{ color: C.outline }}>search</span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => { setQ(e.target.value); setShowSuggest(true); }}
                onFocus={() => setShowSuggest(true)}
                placeholder="Rechercher clips, @comptes, #hashtags"
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: C.onSurface }}
                autoFocus
              />
              {q && <button onClick={() => { setQ(""); inputRef.current?.focus(); }} className="material-symbols-outlined text-lg" style={{ color: C.outline }}>close</button>}
            </div>
          </div>

          {/* Autocomplétion */}
          {showSuggest && suggests.length > 0 && (
            <div className="mt-2 rounded-2xl overflow-hidden" style={{ background: C.surface, border: "1px solid rgba(255,255,255,0.06)" }}>
              {suggests.map((s, i) => (
                <button key={i} onClick={() => pickSuggest(s)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5">
                  <span className="material-symbols-outlined text-lg" style={{ color: C.outline }}>{s.type === "user" ? "person" : "tag"}</span>
                  <span className="text-sm" style={{ color: C.onSurface }}>{s.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Onglets horizontaux */}
          <div className="flex gap-1 mt-2 overflow-x-auto no-scrollbar">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button key={t.key} onClick={() => { setTab(t.key); setShowSuggest(false); }}
                        className="px-3.5 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors"
                        style={{ background: active ? C.cyan : "transparent", color: active ? "#00363e" : C.outline }}>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Résultats */}
        <div className="px-3 py-3" onClick={() => setShowSuggest(false)}>
          {renderTab()}
          <div ref={sentinelRef} />
          {loading && page > 0 && <p className="text-center text-xs py-4" style={{ color: C.outline }}>Chargement…</p>}
        </div>
      </div>
    </Layout>
  );
}
