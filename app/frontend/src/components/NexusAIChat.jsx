// Nexus AI — assistant conversationnel intégré à la messagerie.
// Composant AUTONOME (overlay plein écran) : il n'utilise pas le flux WebSocket
// des messages classiques, juste l'endpoint /ai/chat. « L'ami de Gemini » sera
// branché côté backend (GEMINI_API_KEY) sans rien changer ici.
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { SURFACE, TEXT, ACCENT, OUTLINE } from "@/lib/theme";
import i18n from "@/i18n";

const C = {
  bg: SURFACE.deep, surface: SURFACE.base, high: SURFACE.high,
  accent: ACCENT, onAccent: TEXT.onAccent, onSurface: TEXT.primary,
  muted: TEXT.muted, outline: OUTLINE,
};

const WELCOME = {
  role: "assistant",
  text: i18n.t("aichat.welcome"),
};

export default function NexusAIChat({ onClose }) {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: "user", text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      // On envoie un historique léger (sans le message d'accueil) pour le contexte.
      const history = next.filter((m) => m !== WELCOME).map((m) => ({ role: m.role, text: m.text }));
      const r = await axios.post(`${API}/ai/chat`, { message: text, history });
      setMessages((p) => [...p, { role: "assistant", text: r.data?.reply || "…" }]);
    } catch (e) {
      const detail = e.response?.data?.detail || i18n.t("aichat.err_reply");
      setMessages((p) => [...p, { role: "assistant", text: detail }]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: C.bg }}>
      {/* En-tête */}
      <div className="flex items-center gap-3 px-4 pb-3 flex-shrink-0"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)", borderBottom: `1px solid ${C.outline}`, background: C.surface }}>
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full -ml-1" style={{ color: C.muted }}>
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${C.accent}, #3b82f6)` }}>
          <span className="material-symbols-outlined" style={{ color: C.onAccent }}>auto_awesome</span>
        </div>
        <div className="min-w-0">
          <p className="font-black flex items-center gap-1" style={{ color: C.onSurface }}>
            Nexus AI
            <span className="material-symbols-outlined text-base" style={{ color: C.accent, fontVariationSettings: "'FILL' 1" }}>verified</span>
          </p>
          <p className="text-[11px]" style={{ color: C.muted }}>{i18n.t("aichat.subtitle")}</p>
        </div>
      </div>

      {/* Fil de discussion */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-2.5">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[82%] px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words"
              style={m.role === "user"
                ? { background: `linear-gradient(135deg, ${C.accent}, #3b82f6)`, color: C.onAccent, borderRadius: "18px 18px 4px 18px" }
                : { background: C.high, color: C.onSurface, borderRadius: "18px 18px 18px 4px" }}>
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="px-4 py-3 flex gap-1" style={{ background: C.high, borderRadius: "18px 18px 18px 4px" }}>
              {[0, 1, 2].map((d) => (
                <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ background: C.muted, animationDelay: `${d * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Saisie */}
      <div className="flex items-end gap-2 px-3 pt-2 flex-shrink-0"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)", borderTop: `1px solid ${C.outline}`, background: C.surface }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder={i18n.t("aichat.placeholder")}
          className="flex-1 resize-none text-sm px-4 py-2.5 rounded-2xl outline-none max-h-32"
          style={{ background: C.high, color: C.onSurface, border: `1px solid ${C.outline}` }}
        />
        <button onClick={send} disabled={!input.trim() || sending}
          className="w-11 h-11 flex-shrink-0 rounded-full flex items-center justify-center disabled:opacity-40 transition-transform active:scale-90"
          style={{ background: `linear-gradient(135deg, ${C.accent}, #3b82f6)`, color: C.onAccent }}>
          <span className="material-symbols-outlined">send</span>
        </button>
      </div>
    </div>
  );
}
