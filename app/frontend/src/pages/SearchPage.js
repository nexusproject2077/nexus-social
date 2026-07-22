import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNavigate, useSearchParams } from "react-router-dom";

const CY = "var(--nexus-accent)";
const PAGE = 20;

// Onglets façon X, adaptés à Nexus. `type` = paramètre backend.
const TABS = [
  { key: "all",      label: "Pour toi",  type: "all" },
  { key: "top",      label: "Top",       type: "top" },
  { key: "latest",   label: "Derniers",  type: "latest" },
  { key: "people",   label: "Personnes", type: "people" },
  { key: "media",    label: "Médias",    type: "media" },
  { key: "lists",    label: "Listes",    type: "lists" },
];

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default function SearchPage({ user }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [tab, setTab] = useState("all");
  const [users, setUsers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [hashtags, setHashtags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [trending, setTrending] = useState([]);
  const skipRef = useRef(0);
  const sentinelRef = useRef(null);
  const inputRef = useRef(null);

  const activeType = TABS.find((t) => t.key === tab)?.type || "all";

  // Met en évidence les occurrences de la requête (façon X).
  const highlight = (text) => {
    const q = query.trim();
    if (!q || !text) return text;
    const parts = String(text).split(new RegExp(`(${escapeRx(q)})`, "ig"));
    return parts.map((p, i) =>
      p.toLowerCase() === q.toLowerCase()
        ? <span key={i} style={{ color: CY, fontWeight: 700 }}>{p}</span>
        : <span key={i}>{p}</span>
    );
  };

  // Suggestions tendance (état vide).
  useEffect(() => {
    axios.get(`${API}/trending/hashtags?limit=10`)
      .then((r) => setTrending(Array.isArray(r.data?.trending) ? r.data.trending : []))
      .catch(() => setTrending([]));
  }, []);

  // Recherche (remise à zéro) — appelée en temps réel (débounce) et au changement d'onglet.
  const runSearch = useCallback(async (q, type, reset = true) => {
    if (!q.trim()) { setUsers([]); setPosts([]); setHashtags([]); setHasMore(false); return; }
    if (type === "lists") { setUsers([]); setPosts([]); setHashtags([]); setHasMore(false); return; }
    const skip = reset ? 0 : skipRef.current;
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const r = await axios.get(`${API}/search`, { params: { q, type, skip, limit: PAGE } });
      const d = r.data || {};
      const newUsers = d.users || [];
      const newPosts = d.posts || [];
      const newTags = d.hashtags || [];
      if (reset) {
        setUsers(newUsers); setPosts(newPosts); setHashtags(newTags);
        skipRef.current = newPosts.length || newUsers.length;
      } else {
        setUsers((p) => [...p, ...newUsers]);
        setPosts((p) => [...p, ...newPosts]);
        skipRef.current += (newPosts.length || newUsers.length);
      }
      // Encore des résultats paginables ? (onglets à liste : posts ou personnes)
      const pageCount = type === "people" ? newUsers.length : newPosts.length;
      setHasMore(pageCount >= PAGE);
    } catch {
      if (reset) { setUsers([]); setPosts([]); setHashtags([]); }
      setHasMore(false);
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  }, []);

  // Recherche en temps réel : débounce 300 ms sur la requête + l'onglet.
  useEffect(() => {
    const t = setTimeout(() => { skipRef.current = 0; runSearch(query, activeType, true); }, 300);
    return () => clearTimeout(t);
  }, [query, activeType, runSearch]);

  // Scroll infini.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
        runSearch(query, activeType, false);
      }
    }, { rootMargin: "400px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, loadingMore, query, activeType, runSearch]);

  const handlePostUpdate = (up) => setPosts((p) => p.map((x) => (x.id === up.id ? up : x)));
  const handlePostDelete = (id) => setPosts((p) => p.filter((x) => x.id !== id));

  const emptyQuery = !query.trim();

  return (
    <Layout user={user} compact hideMobileHeader>
      <div className="max-w-2xl mx-auto">
        {/* ── Header collant : barre de recherche + onglets (façon X) ── */}
        <header className="sticky top-0 z-30" style={{ backgroundColor: "rgba(11,19,38,0.85)", backdropFilter: "blur(20px)" }}>
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-2 rounded-full px-4 h-11" style={{ background: "#131b2e" }}>
              <span className="material-symbols-outlined" style={{ color: "#859397", fontSize: 20 }}>search</span>
              <input
                ref={inputRef}
                data-testid="search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher sur Nexus"
                autoFocus
                className="flex-1 bg-transparent border-none outline-none text-sm select-text"
                style={{ color: "#dae2fd" }}
              />
              {query && (
                <button onClick={() => { setQuery(""); inputRef.current?.focus(); }} style={{ color: "#859397" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
                </button>
              )}
            </div>
          </div>

          {/* Onglets scrollables horizontalement */}
          <div className="flex items-center gap-1 px-2 overflow-x-auto" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  data-testid={`search-tab-${t.key}`}
                  onClick={() => setTab(t.key)}
                  className="relative flex-shrink-0 px-4 py-3 text-sm transition-colors"
                  style={{ color: active ? "#dae2fd" : "#859397", fontWeight: active ? 800 : 500 }}
                >
                  {t.label}
                  {active && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-full" style={{ background: CY }} />}
                </button>
              );
            })}
          </div>
        </header>

        {/* ── Contenu ── */}
        <div className="pb-24 lg:pb-8">
          {emptyQuery ? (
            /* État vide : tendances */
            <div className="pt-2">
              <h2 className="px-4 py-3 text-lg font-black" style={{ fontFamily: "Space Grotesk, sans-serif", color: "#dae2fd" }}>
                Tendances pour vous
              </h2>
              {trending.length === 0 ? (
                <p className="px-4 text-sm" style={{ color: "#859397" }}>Aucune tendance pour l'instant. Publiez avec des #hashtags !</p>
              ) : trending.map((t, i) => (
                <button
                  key={t.normalized || t.tag}
                  onClick={() => setQuery(t.tag)}
                  className="w-full text-left px-4 py-3 transition-colors hover:bg-white/5"
                >
                  <p className="text-[11px]" style={{ color: "#859397" }}>{i + 1} · Tendance</p>
                  <p className="text-sm font-bold" style={{ color: "#dae2fd" }}>{t.tag}</p>
                  <p className="text-[11px]" style={{ color: "#859397" }}>{t.post_count} publication{t.post_count > 1 ? "s" : ""}</p>
                </button>
              ))}
            </div>
          ) : tab === "lists" ? (
            <div className="text-center py-16 px-4" style={{ color: "#859397" }}>
              <span className="material-symbols-outlined text-4xl block mb-2" style={{ opacity: 0.4 }}>list</span>
              <p className="text-sm">Les listes arrivent bientôt.</p>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: `${CY}33`, borderTopColor: CY }} />
            </div>
          ) : (
            <div>
              {/* Hashtags (onglet Pour toi) */}
              {hashtags.length > 0 && (tab === "all") && (
                <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {hashtags.map((h) => (
                    <button key={h.normalized || h.tag} onClick={() => setQuery(h.tag)}
                      className="w-full text-left px-4 py-2.5 transition-colors hover:bg-white/5">
                      <p className="text-sm font-bold" style={{ color: "#dae2fd" }}>{highlight(h.tag)}</p>
                      <p className="text-[11px]" style={{ color: "#859397" }}>{h.post_count} publication{h.post_count > 1 ? "s" : ""}</p>
                    </button>
                  ))}
                </div>
              )}

              {/* Personnes */}
              {users.length > 0 && (
                <div style={{ borderBottom: (tab === "all" && posts.length > 0) ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                  {users.map((u) => (
                    <div key={u.id} data-testid={`user-result-${u.id}`}
                      onClick={() => navigate(`/profile/${u.id}`)}
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-white/5">
                      <Avatar className="w-11 h-11">
                        <AvatarImage src={u.profile_pic} />
                        <AvatarFallback className="bg-slate-700">{u.username[0].toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold truncate" style={{ color: "#dae2fd" }}>{highlight(u.username)}</p>
                        {u.bio && <p className="text-sm truncate" style={{ color: "#859397" }}>{highlight(u.bio)}</p>}
                        <p className="text-[11px]" style={{ color: "#3c494c" }}>{u.followers_count || 0} abonnés</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Publications / Médias / Clips */}
              {posts.length > 0 && (
                <div className="px-3 py-3 space-y-4">
                  {posts.map((post) => (
                    <PostCard key={post.id} post={post} currentUser={user}
                      onUpdate={handlePostUpdate} onDelete={handlePostDelete} />
                  ))}
                </div>
              )}

              {/* Aucun résultat */}
              {users.length === 0 && posts.length === 0 && hashtags.length === 0 && (
                <div className="text-center py-16 px-4" style={{ color: "#859397" }}>
                  <span className="material-symbols-outlined text-4xl block mb-2" style={{ opacity: 0.4 }}>search_off</span>
                  <p className="text-sm">Aucun résultat pour « {query} »</p>
                </div>
              )}

              {/* Sentinelle scroll infini + spinner */}
              <div ref={sentinelRef} />
              {loadingMore && (
                <div className="flex justify-center py-6">
                  <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: `${CY}33`, borderTopColor: CY }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
