import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

/**
 * Salle de match live — chat léger lié à un match (foot / UCL / etc.)
 * Polling 4s tant que le panneau est ouvert.
 */
export default function MatchRoom({ match, currentUser, onClose }) {
  const { t } = useTranslation();
  const mid = match?.id || "unknown";
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const roomId = `match:${mid}`;

  const load = async () => {
    try {
      const r = await axios.get(`${API}/match-rooms/${encodeURIComponent(mid)}/messages`, {
        params: { limit: 80 },
      });
      setMessages(r.data?.messages || r.data || []);
    } catch {
      // fallback local demo thread
      setMessages((prev) => prev);
    }
  };

  useEffect(() => {
    load();
    const tmr = setInterval(load, 4000);
    return () => clearInterval(tmr);
  }, [mid]);

  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    const optimistic = {
      id: `tmp-${Date.now()}`,
      content,
      author_username: currentUser?.username || "me",
      author_id: currentUser?.id,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setText("");
    try {
      await axios.post(`${API}/match-rooms/${encodeURIComponent(mid)}/messages`, {
        content,
        room_id: roomId,
        match_label: `${match?.home || ""} vs ${match?.away || ""}`,
      });
      load();
    } catch {
      // keep optimistic if API missing
      toast.message(t("match_room.local_only"));
    } finally {
      setSending(false);
    }
  };

  const score =
    match?.state === "pre"
      ? "vs"
      : `${match?.home_score ?? 0}–${match?.away_score ?? 0}`;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col"
      style={{ background: "rgba(11,19,38,0.92)", backdropFilter: "blur(12px)" }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid rgba(34,211,238,0.15)" }}
      >
        <button type="button" onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.06)" }}>
          <span className="material-symbols-outlined text-white">close</span>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">
            {match?.home} {score} {match?.away}
          </p>
          <p className="text-[11px]" style={{ color: "#859397" }}>
            {match?.state === "in" ? "LIVE · " : ""}
            {t("match_room.title")}
            {match?.league ? ` · ${match.league}` : ""}
          </p>
        </div>
        {match?.state === "in" && (
          <span className="text-[10px] font-black px-2 py-1 rounded-full" style={{ background: "#4ade80", color: "#052e16" }}>
            LIVE
          </span>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
        {messages.length === 0 && (
          <p className="text-center text-sm py-12" style={{ color: "#859397" }}>
            {t("match_room.empty")}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex gap-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#00363e" }}
            >
              {(m.author_username || "?")[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <span className="text-[12px] font-bold" style={{ color: "#67e8f9" }}>
                {m.author_username}
              </span>
              <p className="text-[14px] text-white break-words">{m.content}</p>
            </div>
          </div>
        ))}
      </div>

      <div
        className="px-3 py-3 flex gap-2"
        style={{ borderTop: "1px solid rgba(34,211,238,0.12)", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 280))}
          placeholder={t("match_room.placeholder")}}
          className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none text-white"
          style={{ background: "#222a3d", border: "1px solid rgba(34,211,238,0.15)" }}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || sending}
          className="w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40"
          style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#00363e" }}
        >
          <span className="material-symbols-outlined">send</span>
        </button>
      </div>
    </div>
  );
}
