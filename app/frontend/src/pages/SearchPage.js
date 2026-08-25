import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

// ── Panneau « Listes » : créer / consulter / gérer des listes d'utilisateurs ──
function ListsPanel({ user }) {
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);       // { id, name, members }
  const [adding, setAdding] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState([]);

  const fetchLists = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/lists`); setLists(r.data?.lists || []); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchLists(); }, [fetchLists]);

  const createList = async () => {
    const name = window.prompt("Nom de la nouvelle liste");
    if (!name || !name.trim()) return;
    try { await axios.post(`${API}/lists`, { name: name.trim() }); fetchLists(); toast.success(t("search.list_created")); }
    catch { toast.error(t("search.err_generic")); }
  };

  const openDetail = async (id) => {
    try { const r = await axios.get(`${API}/lists/${id}`); setDetail(r.data); setAdding(false); setAddQuery(""); }
    catch { toast.error(t("search.err_generic")); }
  };

  const deleteList = async (id) => {
    if (!window.confirm("Supprimer cette liste ?")) return;
    try { await axios.delete(`${API}/lists/${id}`); setDetail(null); fetchLists(); toast.success(t("search.list_deleted")); }
    catch { toast.error(t("search.err_generic")); }
  };

  const removeMember = async (uid) => {
    try {
      await axios.delete(`${API}/lists/${detail.id}/members/${uid}`);
      setDetail((d) => ({ ...d, members: d.members.filter((m) => m.id !== uid) }));
      fetchLists();
    } catch { toast.error(t("search.err_generic")); }
  };

  const addMember = async (u) => {
    try {
      await axios.post(`${API}/lists/${detail.id}/members`, { user_id: u.id });
      setDetail((d) => (d.members.some((m) => m.id === u.id) ? d : { ...d, members: [...d.members, u] }));
      fetchLists();
    } catch { toast.error(t("search.err_generic")); }
  };

  useEffect(() => {
    if (!adding || !addQuery.trim()) { setAddResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/search`, { params: { q: addQuery, type: "people", limit: 10 } });
        setAddResults((r.data?.users || []).filter((u) => u.id !== user.id));
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [addQuery, adding, user.id]);

  const Ava = ({ pic, name, size = "w-10 h-10" }) => (
    <Avatar className={size}>
      <AvatarImage src={pic} />
      <AvatarFallback className="bg-slate-700">{(name || "?")[0].toUpperCase()}</AvatarFallback>
    </Avatar>
  );

  return (
    <div className="pt-2">
      {/* Créer une liste */}
      <div className="px-4 py-2">
        <button onClick={createList}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-bold transition-all active:scale-95"
          style={{ background: "var(--nexus-accent)", color: "#00363e" }}>
          <span className="material-symbols-outlined text-lg">add</span>
          {t("search.create_list")}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(34,211,238,0.2)", borderTopColor: "var(--nexus-accent)" }} /></div>
      ) : lists.length === 0 ? (
        <div className="text-center py-14 px-4" style={{ color: "#859397" }}>
          <span className="material-symbols-outlined text-4xl block mb-2" style={{ opacity: 0.4 }}>list</span>
          <p className="text-sm">{t("search.no_lists")}</p>
        </div>
      ) : (
        lists.map((l) => (
          <button key={l.id} onClick={() => openDetail(l.id)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#171f33", color: "var(--nexus-accent)" }}>
              <span className="material-symbols-outlined">group</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold truncate" style={{ color: "#dae2fd" }}>{l.name}</p>
              <p className="text-[12px]" style={{ color: "#859397" }}>{l.member_count} membre{l.member_count > 1 ? "s" : ""}</p>
            </div>
            <div className="flex -space-x-2">
              {(l.members_preview || []).map((m) => (
                <Ava key={m.id} pic={m.profile_pic} name={m.username} size="w-7 h-7 border-2 border-slate-950" />
              ))}
            </div>
          </button>
        ))
      )}

      {/* Détail d'une liste */}
      {detail && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setDetail(null)}>
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
            style={{ background: "#0b1326", border: "1px solid #3c494c", maxHeight: "80vh", paddingBottom: "env(safe-area-inset-bottom)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span className="material-symbols-outlined" style={{ color: "var(--nexus-accent)" }}>group</span>
              <p className="flex-1 font-black truncate" style={{ color: "#dae2fd" }}>{detail.name}</p>
              <button onClick={() => deleteList(detail.id)} title={t("search.delete_list")} style={{ color: "#f87171" }}>
                <span className="material-symbols-outlined">delete</span>
              </button>
              <button onClick={() => setDetail(null)} style={{ color: "#859397" }}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Ajouter des membres */}
            <div className="px-4 py-2 flex-shrink-0">
              {!adding ? (
                <button onClick={() => setAdding(true)} className="text-sm font-bold" style={{ color: "var(--nexus-accent)" }}>+ Ajouter des membres</button>
              ) : (
                <div className="flex items-center gap-2 rounded-full px-3 h-10" style={{ background: "#131b2e" }}>
                  <span className="material-symbols-outlined" style={{ color: "#859397", fontSize: 18 }}>search</span>
                  <input autoFocus value={addQuery} onChange={(e) => setAddQuery(e.target.value)}
                    placeholder={t("search.search_user")} className="flex-1 bg-transparent outline-none text-sm select-text"
                    style={{ color: "#dae2fd" }} />
                  <button onClick={() => { setAdding(false); setAddQuery(""); }} style={{ color: "#859397" }}>
                    <span className="material-symbols-outlined text-base">close</span>
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-y-auto flex-1">
              {/* Résultats d'ajout */}
              {adding && addResults.map((u) => {
                const already = detail.members.some((m) => m.id === u.id);
                return (
                  <div key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Ava pic={u.profile_pic} name={u.username} size="w-9 h-9" />
                    <p className="flex-1 text-sm font-semibold truncate" style={{ color: "#dae2fd" }}>@{u.username}</p>
                    <button onClick={() => addMember(u)} disabled={already}
                      className="text-xs font-bold px-3 py-1.5 rounded-full"
                      style={{ background: already ? "#171f33" : "var(--nexus-accent)", color: already ? "#859397" : "#00363e" }}>
                      {already ? t("search.added") : t("search.add")}
                    </button>
                  </div>
                );
              })}

              {/* Membres actuels */}
              {!adding && (detail.members.length === 0 ? (
                <p className="text-center text-sm py-8" style={{ color: "#859397" }}>{t("search.empty_list")}</p>
              ) : detail.members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <button onClick={() => navigate(`/profile/${m.id}`)}><Ava pic={m.profile_pic} name={m.username} size="w-9 h-9" /></button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "#dae2fd" }}>@{m.username}</p>
                    {m.bio && <p className="text-xs truncate" style={{ color: "#859397" }}>{m.bio}</p>}
                  </div>
                  <button onClick={() => removeMember(m.id)} className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ background: "#171f33", color: "#f87171" }}>
                    Retirer
                  </button>
                </div>
              )))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
  const { t } = useTranslation();
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

  // Recherche discrète (incognito) : ouverte par appui long sur la Loupe
  // (?focus=1) → la grille de Découverte/Tendances est MASQUÉE tant que rien
  // n'est tapé, pour ne pas exposer de contenu non sollicité à l'entourage.
  const [discreet, setDiscreet] = useState(searchParams.get("focus") === "1");

  // Accès rapide : ?focus=1 → focus immédiat du champ, même si la page est déjà
  // montée (autoFocus ne couvre que le montage).
  useEffect(() => {
    if (searchParams.get("focus") === "1") {
      setDiscreet(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [searchParams]);

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
          <div className="px-4 pt-safe-3 pb-2">
            <div className="flex items-center gap-2 rounded-full px-4 h-11" style={{ background: "#131b2e" }}>
              <span className="material-symbols-outlined" style={{ color: "#859397", fontSize: 20 }}>search</span>
              <input
                ref={inputRef}
                data-testid="search-input"
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (discreet && e.target.value) setDiscreet(false); }}
                placeholder={t("search.search_nexus")}
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
                  {i18n.t("search.tab_" + t.key)}
                  {active && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-full" style={{ background: CY }} />}
                </button>
              );
            })}
          </div>
        </header>

        {/* ── Contenu ── */}
        <div className="pb-24 lg:pb-8">
          {tab === "lists" ? (
            <ListsPanel user={user} />
          ) : emptyQuery && discreet ? (
            /* Recherche discrète : Découverte masquée tant que rien n'est tapé. */
            <div className="flex flex-col items-center justify-center text-center px-8"
              style={{ minHeight: "50vh", animation: "fadeIn 0.3s ease" }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(34,211,238,0.1)" }}>
                <span className="material-symbols-outlined" style={{ color: CY, fontSize: 32 }}>visibility_off</span>
              </div>
              <h2 className="text-lg font-black mb-1" style={{ fontFamily: "Space Grotesk, sans-serif", color: "#dae2fd" }}>{t("search.private_search")}</h2>
              <p className="text-sm" style={{ color: "#859397" }}>Tapez le nom d'un ami, d'une équipe ou d'un hashtag. La grille Découverte reste masquée.</p>
              <button onClick={() => setDiscreet(false)} className="mt-5 text-xs font-bold px-4 py-2 rounded-full" style={{ background: "#131b2e", color: "#859397" }}>
                Afficher les tendances
              </button>
            </div>
          ) : emptyQuery ? (
            /* État vide : tendances */
            <div className="pt-2">
              <h2 className="px-4 py-3 text-lg font-black" style={{ fontFamily: "Space Grotesk, sans-serif", color: "#dae2fd" }}>
                Tendances pour vous
              </h2>
              {trending.length === 0 ? (
                <p className="px-4 text-sm" style={{ color: "#859397" }}>{t("search.no_trends")}</p>
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
                  <p className="text-sm">{t("search.no_results", { query })}</p>
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
