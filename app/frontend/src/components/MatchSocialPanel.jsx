import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import axios from "axios";
import { API } from "@/App";

/* ─── Premium SVG icons (Nexus style) ─── */
const Icon = ({ children, size = 18, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden
  >
    {children}
  </svg>
);

const FireIcon = ({ size = 18 }) => (
  <Icon size={size}>
    <path
      d="M12 2c.4 2.2-.3 3.8-1.5 5.2C9 8.8 8 10.2 8 12.2c0 2.3 1.6 4 3.5 4.6-.2-.6-.3-1.2-.2-1.9.3-1.5 1.3-2.5 2.7-3.5 1.2 1.4 2 3 2 4.8 0 3.6-2.5 6-5.5 6S5 19.8 5 16.2C5 11.5 8.2 8.2 12 2z"
      fill="url(#nxFire)"
    />
    <path
      d="M12.2 14.5c.15 1 .8 1.7 1.8 2.1-.7.5-1.6.7-2.5.7-2 0-3.5-1.4-3.5-3.3 0-1.2.6-2.2 1.6-3 1.1 1 1.9 2.1 2.6 3.5z"
      fill="url(#nxFire2)"
      opacity=".9"
    />
    <defs>
      <linearGradient
        id="nxFire"
        x1="5"
        y1="2"
        x2="18"
        y2="22"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fb923c" />
        <stop offset=".5" stopColor="#f97316" />
        <stop offset="1" stopColor="#ef4444" />
      </linearGradient>
      <linearGradient
        id="nxFire2"
        x1="8"
        y1="12"
        x2="14"
        y2="18"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fde68a" />
        <stop offset="1" stopColor="#fb923c" />
      </linearGradient>
    </defs>
  </Icon>
);

const ClapIcon = ({ size = 18 }) => (
  <Icon size={size}>
    <path
      d="M11.2 3.4c.5-.6 1.4-.6 1.9 0l.4.5c.3.4.2 1-.2 1.3L9.5 8.2l1.1-3.8c.1-.5-.1-1-.5-1.2l-.9-.5z"
      fill="#fbbf24"
    />
    <path
      d="M8.8 4.2c.4-.7 1.3-.8 1.9-.3l.3.3c.4.3.4.9.1 1.3L7.6 9.1l.7-3.5c.1-.5-.1-1-.5-1.2l-.9-.2z"
      fill="#f59e0b"
    />
    <path
      d="M6.2 8.5c-.4.3-.5.9-.2 1.3l3.8 5.2c.9 1.2 2.3 1.9 3.8 1.9h1.2c2.3 0 4.2-1.9 4.2-4.2v-.3c0-.7-.2-1.3-.6-1.9l-2.8-3.6c-.3-.4-.9-.5-1.3-.2l-.4.3c-.4.3-.5.9-.2 1.3l.9 1.2-3.5-4.8c-.3-.4-.9-.5-1.3-.2l-.4.3c-.4.3-.5.9-.2 1.3l2.2 3-2.8-3.8c-.3-.4-.9-.5-1.3-.2l-.4.3z"
      fill="url(#nxClap)"
    />
    <defs>
      <linearGradient
        id="nxClap"
        x1="6"
        y1="7"
        x2="18"
        y2="18"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fde68a" />
        <stop offset="1" stopColor="#f59e0b" />
      </linearGradient>
    </defs>
  </Icon>
);

const ShockIcon = ({ size = 18 }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" fill="url(#nxShock)" />
    <circle cx="9" cy="10" r="1.3" fill="#0f172a" />
    <circle cx="15" cy="10" r="1.3" fill="#0f172a" />
    <ellipse cx="12" cy="15.2" rx="2.2" ry="2.8" fill="#0f172a" />
    <path
      d="M8.5 7.2c.6-.5 1.4-.5 2 0M13.5 7.2c.6-.5 1.4-.5 2 0"
      stroke="#0f172a"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <defs>
      <linearGradient
        id="nxShock"
        x1="4"
        y1="3"
        x2="20"
        y2="21"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fef08a" />
        <stop offset="1" stopColor="#facc15" />
      </linearGradient>
    </defs>
  </Icon>
);

const HeartIcon = ({ size = 18 }) => (
  <Icon size={size}>
    <path
      d="M12 20.4s-7.2-4.4-7.2-9.2A3.9 3.9 0 0 1 12 8.2a3.9 3.9 0 0 1 7.2 3c0 4.8-7.2 9.2-7.2 9.2z"
      fill="url(#nxHeart)"
    />
    <defs>
      <linearGradient
        id="nxHeart"
        x1="5"
        y1="6"
        x2="19"
        y2="20"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fb7185" />
        <stop offset="1" stopColor="#e11d48" />
      </linearGradient>
    </defs>
  </Icon>
);

const AngryIcon = ({ size = 18 }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" fill="url(#nxAngry)" />
    <path
      d="M7.5 9.2l3.2 1.2M16.5 9.2l-3.2 1.2"
      stroke="#0f172a"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <circle cx="9" cy="11.5" r="1.2" fill="#0f172a" />
    <circle cx="15" cy="11.5" r="1.2" fill="#0f172a" />
    <path
      d="M9 16.2c1.2-1 4.8-1 6 0"
      stroke="#0f172a"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <defs>
      <linearGradient
        id="nxAngry"
        x1="4"
        y1="3"
        x2="20"
        y2="21"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fb923c" />
        <stop offset="1" stopColor="#ea580c" />
      </linearGradient>
    </defs>
  </Icon>
);

const GoatIcon = ({ size = 18 }) => (
  <Icon size={size}>
    <path
      d="M7 11c0-2.5 1.5-4.5 3.2-5.2L9 3.5c.8.2 1.5.8 2 1.6.5-.8 1.2-1.4 2-1.6l-1.2 2.3C13.5 6.5 15 8.5 15 11c0 1.2-.3 2.2-.8 3H18v1.5h-3.2c-.7 1.5-2 2.5-3.8 2.5S8 17 7.2 15.5H4V14h3.8c-.5-.8-.8-1.8-.8-3z"
      fill="url(#nxGoat)"
    />
    <circle cx="10" cy="10.5" r="0.9" fill="#0f172a" />
    <circle cx="14" cy="10.5" r="0.9" fill="#0f172a" />
    <path
      d="M11.2 13h1.6"
      stroke="#0f172a"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <defs>
      <linearGradient
        id="nxGoat"
        x1="4"
        y1="3"
        x2="18"
        y2="18"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#e2e8f0" />
        <stop offset="1" stopColor="#94a3b8" />
      </linearGradient>
    </defs>
  </Icon>
);

const BallIcon = ({ size = 16 }) => (
  <Icon size={size}>
    <circle
      cx="12"
      cy="12"
      r="9"
      fill="url(#nxBall)"
      stroke="rgba(255,255,255,0.2)"
      strokeWidth="1"
    />
    <path
      d="M12 3.5v17M3.5 12h17M6.2 6.2c2.5 1.2 5.1 1.2 7.6 0M6.2 17.8c2.5-1.2 5.1-1.2 7.6 0M6.2 6.2c-1.2 2.5-1.2 5.1 0 7.6M17.8 6.2c1.2 2.5 1.2 5.1 0 7.6"
      stroke="#0f172a"
      strokeWidth="1"
      opacity=".55"
    />
    <defs>
      <linearGradient
        id="nxBall"
        x1="4"
        y1="3"
        x2="20"
        y2="21"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#f8fafc" />
        <stop offset="1" stopColor="#cbd5e1" />
      </linearGradient>
    </defs>
  </Icon>
);

const REACTIONS = [
  { id: "fire", Icon: FireIcon, label: "fire" },
  { id: "clap", Icon: ClapIcon, label: "clap" },
  { id: "shock", Icon: ShockIcon, label: "shock" },
  { id: "heart", Icon: HeartIcon, label: "heart" },
  { id: "angry", Icon: AngryIcon, label: "angry" },
  { id: "goat", Icon: GoatIcon, label: "goat" },
];

function storageKey(matchId, suffix) {
  return `nexus_match_${matchId}_${suffix}`;
}

export default function MatchSocialPanel({ match }) {
  const { t } = useTranslation();
  const mid = match?.id || "unknown";
  const live = match?.state === "in";
  const upcoming = match?.state === "pre";
  const done = match?.state === "post";

  const [predHome, setPredHome] = useState("");
  const [predAway, setPredAway] = useState("");
  const [myPred, setMyPred] = useState(null);
  const [vote, setVote] = useState(null);
  const [votes, setVotes] = useState({ home: 0, draw: 0, away: 0 });
  const [reactions, setReactions] = useState({});
  const [myReaction, setMyReaction] = useState(null);
  const [watching, setWatching] = useState(0);
  const [goalAlert, setGoalAlert] = useState(false);

  useEffect(() => {
    try {
      const p = JSON.parse(
        localStorage.getItem(storageKey(mid, "pred")) || "null",
      );
      if (p) {
        setMyPred(p);
        setPredHome(String(p.home));
        setPredAway(String(p.away));
      }
      const v = localStorage.getItem(storageKey(mid, "vote"));
      if (v) setVote(v);
      const r = localStorage.getItem(storageKey(mid, "reaction"));
      if (r) setMyReaction(r);
      setGoalAlert(localStorage.getItem(storageKey(mid, "goal_alert")) === "1");
      const seed = [...String(mid)].reduce((a, c) => a + c.charCodeAt(0), 0);
      setVotes({
        home: 40 + (seed % 50),
        draw: 15 + (seed % 20),
        away: 35 + ((seed * 3) % 45),
      });
      const base = {};
      REACTIONS.forEach((x, i) => {
        base[x.id] = 10 + ((seed * (i + 1)) % 80);
      });
      if (r) base[r] = (base[r] || 0) + 1;
      setReactions(base);
      setWatching(120 + (seed % 800) + (live ? 400 : 0));
    } catch {
      /* ignore */
    }
  }, [mid, live]);

  const totalVotes = votes.home + votes.draw + votes.away || 1;
  const pct = (n) => Math.round((n / totalVotes) * 100);

  const savePrediction = () => {
    const h = parseInt(predHome, 10);
    const a = parseInt(predAway, 10);
    if (
      Number.isNaN(h) ||
      Number.isNaN(a) ||
      h < 0 ||
      a < 0 ||
      h > 20 ||
      a > 20
    ) {
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
    toast.success(
      next ? t("match_social.alert_on") : t("match_social.alert_off"),
    );
  };

  const shareToFeed = async () => {
    const score =
      match.state === "pre"
        ? t("match_social.upcoming")
        : `${match.home_score ?? 0} - ${match.away_score ?? 0}`;
    const text = `${match.home} ${score} ${match.away}\n${match.league || ""} ${match.clock ? "· " + match.clock : ""}\n#NexusFoot`;
    try {
      await axios.post(`${API}/posts`, {
        content: text,
        media_url: null,
        media_type: null,
      });
      toast.success(t("match_social.shared"));
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t("match_social.copied"));
      } catch {
        toast.error(t("match_social.share_fail"));
      }
    }
  };

  const openChat = () => {
    const topic = encodeURIComponent(`match:${mid}`);
    window.location.href = `/messages?topic=${topic}&hint=${encodeURIComponent(match.home + " vs " + match.away)}`;
  };

  return (
    <div className="mt-4 space-y-4 px-1 pb-2">
      {/* Social proof */}
      <div
        className="flex items-center justify-between text-xs"
        style={{ color: "#9fb0c8" }}
      >
        <span className="flex items-center gap-1.5">
          <span
            className="material-symbols-outlined text-sm"
            style={{ color: live ? "#4ade80" : "#9fb0c8" }}
          >
            visibility
          </span>
          {t("match_social.watching", { count: watching.toLocaleString() })}
        </span>
        {live && (
          <span
            className="flex items-center gap-1.5 font-bold tracking-wide"
            style={{ color: "#4ade80" }}
          >
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: "#4ade80" }}
            />
            LIVE
          </span>
        )}
      </div>

      {/* Reactions — SVG only */}
      <div>
        <p
          className="text-xs font-bold mb-2 flex items-center gap-1.5"
          style={{ color: "#c5d0e6" }}
        >
          <BallIcon size={14} />
          {t("match_social.react")}
        </p>
        <div className="flex flex-wrap gap-2">
          {REACTIONS.map((r) => {
            const Ico = r.Icon;
            const active = myReaction === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => react(r.id)}
                aria-label={r.label}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-all active:scale-95"
                style={{
                  background: active
                    ? "rgba(34,211,238,0.14)"
                    : "rgba(255,255,255,0.05)",
                  border: active
                    ? "1px solid rgba(34,211,238,0.45)"
                    : "1px solid rgba(255,255,255,0.06)",
                  boxShadow: active ? "0 0 12px rgba(34,211,238,0.15)" : "none",
                }}
              >
                <Ico size={18} />
                <span
                  className="text-[11px] font-bold tabular-nums"
                  style={{ color: active ? "#67e8f9" : "#a7b3cc" }}
                >
                  {reactions[r.id] || 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Poll */}
      {!done && (
        <div>
          <p className="text-xs font-bold mb-2" style={{ color: "#c5d0e6" }}>
            {t("match_social.who_wins")}
          </p>
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
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border:
                    vote === o.id
                      ? "1px solid rgba(34,211,238,0.5)"
                      : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div
                  className="absolute inset-y-0 left-0 opacity-25"
                  style={{
                    width: `${pct(votes[o.id])}%`,
                    background:
                      o.id === "draw"
                        ? "#64748b"
                        : "linear-gradient(90deg,#22d3ee,#3b82f6)",
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

      {/* Prediction */}
      {(upcoming || live) && (
        <div>
          <p className="text-xs font-bold mb-2" style={{ color: "#c5d0e6" }}>
            {t("match_social.predict")}
          </p>
          {myPred ? (
            <p className="text-sm" style={{ color: "#a7b3cc" }}>
              {t("match_social.your_pred")}:{" "}
              <strong className="text-white">
                {myPred.home} - {myPred.away}
              </strong>
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={20}
                value={predHome}
                onChange={(e) => setPredHome(e.target.value)}
                className="w-14 text-center rounded-lg py-2 text-sm font-bold outline-none"
                style={{ background: "#1a2236", color: "#fff" }}
                placeholder="0"
              />
              <span className="text-white font-black">-</span>
              <input
                type="number"
                min={0}
                max={20}
                value={predAway}
                onChange={(e) => setPredAway(e.target.value)}
                className="w-14 text-center rounded-lg py-2 text-sm font-bold outline-none"
                style={{ background: "#1a2236", color: "#fff" }}
                placeholder="0"
              />
              <button
                type="button"
                onClick={savePrediction}
                className="flex-1 py-2 rounded-xl text-sm font-bold"
                style={{
                  background: "linear-gradient(90deg,#22d3ee,#3b82f6)",
                  color: "#00363e",
                }}
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
            background: goalAlert
              ? "rgba(34,211,238,0.12)"
              : "rgba(255,255,255,0.06)",
            color: goalAlert ? "#67e8f9" : "#e2e8f0",
            border: goalAlert
              ? "1px solid rgba(34,211,238,0.4)"
              : "1px solid transparent",
          }}
        >
          <span className="material-symbols-outlined text-base">
            {goalAlert ? "notifications_active" : "notifications"}
          </span>
          {goalAlert
            ? t("match_social.alert_on_label")
            : t("match_social.alert_goals")}
        </button>
      </div>
    </div>
  );
}
