import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
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
      const r = await axios.get(
        `${API}/match-rooms/${encodeURIComponent(mid)}/messages`,
        {
          params: { limit: 80 },
        },
      );
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
    listRef.current?.scrollTo?.({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

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
      await axios.post(
        `${API}/match-rooms/${encodeURIComponent(mid)}/messages`,
        {
          content,
          room_id: roomId,
          match_label: `${match?.home || ""} vs ${match?.away || ""}`,
        },
      );
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

  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-stretch justify-center bg-black/80 p-0 sm:items-center sm:p-6" style={{ backdropFilter: "blur(10px)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="flex h-[100dvh] w-full flex-col overflow-hidden bg-black sm:h-[min(780px,calc(100dvh-3rem))] sm:max-w-3xl sm:rounded-3xl" style={{ border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 24px 80px rgba(0,0,0,0.72)" }}>
      <header className="flex items-center gap-3 px-4 py-3 sm:px-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", background: "#050505", paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 rounded-full flex items-center justify-center active:scale-95"
          style={{ background: "#181818" }}
          aria-label="Fermer la salle du match"
        >
          <span className="material-symbols-outlined text-white">close</span>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">
            {match?.home} {score} {match?.away}
          </p>
          <p className="text-[11px]" style={{ color: "#a3a3a3" }}>
            {match?.state === "in" ? "LIVE · " : ""}
            {t("match_room.title")}
            {match?.league ? ` · ${match.league}` : ""}
          </p>
        </div>
        {match?.state === "in" ? (
          <span
            className="text-[10px] font-black px-2 py-1 rounded-full"
            style={{ background: "#4ade80", color: "#052e16" }}
          >
            LIVE
          </span>
        ) : <span className="text-[11px] font-semibold" style={{ color: "#a3a3a3" }}>Discussion</span>}
      </header>

      <main
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 py-5 space-y-4 sm:px-7"
        style={{ overscrollBehavior: "contain" }}
      >
        {messages.length === 0 && (
          <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center pb-20 text-center">
            <span className="material-symbols-outlined mb-3 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: "#151515", color: "#d4d4d4" }}>forum</span>
            <p className="text-sm font-semibold text-white">{t("match_room.empty")}</p>
            <p className="mt-1 text-xs" style={{ color: "#a3a3a3" }}>Partage ton pronostic ou réagis au match avec les autres supporters.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex gap-3">
            {m.author_profile_pic ? <img src={m.author_profile_pic} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" /> : <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: "#242424", color: "#f5f5f5" }}>{(m.author_username || "?")[0]?.toUpperCase()}</div>}
            <div className="min-w-0">
              <span
                className="text-[12px] font-bold"
                style={{ color: "#e5e5e5" }}
              >
                {m.author_username}
              </span>
              <p className="mt-0.5 text-[14px] text-white break-words leading-relaxed">{m.content}</p>
            </div>
          </div>
        ))}
      </main>

      <footer
        className="px-3 py-3 flex gap-2 sm:px-5"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.1)",
          background: "#050505",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 280))}
          placeholder={t("match_room.placeholder")}
          className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none text-white"
          style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.12)" }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || sending}
          className="w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40"
          style={{ background: "#f5f5f5", color: "#050505" }}
        >
          <span className="material-symbols-outlined">send</span>
        </button>
      </footer>
      </section>
    </div>,
    document.body,
  );
}
