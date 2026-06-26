import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { toast } from "sonner";

const ACCENT = "linear-gradient(90deg,#22d3ee,#3b82f6)";
const BG = "#0b1326";
const PANEL = "#131b2e";
const PANEL2 = "#0f1729";
const TEXT = "#dae2fd";
const MUTED = "#859397";

const FOLDERS = [
  { id: "inbox", label: "Boîte de réception", icon: "inbox" },
  { id: "starred", label: "Favoris", icon: "star" },
  { id: "sent", label: "Envoyés", icon: "send" },
  { id: "drafts", label: "Brouillons", icon: "draft" },
  { id: "archive", label: "Archives", icon: "archive" },
  { id: "trash", label: "Corbeille", icon: "delete" },
];

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function Avatar({ name, pic, size = 40 }) {
  if (pic) {
    return (
      <img
        src={pic}
        alt={name}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: ACCENT,
        color: "#00363e",
        fontSize: size * 0.4,
      }}
    >
      {(name || "?")[0].toUpperCase()}
    </div>
  );
}

export default function MailPage({ user }) {
  const [mailbox, setMailbox] = useState(null);
  const [counts, setCounts] = useState({});
  const [folder, setFolder] = useState("inbox");
  const [mails, setMails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [compose, setCompose] = useState(null); // {to, cc, subject, body, draft_id, reply_to}
  const [sending, setSending] = useState(false);

  const refreshMeta = useCallback(async () => {
    try {
      const [me, c] = await Promise.all([
        axios.get(`${API}/mail/me`),
        axios.get(`${API}/mail/counts`),
      ]);
      setMailbox(me.data);
      setCounts(c.data);
    } catch (e) {
      /* silencieux */
    }
  }, []);

  const loadFolder = useCallback(async (f) => {
    setLoading(true);
    setSelected(null);
    setSearching(false);
    try {
      const res = await axios.get(`${API}/mail/folder/${f}`);
      setMails(res.data);
    } catch (e) {
      toast.error("Impossible de charger les e-mails");
      setMails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMeta();
  }, [refreshMeta]);

  useEffect(() => {
    loadFolder(folder);
  }, [folder, loadFolder]);

  const openMail = async (mail) => {
    if (mail.is_draft) {
      setCompose({
        to: (mail.to || []).join(", "),
        cc: (mail.cc || []).join(", "),
        subject: mail.subject === "(sans objet)" ? "" : mail.subject,
        body: mail.body || "",
        draft_id: mail.id,
      });
      return;
    }
    try {
      const res = await axios.get(`${API}/mail/${mail.id}`);
      setSelected(res.data);
      if (!mail.is_read && mail.direction === "received") {
        setMails((prev) =>
          prev.map((m) => (m.id === mail.id ? { ...m, is_read: true } : m))
        );
        refreshMeta();
      }
    } catch (e) {
      toast.error("E-mail introuvable");
    }
  };

  const doSearch = async (e) => {
    e.preventDefault();
    if (!search.trim()) {
      setSearching(false);
      loadFolder(folder);
      return;
    }
    setLoading(true);
    setSelected(null);
    setSearching(true);
    try {
      const res = await axios.get(`${API}/mail/search`, { params: { q: search.trim() } });
      setMails(res.data);
    } catch (e) {
      toast.error("Recherche échouée");
    } finally {
      setLoading(false);
    }
  };

  const toggleStar = async (mail, e) => {
    e.stopPropagation();
    try {
      const res = await axios.put(`${API}/mail/${mail.id}/star`);
      setMails((prev) =>
        prev.map((m) => (m.id === mail.id ? { ...m, is_starred: res.data.starred } : m))
      );
      if (selected?.id === mail.id) setSelected({ ...selected, is_starred: res.data.starred });
      if (folder === "starred" && !res.data.starred) {
        setMails((prev) => prev.filter((m) => m.id !== mail.id));
      }
      refreshMeta();
    } catch (e) {
      toast.error("Action impossible");
    }
  };

  const mailAction = async (mail, action, opts = {}) => {
    try {
      if (action === "delete") {
        await axios.delete(`${API}/mail/${mail.id}`);
        toast.success("Supprimé définitivement");
      } else {
        await axios.put(`${API}/mail/${mail.id}/${action}`, opts.body);
        toast.success(
          { trash: "Déplacé dans la corbeille", archive: "Archivé", restore: "Restauré", read: "Marqué" }[
            action
          ] || "Fait"
        );
      }
      setMails((prev) => prev.filter((m) => m.id !== mail.id));
      if (selected?.id === mail.id) setSelected(null);
      refreshMeta();
    } catch (e) {
      toast.error("Action impossible");
    }
  };

  const openCompose = (preset = {}) =>
    setCompose({ to: "", cc: "", subject: "", body: "", ...preset });

  const replyTo = (mail) => {
    setSelected(null);
    openCompose({
      to: mail.sender_email,
      subject: mail.subject?.startsWith("Re:") ? mail.subject : `Re: ${mail.subject}`,
      body: `\n\n---\nLe ${timeAgo(mail.created_at)}, ${mail.sender_username} a écrit :\n> ${(mail.body || "").split("\n").join("\n> ")}`,
      reply_to: mail.id,
    });
  };

  const forward = (mail) => {
    setSelected(null);
    openCompose({
      subject: mail.subject?.startsWith("Tr:") ? mail.subject : `Tr: ${mail.subject}`,
      body: `\n\n--- Message transféré ---\nDe : ${mail.sender_email}\nObjet : ${mail.subject}\n\n${mail.body || ""}`,
    });
  };

  const parseAddrs = (str) =>
    (str || "")
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const sendMail = async () => {
    const to = parseAddrs(compose.to);
    if (to.length === 0) return toast.error("Ajoutez au moins un destinataire");
    setSending(true);
    try {
      const res = await axios.post(`${API}/mail/send`, {
        to,
        cc: parseAddrs(compose.cc),
        subject: compose.subject,
        body: compose.body,
        draft_id: compose.draft_id,
        reply_to: compose.reply_to,
      });
      if (res.data.warning) toast.warning(res.data.warning);
      toast.success("E-mail envoyé ✉️");
      setCompose(null);
      refreshMeta();
      if (["sent", "drafts"].includes(folder)) loadFolder(folder);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Envoi échoué");
    } finally {
      setSending(false);
    }
  };

  const saveDraft = async () => {
    if (!compose.to && !compose.subject && !compose.body) {
      setCompose(null);
      return;
    }
    try {
      await axios.post(`${API}/mail/draft`, {
        draft_id: compose.draft_id,
        to: parseAddrs(compose.to),
        cc: parseAddrs(compose.cc),
        subject: compose.subject,
        body: compose.body,
      });
      toast.success("Brouillon enregistré");
      setCompose(null);
      refreshMeta();
      if (folder === "drafts") loadFolder(folder);
    } catch (e) {
      toast.error("Brouillon non enregistré");
    }
  };

  return (
    <Layout user={user} compact>
      <div className="max-w-6xl mx-auto px-3 lg:px-6 py-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1
              className="font-headline text-3xl font-black tracking-tight bg-clip-text"
              style={{ background: ACCENT, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
            >
              Nexus Mail
            </h1>
            {mailbox && (
              <p className="text-sm mt-1 flex items-center gap-2" style={{ color: MUTED }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>alternate_email</span>
                {mailbox.email}
              </p>
            )}
          </div>
          <form onSubmit={doSearch} className="relative w-full sm:w-72">
            <span
              className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: MUTED, fontSize: 18 }}
            >
              search
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher dans les e-mails..."
              className="w-full border-none rounded-xl py-2.5 pl-10 pr-4 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40 placeholder:text-slate-500"
              style={{ backgroundColor: PANEL, color: TEXT }}
            />
          </form>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5">
          {/* Sidebar dossiers */}
          <aside>
            <button
              onClick={() => openCompose()}
              className="w-full py-3.5 font-headline font-bold rounded-xl transition-all active:scale-95 hover:opacity-90 text-sm flex items-center justify-center gap-2 mb-4"
              style={{ background: ACCENT, color: "#00363e", boxShadow: "0 8px 20px rgba(34,211,238,0.2)" }}
            >
              <span className="material-symbols-outlined">edit</span>
              Nouveau message
            </button>
            <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
              {FOLDERS.map((f) => {
                const active = folder === f.id && !searching;
                const badge =
                  f.id === "inbox" ? counts.inbox_unread : f.id === "drafts" ? counts.drafts : 0;
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      setSearch("");
                      setFolder(f.id);
                    }}
                    className="flex items-center gap-3 py-2.5 px-4 rounded-xl transition-all text-left whitespace-nowrap"
                    style={{
                      color: active ? "#22d3ee" : MUTED,
                      fontWeight: active ? 700 : 400,
                      background: active
                        ? "linear-gradient(to right, rgba(34,211,238,0.12), transparent)"
                        : "transparent",
                      borderLeft: active ? "2px solid #22d3ee" : "2px solid transparent",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0", fontSize: 20 }}
                    >
                      {f.icon}
                    </span>
                    <span className="text-sm flex-1">{f.label}</span>
                    {badge > 0 && (
                      <span
                        className="text-[10px] font-bold rounded-full px-2 py-0.5"
                        style={{ background: "rgba(34,211,238,0.2)", color: "#22d3ee" }}
                      >
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Liste / lecture */}
          <section
            className="rounded-2xl overflow-hidden min-h-[60vh]"
            style={{ backgroundColor: PANEL, border: "1px solid rgba(255,255,255,0.05)" }}
          >
            {selected ? (
              <MailReader
                mail={selected}
                folder={folder}
                onBack={() => setSelected(null)}
                onStar={(e) => toggleStar(selected, e)}
                onAction={mailAction}
                onReply={() => replyTo(selected)}
                onForward={() => forward(selected)}
              />
            ) : (
              <MailList
                mails={mails}
                loading={loading}
                folder={folder}
                searching={searching}
                onOpen={openMail}
                onStar={toggleStar}
                onAction={mailAction}
              />
            )}
          </section>
        </div>
      </div>

      {compose && (
        <ComposeWindow
          compose={compose}
          setCompose={setCompose}
          onSend={sendMail}
          onSaveDraft={saveDraft}
          onClose={() => setCompose(null)}
          sending={sending}
        />
      )}
    </Layout>
  );
}

function MailList({ mails, loading, folder, searching, onOpen, onStar, onAction }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-400" />
      </div>
    );
  }
  if (mails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3" style={{ color: MUTED }}>
        <span className="material-symbols-outlined" style={{ fontSize: 56, opacity: 0.4 }}>
          {searching ? "search_off" : "mail"}
        </span>
        <p className="text-sm">{searching ? "Aucun résultat" : "Aucun e-mail ici"}</p>
      </div>
    );
  }
  return (
    <ul>
      {mails.map((m) => {
        const showName =
          m.direction === "received"
            ? m.sender_username
            : `À : ${(m.to_names || []).join(", ") || "—"}`;
        const unread = !m.is_read && m.direction === "received";
        return (
          <li
            key={m.id}
            onClick={() => onOpen(m)}
            className="group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-white/[0.03]"
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              background: unread ? "rgba(34,211,238,0.04)" : "transparent",
            }}
          >
            <button onClick={(e) => onStar(m, e)} className="flex-shrink-0">
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 20,
                  color: m.is_starred ? "#fbbf24" : MUTED,
                  fontVariationSettings: m.is_starred ? "'FILL' 1" : "'FILL' 0",
                }}
              >
                star
              </span>
            </button>
            <Avatar
              name={m.direction === "received" ? m.sender_username : (m.to_names || [])[0]}
              pic={m.direction === "received" ? m.sender_profile_pic : null}
              size={36}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-sm truncate"
                  style={{ color: unread ? TEXT : "#aab4d4", fontWeight: unread ? 700 : 500 }}
                >
                  {showName}
                </span>
                <span className="text-[11px] flex-shrink-0" style={{ color: MUTED }}>
                  {timeAgo(m.created_at)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className="text-sm truncate"
                  style={{ color: unread ? TEXT : MUTED, fontWeight: unread ? 600 : 400 }}
                >
                  {m.is_draft && <span style={{ color: "#f87171" }}>[Brouillon] </span>}
                  {m.subject}
                </span>
                <span className="text-xs truncate hidden sm:inline" style={{ color: MUTED }}>
                  — {m.snippet}
                </span>
              </div>
            </div>
            {/* Actions rapides */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              {folder === "trash" || folder === "archive" ? (
                <IconBtn icon="restore" title="Restaurer" onClick={(e) => { e.stopPropagation(); onAction(m, "restore"); }} />
              ) : (
                <IconBtn icon="archive" title="Archiver" onClick={(e) => { e.stopPropagation(); onAction(m, "archive"); }} />
              )}
              {folder === "trash" ? (
                <IconBtn icon="delete_forever" title="Supprimer" onClick={(e) => { e.stopPropagation(); onAction(m, "delete"); }} />
              ) : (
                <IconBtn icon="delete" title="Corbeille" onClick={(e) => { e.stopPropagation(); onAction(m, "trash"); }} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MailReader({ mail, folder, onBack, onStar, onAction, onReply, onForward }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <IconBtn icon="arrow_back" title="Retour" onClick={onBack} />
        <div className="flex-1" />
        {folder === "trash" || folder === "archive" ? (
          <IconBtn icon="restore" title="Restaurer" onClick={() => onAction(mail, "restore")} />
        ) : (
          <IconBtn icon="archive" title="Archiver" onClick={() => onAction(mail, "archive")} />
        )}
        <IconBtn
          icon={folder === "trash" ? "delete_forever" : "delete"}
          title={folder === "trash" ? "Supprimer définitivement" : "Corbeille"}
          onClick={() => onAction(mail, folder === "trash" ? "delete" : "trash")}
        />
        <IconBtn
          icon="star"
          title="Favori"
          filled={mail.is_starred}
          color={mail.is_starred ? "#fbbf24" : MUTED}
          onClick={onStar}
        />
      </div>

      <div className="p-5 overflow-y-auto flex-1">
        <h2 className="font-headline text-2xl font-bold mb-4" style={{ color: TEXT }}>
          {mail.subject}
        </h2>
        <div className="flex items-center gap-3 mb-5 pb-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <Avatar name={mail.sender_username} pic={mail.sender_profile_pic} size={44} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: TEXT }}>
              {mail.sender_username}{" "}
              <span className="font-normal" style={{ color: MUTED }}>&lt;{mail.sender_email}&gt;</span>
            </p>
            <p className="text-xs" style={{ color: MUTED }}>
              À : {(mail.to || []).join(", ")}
              {mail.cc?.length > 0 && ` · Cc : ${mail.cc.join(", ")}`}
            </p>
          </div>
          <span className="text-xs flex-shrink-0" style={{ color: MUTED }}>{timeAgo(mail.created_at)}</span>
        </div>
        <div className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "#c3cce8" }}>
          {mail.body}
        </div>

        <div className="flex gap-3 mt-8">
          <button
            onClick={onReply}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: ACCENT, color: "#00363e" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>reply</span>
            Répondre
          </button>
          <button
            onClick={onForward}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:bg-white/[0.06]"
            style={{ backgroundColor: PANEL2, color: TEXT }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>forward</span>
            Transférer
          </button>
        </div>
      </div>
    </div>
  );
}

function ComposeWindow({ compose, setCompose, onSend, onSaveDraft, onClose, sending }) {
  const upd = (k, v) => setCompose((c) => ({ ...c, [k]: v }));
  const [showCc, setShowCc] = useState(!!compose.cc);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-end p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/50" onClick={onSaveDraft} />
      <div
        className="relative w-full sm:w-[540px] max-h-[90vh] rounded-t-2xl sm:rounded-2xl flex flex-col shadow-2xl"
        style={{ backgroundColor: PANEL, border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 rounded-t-2xl"
          style={{ background: PANEL2 }}
        >
          <span className="font-headline font-bold text-sm" style={{ color: TEXT }}>
            {compose.draft_id ? "Modifier le brouillon" : "Nouveau message"}
          </span>
          <button onClick={onClose} style={{ color: MUTED }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="px-4 py-2 flex flex-col">
          <Field label="À">
            <input
              value={compose.to}
              onChange={(e) => upd("to", e.target.value)}
              placeholder="alice@nexus.mail, bob..."
              className="flex-1 bg-transparent outline-none text-sm py-2"
              style={{ color: TEXT }}
              autoFocus
            />
            {!showCc && (
              <button onClick={() => setShowCc(true)} className="text-xs" style={{ color: MUTED }}>
                Cc
              </button>
            )}
          </Field>
          {showCc && (
            <Field label="Cc">
              <input
                value={compose.cc}
                onChange={(e) => upd("cc", e.target.value)}
                placeholder="copie@nexus.mail"
                className="flex-1 bg-transparent outline-none text-sm py-2"
                style={{ color: TEXT }}
              />
            </Field>
          )}
          <Field label="">
            <input
              value={compose.subject}
              onChange={(e) => upd("subject", e.target.value)}
              placeholder="Objet"
              className="flex-1 bg-transparent outline-none text-sm py-2 font-semibold"
              style={{ color: TEXT }}
            />
          </Field>
          <textarea
            value={compose.body}
            onChange={(e) => upd("body", e.target.value)}
            placeholder="Rédigez votre message..."
            rows={10}
            className="w-full bg-transparent outline-none text-sm py-3 resize-none leading-relaxed"
            style={{ color: "#c3cce8" }}
          />
        </div>

        <div className="flex items-center gap-2 px-4 py-3 mt-auto" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button
            onClick={onSend}
            disabled={sending}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: ACCENT, color: "#00363e" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>send</span>
            {sending ? "Envoi..." : "Envoyer"}
          </button>
          <button onClick={onSaveDraft} className="text-xs px-3 py-2 rounded-lg hover:bg-white/[0.06]" style={{ color: MUTED }}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      {label && <span className="text-xs w-8" style={{ color: MUTED }}>{label}</span>}
      {children}
    </div>
  );
}

function IconBtn({ icon, title, onClick, filled, color }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-white/[0.08]"
      style={{ color: color || MUTED }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 20, fontVariationSettings: filled ? "'FILL' 1" : "'FILL' 0" }}
      >
        {icon}
      </span>
    </button>
  );
}
