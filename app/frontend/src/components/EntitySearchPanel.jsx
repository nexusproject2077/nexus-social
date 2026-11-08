import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API } from "@/App";
import MatchCenter from "@/components/MatchCenter";
import { LEAGUES, entityError, safeArticle, matchLabel, matchDate, toMatchCenter } from "@/utils/entitySearchUtils";

const box = "rounded-2xl border border-white/10 bg-slate-900 p-4";
const button = "rounded-full border border-white/15 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-40";
function Official({ account }) {
  const navigate = useNavigate();
  if (!account?.id || account.is_verified !== true) return null;
  return <button onClick={() => navigate(`/profile/${encodeURIComponent(account.id)}`)} className="mb-3 flex w-full items-center gap-3 rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-3 text-left"><span className="material-symbols-outlined text-cyan-300" aria-hidden>verified</span><span className="min-w-0"><span className="block text-xs text-cyan-300">Compte officiel · Épinglé</span><span className="block truncate font-semibold">@{account.username}</span></span></button>;
}
function useResource(path, params) {
  const key = JSON.stringify(params);
  const identity = path + key;
  const [state, setState] = useState({ identity: "", data: null, error: "", busy: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ identity, data: null, error: "", busy: true });
    axios.get(`${API}/entity-search${path}`, { params: JSON.parse(key), signal: controller.signal }).then((r) => { if (!controller.signal.aborted) setState({ identity, data: r.data, error: "", busy: false }); }).catch((error) => { if (!controller.signal.aborted) setState({ identity, data: null, error: entityError(error), busy: false }); });
    return () => controller.abort();
  }, [path, key, identity, retry]);
  return { ...(state.identity === identity ? state : { data: null, error: "", busy: true }), retry: () => setRetry((n) => n + 1) };
}
function MatchRow({ match, club, onOpen }) {
  if (!match) return <p className="py-3 text-sm text-slate-400">Aucune rencontre disponible pour cette saison.</p>;
  return <button onClick={() => onOpen(toMatchCenter(match, club))} disabled={!/^[0-9]{3,20}$/.test(match.id || "")} className="my-2 block w-full rounded-xl border border-white/10 p-3 text-left hover:bg-white/5 disabled:cursor-default"><span className="block text-xs text-slate-400">{matchDate(match.date)} · {match.status || (match.state === "in" ? "En cours" : "")}</span><span className="mt-2 flex items-center justify-between gap-3 text-sm"><span className="min-w-0 flex-1">{match.home?.name || "Équipe non renseignée"}</span><span className="shrink-0 font-bold text-cyan-300">{matchLabel(match)}</span><span className="min-w-0 flex-1 text-right">{match.away?.name || "Équipe non renseignée"}</span></span></button>;
}
function ClubDetail({ club, onBack, currentUser }) {
  const [tab, setTab] = useState("overview"), [season, setSeason] = useState(new Date().getFullYear()), [draft, setDraft] = useState(String(new Date().getFullYear())), [page, setPage] = useState(0), [match, setMatch] = useState(null);
  const standings = tab === "standings";
  const state = tab === "results" ? "post" : tab === "upcoming" ? "pre" : "all";
  const resource = useResource(`/clubs/${encodeURIComponent(club.league)}/${encodeURIComponent(club.team_id)}/${standings ? "standings" : "matches"}`, standings ? { season } : { season, state, offset: page * 20, limit: 20 });
  const info = resource.data;
  const stat = (row, ...names) => { const entries = Object.entries(row.stats || {}); return entries.find(([key]) => names.includes(key.toLowerCase().replace(/[^a-z]/g, "")))?.[1] ?? "—"; };
  return <section aria-label={`Fiche de ${club.name}`} className={box}>
    <button className={button} onClick={onBack}>Retour aux résultats</button>
    <div className="my-4 flex items-center gap-3">{club.logo && <img src={club.logo} alt="" className="h-12 w-12 object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />}<div><h2 className="text-lg font-bold">{club.name}</h2><p className="text-xs text-slate-400">{LEAGUES.find(([id]) => id === club.league)?.[1]} · Source ESPN</p></div></div>
    <Official account={club.official_account} />
    <form className="mb-4 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); const value = Number(draft); if (Number.isInteger(value) && value >= 1900 && value <= 2100) { setSeason(value); setPage(0); } }}><label className="text-xs text-slate-400" htmlFor="entity-season">Année de saison (source)</label><input id="entity-season" type="number" required min="1900" max="2100" value={draft} onChange={(e) => setDraft(e.target.value)} className="w-24 rounded-lg bg-slate-800 px-2 py-2 text-sm" /><button type="submit" className={button}>Afficher</button></form>
    <div className="mb-3 flex gap-2 overflow-x-auto">{[["overview", "Aperçu"], ["results", "Résultats"], ["upcoming", "À venir"], ["standings", "Classement"]].map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setPage(0); }} className={`${button} shrink-0 ${tab === id ? "bg-cyan-400/15 text-cyan-300" : ""}`}>{label}</button>)}</div>
    {resource.busy ? <p role="status" className="py-6 text-slate-400">Chargement…</p> : resource.error ? <div role="alert"><p className="text-sm text-amber-300">{resource.error}</p><button className={`${button} mt-2`} onClick={resource.retry}>Réessayer</button></div> : standings ? (!info?.groups?.length ? <p className="py-4 text-sm text-slate-400">Classement indisponible pour cette saison.</p> : info.groups.map((group, index) => <div key={`${group.name}-${index}`} className="mb-4 overflow-x-auto"><h3 className="mb-2 text-sm font-semibold">{group.name || "Classement"}</h3><table className="w-full text-left text-xs"><caption className="sr-only">Classement, saison {season}</caption><thead className="text-slate-400"><tr>{["Rang", "Club", "MJ", "Diff.", "Pts"].map((title) => <th key={title} className="p-2" scope="col">{title}</th>)}</tr></thead><tbody>{group.entries.map((row) => <tr key={row.team_id} className={row.team_id === club.team_id ? "bg-cyan-400/15 text-cyan-200" : "border-t border-white/5"}><td className="p-2">{stat(row, "rank", "playoffseed")}</td><th scope="row" className="p-2 font-medium">{row.name}</th><td className="p-2">{stat(row, "gamesplayed")}</td><td className="p-2">{stat(row, "pointdifferential", "goaldifference")}</td><td className="p-2">{stat(row, "points")}</td></tr>)}</tbody></table></div>)) : tab === "overview" ? <><h3 className="mt-4 text-sm font-semibold">Dernier match terminé</h3><MatchRow match={info?.last_match} club={club} onOpen={setMatch} /><h3 className="mt-4 text-sm font-semibold">Prochain match</h3><MatchRow match={info?.next_match} club={club} onOpen={setMatch} />{(info?.items || []).filter((item) => item.state === "in").map((item) => <MatchRow key={item.id} match={item} club={club} onOpen={setMatch} />)}</> : <>{!info?.items?.length && <p className="py-4 text-sm text-slate-400">Aucune rencontre disponible.</p>}{(info?.items || []).map((item) => <MatchRow key={item.id} match={item} club={club} onOpen={setMatch} />)}<div className="mt-3 flex items-center justify-between gap-2"><button className={button} disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Précédent</button><span className="text-xs text-slate-400">Page {page + 1}</span><button className={button} disabled={!info?.has_more} onClick={() => setPage((n) => n + 1)}>Suivant</button></div></>}
    <p className="mt-4 text-[11px] text-slate-500">Couverture limitée aux données fournies pour la compétition et la saison sélectionnées. Les horaires suivent le fuseau de ton appareil.</p>
    {match && <MatchCenter match={match} currentUser={currentUser} onClose={() => setMatch(null)} />}
  </section>;
}
export default function EntitySearchPanel({ query, mode, currentUser }) {
  const [league, setLeague] = useState("fra.1"), [selected, setSelected] = useState(null), [retry, setRetry] = useState(0);
  const [sections, setSections] = useState([]), [busy, setBusy] = useState(true);
  useEffect(() => {
    if (query.length < 2 || query.length > 80) { setSections([]); setBusy(false); return; }
    const controller = new AbortController();
    setBusy(true); setSections([]);
    const timer = setTimeout(async () => {
      const kinds = mode === "clubs" ? ["club"] : mode === "figures" ? ["person"] : ["club", "person"];
      const results = await Promise.all(kinds.map(async (kind) => { try { const r = await axios.get(`${API}/entity-search`, { params: { q: query, kind, ...(kind === "club" ? { league } : {}) }, signal: controller.signal }); return { kind, items: Array.isArray(r.data?.items) ? r.data.items : [], error: "" }; } catch (error) { return { kind, items: [], error: entityError(error) }; } }));
      if (!controller.signal.aborted) { setSections(results); setBusy(false); }
    }, 650);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, mode, league, retry]);
  if (query.length < 2 || query.length > 80) return <p className="p-4 text-sm text-slate-400">Les fiches acceptent une recherche de 2 à 80 caractères.</p>;
  if (selected) return <div className="p-3 text-slate-100"><ClubDetail key={selected.id} club={selected} onBack={() => setSelected(null)} currentUser={currentUser} /></div>;
  const pinned = [...new Map(sections.flatMap((section) => section.items).filter((item) => item.official_account?.id && item.official_account.is_verified === true).map((item) => [item.official_account.id, item.official_account])).values()];
  return <section aria-label="Fiches clubs et personnalités" className="space-y-3 border-b border-white/10 p-3 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Fiches informatives</h2>{mode !== "figures" && <label className="text-xs text-slate-400">Championnat <select aria-label="Championnat des clubs recherchés" value={league} onChange={(e) => { setLeague(e.target.value); setSelected(null); }} className="rounded-lg bg-slate-800 p-2 text-slate-100">{LEAGUES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}</div>
    {pinned.map((account) => <Official key={account.id} account={account} />)}
    {busy && <p role="status" className="py-3 text-sm text-slate-400">Recherche des fiches…</p>}
    {!busy && sections.map((section) => <div key={section.kind}><h3 className="mb-2 text-xs uppercase tracking-wide text-slate-400">{section.kind === "club" ? "Clubs du championnat sélectionné" : "Personnalités · Wikidata"}</h3>{section.error ? <div role="alert" className="mb-3 text-sm text-amber-300"><p>{section.error}</p><button className={`${button} mt-2`} onClick={() => setRetry((n) => n + 1)}>Réessayer les fiches</button></div> : !section.items.length ? <p className="mb-3 text-sm text-slate-400">Aucune fiche trouvée.</p> : section.items.map((item) => section.kind === "club" ? <button key={item.id} onClick={() => setSelected(item)} className={`${box} mb-2 flex w-full items-center gap-3 text-left hover:border-cyan-400/40`}>{item.logo && <img src={item.logo} alt="" className="h-10 w-10 object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />}<span><span className="block font-semibold">{item.name}</span><span className="text-xs text-slate-400">Résultats · Calendrier · Classement</span></span></button> : <article key={item.id} className={`${box} mb-2`}><h4 className="font-semibold">{item.name}</h4><p className="mt-1 text-sm text-slate-400">{item.description}</p><dl className="my-3 flex flex-wrap gap-5 text-sm"><div><dt className="text-xs text-slate-400">{item.age_at_death ? "Âge au décès" : "Âge"}</dt><dd>{item.age != null ? `${item.age} ans` : "Non renseigné"}</dd></div><div><dt className="text-xs text-slate-400">Taille</dt><dd>{item.height_m != null ? `${Number(item.height_m).toLocaleString("fr-FR")} m` : "Non renseignée"}</dd></div>{item.birth_date && <div><dt className="text-xs text-slate-400">Naissance</dt><dd>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${item.birth_date}T00:00:00Z`))}</dd></div>}</dl><div className="flex gap-4 text-xs text-cyan-300">{/^wikidata:Q[0-9]+$/.test(item.id) && <a href={`https://www.wikidata.org/wiki/${item.id.split(":")[1]}`} target="_blank" rel="noopener noreferrer">Source Wikidata</a>}{safeArticle(item.article_url) && <a href={safeArticle(item.article_url)} target="_blank" rel="noopener noreferrer">Wikipédia</a>}</div><p className="mt-2 text-[11px] text-slate-500">Fiche informative, distincte d’un compte Nexus. Données manquantes non estimées.</p></article>)}</div>)}
  </section>;
}
