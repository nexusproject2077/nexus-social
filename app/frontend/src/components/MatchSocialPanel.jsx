import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import axios from "axios";
import { API } from "@/App";

const REACTIONS = [
  { id: "fire", emoji: "🔥" },
  { id: "clap", emoji: "👏" },
  { id: "shock", emoji: "😱" },
  { id: "heart", emoji: "❤️" },
  { id: "angry", emoji: "😤" },
  { id: "goat", emoji: "🐐" },
];

function storageKey(matchId, suffix) {
  return `nexus_match_${matchId}_${suffix}`;
}

/**
 * Panneau social autour d'un match :
 * - Pronostic (score prédit)
 * - Sondage « qui gagne »
 * - Réactions live (émojis)
 * - Alerte buts pour équipes favorites
 * - Partager le match dans le fil
 * - Ouvrir un salon de discussion (messages)
 */
export default function MatchSocialPanel({ match, user }) {
  const { t } = useTranslation();
  const mid = match?.id || "unknown";
  const live = match?.state === "in";
  const upcoming = match?.state === "pre";
  const done = match?.state === "post";

  const [predHome, setPredHome] = useState("");
  const [predAway, setPredAway] = useState("");
  const [myPred, setMyPred] = useState(null);
  const [vote, setVote] = useState(null); // home | draw | away
  const [votes, setVotes] = useState({ home: 0, draw: 0, away: 0 });
  const [reactions, setReactions] = useState({});
  const [myReaction, setMyReaction] = useState(null);
  const [watching, setWatching] = useState(0);
  const [goalAlert, setGoalAlert] = useState(false);

  // Hydrate from localStorage (persistance légère côté client)
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(storageKey(mid, "pred")) || "null");
      if (p) { setMyPred(p); setPredHome(String(p.home)); setPredAway(String(p.away)); }
      const v = localStorage.getItem(storageKey(mid, "vote"));
      if (v) setVote(v);
      const r = localStorage.getItem(storageKey(mid, "reaction"));
      if (r) setMyReaction(r);
      const g = localStorage.getItem(storageKey(mid, "goal_alert")) === "1";
      setGoalAlert(g);
      // Votes / réactions partagés simulés (seed stable par match)
      const seed = [...mid].reduce((a, c) => a + c.charCodeAt(0), 0);
      setVotes({
        home: 40 + (seed % 50),
        draw: 15 + (seed % 20),
        away: 35 + ((seed * 3) % 45),
      });
      const base = {};
      REACTIONS.forEach((x, i) => { base[x.id] = 10 + ((seed * (i + 1)) % 80); });
      if (r) base[r] = (base[r] || 0) + 1;
      setReactions(base);
      setWatching(120 + (seed % 800) + (live ? 400 : 0));
    } catch { /* ignore */ }
  }, [mid, live]);

  const totalVotes = votes.home + votes.draw + votes.away || 1;
  const pct = (n) => Math.round((n / totalVotes) * 100);

  const savePrediction = () => {
    const h = parseInt(predHome, 10);
    const a = parseInt(predAway, 10);
    if (Number.isNaN(h) || Number.isNaN(a) || h < 0 || a < 0 || h > 20 || a > 20) {
      toast.error(t("match_social.pred_invalid"));
      return;
    }
    const p = { home: h, away: a, at: Date.now() };
    setMyPred(p);
    localStorage.setItem(storageKey(mid, "pred"), JSON.stringify(p));
    toast.success(t("match_social.pred_saved", { score: `${h}-${a}` }));
  };

  const castVote = (side) => {
    if (done) return;
    setVotes((prev) => {
      const next = { ...prev };
      if (vote && next[vote] > 0) next[vote] -= 1;
      next[side] = (next[side] || 0) + 1;
      return next;
    });
    setVote(side);
    localStorage.setItem(storageKey(mid, "vote"), side);
    toast.success(t("match_social.vote_saved"));
  };

  const react = (id) => {
    setReactions((prev) => {
      const next = { ...prev };
      if (myReaction && next[myReaction] > 0) next[myReaction] -= 1;
      next[id] = (next[id] || 0) + 1;
      return next;
    });
    setMyReaction(id);
    localStorage.setItem(storageKey(mid, "reaction"), id);
  };

  const toggleGoalAlert = () => {
    const next = !goalAlert;
    setGoalAlert(next);
    localStorage.setItem(storageKey(mid, "goal_alert"), next ? "1" : "0");
    toast.success(next ? t("match_social.alert_on") : t("match_social.alert_off"));
  };

  const shareToFeed = async () => {
    const score =
      match.state === "pre"
        ? t("match_social.upcoming")
        : `${match.home_score ?? 0} - ${match.away_score ?? 0}`;
    const text = `⚽ ${match.home} ${score} ${match.away}\n${match.league || ""} ${match.clock ? "· " + match.clock : ""}\n#NexusFoot #${(match.league_slug || "football").replace(".", "")}`;
    try {
      await axios.post(`${API}/posts`, { content: text, media_url: null, media_type: null });
      toast.success(t("match_social.shared"));
    } catch {
      // Fallback : copier
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t("match_social.copied"));
      } catch {
        toast.error(t("match_social.share_fail"));
      }
    }
  };

  const openChat = () => {
    // Préremplit un message vers soi / salon match via deep link messages
    const topic = encodeURIComponent(`match:${mid}`);
    window.location.href = `/messages?topic=${topic}&hint=${encodeURIComponent(match.home + " vs " + match.away)}`;
  };

  return (
    <div className="mt-4 space-y-4 px-1">
      {/* Social proof */}
      <div className="flex items-center justify-between text-xs" style={{ color: "#9fb0c8" }}>
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-sm" style={{ color: live ? "#4ade80" : "#9fb0c8" }}>visibility</span>
          {t("match_social.watching", { count: watching.toLocaleString() })}
        </span>
        {live && (
          <span className="flex items-center gap-1 font-bold" style={{ color: "#4ade80" }}>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#4ade80" }} />
            LIVE
          </span>
        )}
      </div>

      {/* Réactions */}
      <div>
        <p className="text-xs font-bold mb-2" style={{ color: "#c5d0e6" }}>{t("match_social.react")}</p>
        <div className="flex flex-wrap gap-2">
          {REACTIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => react(r.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-sm transition-transform active:scale-95"
              style={{
                background: myReaction === r.id ? "rgba(74,222,128,0.18)" : "rgba(255,255,255,0.06)",
                border: myReaction === r.id ? "1px solid rgba(74,222,128,0.5)" : "1px solid transparent",
              }}
            >
              <span>{r.emoji}</span>
              <span className="text-[11px] font-semibold" style={{ color: "#a7b3cc" }}>{reactions[r.id] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Sondage qui gagne */}
      {!done && (
        <div>
          <p className="text-xs font-bold mb-2" style={{ color: "#c5d0e6" }}>{t("match_social.who_wins")}</p>
          <div className="space-y-2">
            {[
              { id: "home", label: match.home },
              { id: "draw", label: t("match_social.draw") },
              { id: "away", label: match.away },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => castVote(o.id)}
                className="w-full relative overflow-hidden rounded-xl text-left px-3 py-2.5"
                style={{ background: "rgba(255,255,255,0.04)", border: vote === o.id ? "1px solid rgba(74,222,128,0.5)" : "1px solid rgba(255,255,255,0.06)" }}
              >
                <div
                  className="absolute inset-y-0 left-0 opacity-30"
                  style={{
                    width: `${pct(votes[o.id])}%`,
                    background: o.id === "draw" ? "#64748b" : "linear-gradient(90deg,#22d3ee,#4ade80)",
                  }}
                />
                <div className="relative flex justify-between text-sm font-semibold">
                  <span className="truncate pr-2">{o.label}</span>
                  <span style={{ color: "#9fb0c8" }}>{pct(votes[o.id])}%</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pronostic score (avant / pendant) */}
      {(upcoming || live) && (
        <div>
          <p className="text-xs font-bold mb-2" style={{ color: "#c5d0e6" }}>{t("match_social.predict")}</p>
          {myPred ? (
            <p className="text-sm" style={{ color: "#a7b3cc" }}>
              {t("match_social.your_pred")}: <strong className="text-white">{myPred.home} - {myPred.away}</strong>
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} max={20} value={predHome} onChange={(e) => setPredHome(e.target.value)}
                className="w-14 text-center rounded-lg py-2 text-sm font-bold outline-none"
                style={{ background: "#1a2236", color: "#fff" }}
                placeholder="0"
              />
              <span className="text-white font-black">-</span>
              <input
                type="number" min={0} max={20} value={predAway} onChange={(e) => setPredAway(e.target.value)}
                className="w-14 text-center rounded-lg py-2 text-sm font-bold outline-none"
                style={{ background: "#1a2236", color: "#fff" }}
                placeholder="0"
              />
              <button
                type="button"
                onClick={savePrediction}
                className="flex-1 py-2 rounded-xl text-sm font-bold"
                style={{ background: "linear-gradient(90deg,#22d3ee,#3b82f6)", color: "#00363e" }}
              >
                {t("match_social.lock_pred")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={shareToFeed}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold"
          style={{ background: "rgba(255,255,255,0.06)", color: "#e2e8f0" }}
        >
          <span className="material-symbols-outlined text-base">share</span>
          {t("match_social.share_feed")}
        </button>
        <button
          type="button"
          onClick={openChat}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold"
          style={{ background: "rgba(255,255,255,0.06)", color: "#e2e8f0" }}
        >
          <span className="material-symbols-outlined text-base">forum</span>
          {t("match_social.discuss")}
        </button>
        <button
          type="button"
          onClick={toggleGoalAlert}
          className="col-span-2 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold"
          style={{
            background: goalAlert ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.06)",
            color: goalAlert ? "#4ade80" : "#e2e8f0",
            border: goalAlert ? "1px solid rgba(74,222,128,0.4)" : "1px solid transparent",
          }}
        >
          <span className="material-symbols-outlined text-base">{goalAlert ? "notifications_active" : "notifications"}</span>
          {goalAlert ? t("match_social.alert_on_label") : t("match_social.alert_goals")}
        </button>
      </div>
    </div>
  );
}
