import { useTranslation } from "react-i18next";
import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import EntitySearchPanel from "@/components/EntitySearchPanel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

const CY = "var(--nexus-accent)";
const TABS = [["all", "Pour toi"], ["clubs", "Clubs"], ["figures", "Personnalités"], ["top", "Top"], ["latest", "Derniers"], ["people", "Personnes"], ["media", "Médias"], ["lists", "Listes"]];
const ENTITY_TABS = ["all", "clubs", "figures"];
const EXCLUSIVE_TABS = ["clubs", "figures"];
const PAGE = 20;
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function Ava({ pic, name, size = "w-10 h-10" }) {
  return <Avatar className={size}><AvatarImage src={pic} /><AvatarFallback className="bg-slate-700">{String(name || "?")[0].toUpperCase()}</AvatarFallback></Avatar>;
}
function ListsPanel({ user }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [lists, setLists] = useState([]), [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null), [adding, setAdding] = useState(false);
  const [addQuery, setAddQuery] = useState(""), [addResults, setAddResults] = useState([]);
  const fetchLists = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/lists`); setLists(r.data?.lists || []); } catch { /* existing lists remain */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchLists(); }, [fetchLists]);
  const fail = () => toast.error(t("searchpage.err_generic"));
  const createList = async () => {
    const name = window.prompt(t("searchpage.new_list_name"));
    if (!name?.trim()) return;
    try { await axios.post(`${API}/lists`, { name: name.trim() }); fetchLists(); toast.success(t("searchpage.list_created")); } catch { fail(); }
  };
  const openDetail = async (id) => {
    try { const r = await axios.get(`${API}/lists/${id}`); setDetail(r.data); setAdding(false); setAddQuery(""); } catch { fail(); }
  };
  const deleteList = async () => {
    if (!window.confirm(t("searchpage.confirm_delete_list"))) return;
    try { await axios.delete(`${API}/lists/${detail.id}`); setDetail(null); fetchLists(); toast.success(t("searchpage.list_deleted")); } catch { fail(); }
  };
  const removeMember = async (uid) => {
    try { await axios.delete(`${API}/lists/${detail.id}/members/${uid}`); setDetail((d) => ({ ...d, members: d.members.filter((m) => m.id !== uid) })); fetchLists(); } catch { fail(); }
  };
  const addMember = async (u) => {
    try { await axios.post(`${API}/lists/${detail.id}/members`, { user_id: u.id }); setDetail((d) => d.members.some((m) => m.id === u.id) ? d : { ...d, members: [...d.members, u] }); fetchLists(); } catch { fail(); }
  };
  useEffect(() => {
    if (!adding || !addQuery.trim()) { setAddResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try { const r = await axios.get(`${API}/search`, { params: { q: addQuery, type: "people", limit: 10 }, signal: controller.signal }); if (!controller.signal.aborted) setAddResults((r.data?.users || []).filter((u) => u.id !== user.id)); } catch { /* optional suggestions */ }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [addQuery, adding, user.id]);
  return <div className="pt-2">
    <div className="px-4 py-2"><button onClick={createList} className="w-full rounded-full py-2.5 text-sm font-bold" style={{ background: CY, color: "#00363e" }}>{t("searchpage.create_list")}</button></div>
    {loading ? <p className="p-4 text-slate-400" role="status">Chargement…</p> : !lists.length ? <p className="p-4 text-sm text-slate-400">{t("searchpage.no_lists")}</p> : lists.map((l) => <button key={l.id} onClick={() => openDetail(l.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5"><span className="material-symbols-outlined" style={{ color: CY }}>group</span><span className="min-w-0 flex-1"><span className="block truncate font-bold text-slate-100">{l.name}</span><span className="text-xs text-slate-400">{l.member_count} membres</span></span><span className="flex -space-x-2">{(l.members_preview || []).map((m) => <Ava key={m.id} pic={m.profile_pic} name={m.username} size="w-7 h-7" />)}</span></button>)}
    {detail && <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/60 sm:items-center" onClick={() => setDetail(null)}><div role="dialog" aria-label={detail.name} className="flex max-h-[80vh] w-full flex-col overflow-hidden rounded-t-3xl bg-slate-950 text-slate-100 sm:max-w-md sm:rounded-3xl" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3 border-b border-white/10 p-4"><h2 className="min-w-0 flex-1 truncate font-bold">{detail.name}</h2><button onClick={deleteList} aria-label={t("searchpage.delete_list")} className="text-red-400"><span className="material-symbols-outlined">delete</span></button><button onClick={() => setDetail(null)} aria-label="Fermer"><span className="material-symbols-outlined">close</span></button></div>
      <div className="p-4">{!adding ? <button onClick={() => setAdding(true)} style={{ color: CY }}>+ Ajouter des membres</button> : <div className="flex gap-2"><input autoFocus value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder={t("searchpage.search_user")} className="min-w-0 flex-1 rounded-full bg-slate-800 px-3 py-2" /><button onClick={() => { setAdding(false); setAddQuery(""); }} aria-label="Annuler">×</button></div>}</div>
      <div className="overflow-y-auto">{adding ? addResults.map((u) => { const already = detail.members.some((m) => m.id === u.id); return <div key={u.id} className="flex items-center gap-3 px-4 py-3"><Ava pic={u.profile_pic} name={u.username} /><span className="min-w-0 flex-1 truncate">@{u.username}</span><button disabled={already} onClick={() => addMember(u)} style={{ color: CY }}>{t(already ? "searchpage.added" : "searchpage.add")}</button></div>; }) : !detail.members.length ? <p className="p-4 text-slate-400">{t("searchpage.empty_list")}</p> : detail.members.map((m) => <div key={m.id} className="flex items-center gap-3 px-4 py-3"><button onClick={() => navigate(`/profile/${m.id}`)}><Ava pic={m.profile_pic} name={m.username} /></button><div className="min-w-0 flex-1"><p className="truncate">@{m.username}</p><p className="truncate text-xs text-slate-400">{m.bio}</p></div><button onClick={() => removeMember(m.id)} className="text-xs text-red-400">Retirer</button></div>)}</div>
    </div></div>}
  </div>;
}
export default function SearchPage({ user }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || ""), [tab, setTab] = useState("all");
  const [users, setUsers] = useState([]), [posts, setPosts] = useState([]), [hashtags, setHashtags] = useState([]);
  const [loading, setLoading] = useState(false), [loadingMore, setLoadingMore] = useState(false), [hasMore, setHasMore] = useState(false);
  const [trending, setTrending] = useState([]);
  const [discreet, setDiscreet] = useState(searchParams.get("focus") === "1");
  const skipRef = useRef(0), sentinelRef = useRef(null), inputRef = useRef(null), sequence = useRef(0);
  useEffect(() => { if (searchParams.get("focus") === "1") { setDiscreet(true); requestAnimationFrame(() => inputRef.current?.focus()); } }, [searchParams]);
  useEffect(() => { axios.get(`${API}/trending/hashtags?limit=10`).then((r) => setTrending(Array.isArray(r.data?.trending) ? r.data.trending : [])).catch(() => setTrending([])); }, []);
  const highlight = (text) => {
    const q = query.trim();
    if (!q || !text) return text;
    return String(text).split(new RegExp(`(${escapeRx(q)})`, "ig")).map((p, i) => <span key={i} style={p.toLowerCase() === q.toLowerCase() ? { color: CY, fontWeight: 700 } : undefined}>{p}</span>);
  };
  const runSearch = useCallback(async (q, type, reset = true) => {
    const request = ++sequence.current;
    if (!q.trim() || type === "lists" || EXCLUSIVE_TABS.includes(type)) { setUsers([]); setPosts([]); setHashtags([]); setHasMore(false); setLoading(false); setLoadingMore(false); return; }
    const skip = reset ? 0 : skipRef.current;
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const r = await axios.get(`${API}/search`, { params: { q, type, skip, limit: PAGE } });
      if (request !== sequence.current) return;
      const d = r.data || {}, newUsers = d.users || [], newPosts = d.posts || [], newTags = d.hashtags || [];
      if (reset) { setUsers(newUsers); setPosts(newPosts); setHashtags(newTags); skipRef.current = newPosts.length || newUsers.length; }
      else { setUsers((p) => [...p, ...newUsers]); setPosts((p) => [...p, ...newPosts]); skipRef.current += newPosts.length || newUsers.length; }
      setHasMore((type === "people" ? newUsers.length : newPosts.length) >= PAGE);
    } catch { if (request === sequence.current) { if (reset) { setUsers([]); setPosts([]); setHashtags([]); } setHasMore(false); } }
    finally { if (request === sequence.current) { setLoading(false); setLoadingMore(false); } }
  }, []);
  useEffect(() => {
    ++sequence.current;
    const timer = setTimeout(() => { skipRef.current = 0; runSearch(query, tab, true); }, 300);
    return () => { clearTimeout(timer); ++sequence.current; };
  }, [query, tab, runSearch]);
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver((entries) => { if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) runSearch(query, tab, false); }, { rootMargin: "400px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, query, tab, runSearch]);
  const emptyQuery = !query.trim();
  return <Layout user={user} compact hideMobileHeader><div className="mx-auto max-w-2xl">
    <header className="sticky top-0 z-30" style={{ backgroundColor: "rgba(11,19,38,0.85)", backdropFilter: "blur(20px)" }}>
      <div className="px-4 pt-safe-3 pb-2"><div className="flex h-11 items-center gap-2 rounded-full bg-[#131b2e] px-4"><span className="material-symbols-outlined text-slate-400">search</span><input ref={inputRef} data-testid="search-input" value={query} onChange={(e) => { setQuery(e.target.value); if (discreet && e.target.value) setDiscreet(false); }} placeholder={t("searchpage.search_nexus")} autoFocus className="min-w-0 flex-1 select-text border-none bg-transparent text-sm text-slate-100 outline-none" />{query && <button aria-label="Effacer la recherche" onClick={() => { setQuery(""); inputRef.current?.focus(); }} className="text-slate-400"><span className="material-symbols-outlined">close</span></button>}</div></div>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 px-2">{TABS.map(([key, label]) => <button key={key} data-testid={`search-tab-${key}`} aria-pressed={tab === key} onClick={() => setTab(key)} className="relative shrink-0 px-4 py-3 text-sm" style={{ color: tab === key ? "#dae2fd" : "#859397", fontWeight: tab === key ? 800 : 500 }}>{t("searchpage.tab_" + key, { defaultValue: label })}{tab === key && <span className="absolute bottom-0 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full" style={{ background: CY }} />}</button>)}</div>
    </header>
    <div className="pb-24 lg:pb-8">
      {!emptyQuery && ENTITY_TABS.includes(tab) && <EntitySearchPanel key={`${tab}:${query.trim()}`} query={query.trim()} mode={tab} currentUser={user} />}
      {tab === "lists" ? <ListsPanel user={user} /> : emptyQuery && discreet ? <div className="flex min-h-[50vh] flex-col items-center justify-center px-8 text-center text-slate-400"><span className="material-symbols-outlined mb-4 text-4xl" style={{ color: CY }}>visibility_off</span><h2 className="text-lg font-bold text-slate-100">{t("searchpage.private_search")}</h2><p className="text-sm">{t("searchpage.private_search_hint")}</p><button onClick={() => setDiscreet(false)} className="mt-5 rounded-full bg-slate-800 px-4 py-2 text-xs">{t("searchpage.show_trends")}</button></div> : EXCLUSIVE_TABS.includes(tab) ? (emptyQuery && <p className="p-6 text-sm text-slate-400">Saisis au moins deux caractères pour rechercher {tab === "clubs" ? "un club" : "une personnalité"}.</p>) : emptyQuery ? <div className="pt-2"><h2 className="px-4 py-3 text-lg font-black text-slate-100">Tendances pour vous</h2>{!trending.length ? <p className="px-4 text-sm text-slate-400">{t("searchpage.no_trends")}</p> : trending.map((item, i) => <button key={item.normalized || item.tag} onClick={() => setQuery(item.tag)} className="w-full px-4 py-3 text-left hover:bg-white/5"><p className="text-xs text-slate-400">{i + 1} · Tendance</p><p className="font-bold text-slate-100">{item.tag}</p><p className="text-xs text-slate-400">{item.post_count} publications</p></button>)}</div> : loading ? <p role="status" className="p-8 text-center text-slate-400">Chargement des résultats sociaux…</p> : <div>
        {tab === "all" && hashtags.map((h) => <button key={h.normalized || h.tag} onClick={() => setQuery(h.tag)} className="w-full border-b border-white/5 px-4 py-3 text-left"><p className="font-bold text-slate-100">{highlight(h.tag)}</p><p className="text-xs text-slate-400">{h.post_count} publications</p></button>)}
        {users.map((u) => <div key={u.id} data-testid={`user-result-${u.id}`} onClick={() => navigate(`/profile/${u.id}`)} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-white/5"><Ava pic={u.profile_pic} name={u.username} size="w-11 h-11" /><div className="min-w-0 flex-1"><p className="truncate font-bold text-slate-100">{highlight(u.username)}</p>{u.bio && <p className="truncate text-sm text-slate-400">{highlight(u.bio)}</p>}<p className="text-xs text-slate-500">{u.followers_count || 0} abonnés</p></div></div>)}
        {!!posts.length && <div className="space-y-4 px-3 py-3">{posts.map((post) => <PostCard key={post.id} post={post} currentUser={user} onUpdate={(up) => setPosts((p) => p.map((x) => x.id === up.id ? up : x))} onDelete={(id) => setPosts((p) => p.filter((x) => x.id !== id))} />)}</div>}
        {!users.length && !posts.length && !hashtags.length && <p className="px-4 py-12 text-center text-sm text-slate-400">{tab === "all" ? "Aucun résultat dans les comptes et publications." : t("searchpage.no_results", { query })}</p>}
        <div ref={sentinelRef} />{loadingMore && <p role="status" className="p-4 text-center text-slate-400">Chargement…</p>}
      </div>}
    </div>
  </div></Layout>;
}
