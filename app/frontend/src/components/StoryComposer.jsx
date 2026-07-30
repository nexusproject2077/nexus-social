// Composer de Story (publication) — façon Instagram/Snapchat.
// Cette 1re passe couvre la PUBLICATION de base :
//  • Prendre une photo (appui court) ou une vidéo (appui long, max 15 s), OU
//    importer depuis la galerie (photo/vidéo).
//  • Ajouter du texte incrusté.
//  • Enchaîner plusieurs médias dans une même story (segments).
//  • Choix de visibilité : Tout le monde / Amis proches / Liste personnalisée.
// (Stickers, filtres, dessin, highlights… viendront dans les passes suivantes.)
import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { API } from "../App";
import { toast } from "sonner";

const ACCENT = (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee";
const C = {
  bg: "#020617", surface: "#0b1326", container: "#171f33", high: "#222a3d",
  accent: ACCENT, onPrimary: "#00363e", onSurface: "#dae2fd", onVariant: "#bbc9cd", outline: "#859397",
};
const IS_IOS = typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1));
const MAX_VIDEO_MS = 15000;   // vidéo story : 15 s max
const MAX_IMPORT = 10 * 1024 * 1024;

function Avatar({ username, pic, size = 32 }) {
  const s = `${size}px`;
  return pic ? (
    <img src={pic} alt={username} className="rounded-full object-cover" style={{ width: s, height: s }} />
  ) : (
    <div className="rounded-full flex items-center justify-center font-bold"
      style={{ width: s, height: s, fontSize: size * 0.4, background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
      {username?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

const VIS = {
  everyone: { label: "Tout le monde", icon: "public" },
  close_friends: { label: "Ami·e·s proches", icon: "star" },
  custom: { label: "Personnalisé", icon: "group" },
};

export default function StoryComposer({ user, onClose, onPublished }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordingRef = useRef(false);
  const pressRef = useRef({ timer: null, longPress: false });
  const progressRef = useRef(null);
  const maxRef = useRef(null);

  const [facing, setFacing] = useState("user");
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordPct, setRecordPct] = useState(0);

  const [mode, setMode] = useState("camera");     // "camera" | "edit"
  const [segments, setSegments] = useState([]);    // [{ media, type, text }]
  const [cur, setCur] = useState(null);            // { media, type } en cours d'édition
  const [text, setText] = useState("");

  const [visibility, setVisibility] = useState("everyone");
  const [customList, setCustomList] = useState([]); // [{id,username,profile_pic}]
  const [sheet, setSheet] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const stopStream = () => {
    try { streamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch { /* noop */ }
    streamRef.current = null;
  };

  const attach = useCallback((stream) => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    const mark = () => { if (v.videoWidth > 0) setReady(true); };
    v.onloadedmetadata = () => { v.play?.().catch(() => {}); mark(); };
    v.onplaying = mark;
    v.play?.().then(mark).catch(() => {});
  }, []);

  const startCam = useCallback(async (f) => {
    stopStream(); setReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: f } }, audio: false });
      streamRef.current = stream;
      attach(stream);
    } catch {
      toast.error("Caméra inaccessible — tu peux importer depuis la galerie.");
    }
  }, [attach]);

  useEffect(() => { if (mode === "camera") startCam(facing); else stopStream(); }, [facing, mode, startCam]);
  useEffect(() => () => {
    stopStream();
    clearTimeout(maxRef.current); clearInterval(progressRef.current); clearTimeout(pressRef.current.timer);
    const r = recorderRef.current; if (r && r.state !== "inactive") { try { r.stop(); } catch { /* noop */ } }
  }, []);

  // ── Capture photo / vidéo ────────────────────────────────────────────────
  const toEdit = (media, type) => { setCur({ media, type }); setText(""); setMode("edit"); };

  const capturePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const w = v.videoWidth, h = v.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (facing === "user") { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0, w, h);
    toEdit(canvas.toDataURL("image/jpeg", 0.85), "image");
  };

  const stopRec = () => {
    clearTimeout(maxRef.current); clearInterval(progressRef.current);
    const r = recorderRef.current;
    if (r && r.state !== "inactive") { try { r.stop(); } catch { /* noop */ } }
  };
  const startRec = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") { toast.error("Vidéo non prise en charge."); return; }
    let mime = "";
    for (const m of ["video/mp4", "video/webm;codecs=vp9", "video/webm"]) {
      if (MediaRecorder.isTypeSupported?.(m)) { mime = m; break; }
    }
    let r;
    try { r = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_500_000 }); }
    catch { toast.error("Vidéo non prise en charge."); return; }
    chunksRef.current = [];
    r.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    r.onstop = () => {
      recordingRef.current = false; setRecording(false); setRecordPct(0);
      const blob = new Blob(chunksRef.current, { type: r.mimeType || mime || "video/webm" });
      chunksRef.current = [];
      if (blob.size > 0) { const fr = new FileReader(); fr.onload = () => toEdit(fr.result, "video"); fr.readAsDataURL(blob); }
    };
    recorderRef.current = r; recordingRef.current = true; setRecording(true); setRecordPct(0);
    try { r.start(); } catch { recordingRef.current = false; setRecording(false); return; }
    const t0 = Date.now();
    progressRef.current = setInterval(() => setRecordPct(Math.min(100, ((Date.now() - t0) / MAX_VIDEO_MS) * 100)), 80);
    maxRef.current = setTimeout(stopRec, MAX_VIDEO_MS);
  };

  const onShutterDown = (e) => {
    if (!ready) return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
    pressRef.current.longPress = false;
    clearTimeout(pressRef.current.timer);
    pressRef.current.timer = setTimeout(() => { pressRef.current.longPress = true; startRec(); }, 280);
  };
  const onShutterUp = () => {
    clearTimeout(pressRef.current.timer);
    if (recordingRef.current) { stopRec(); return; }
    if (!pressRef.current.longPress) capturePhoto();
  };

  const onImport = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) { toast.error("Image ou vidéo uniquement."); return; }
    if (f.size > MAX_IMPORT) { toast.error("Fichier trop lourd (max 10 Mo)."); return; }
    const fr = new FileReader();
    fr.onload = () => toEdit(fr.result, f.type.startsWith("video/") ? "video" : "image");
    fr.readAsDataURL(f);
  };

  // ── Segments & publication ───────────────────────────────────────────────
  const commitCurrent = () => {
    if (!cur) return null;
    const seg = { media: cur.media, type: cur.type, text: text.trim() };
    setSegments((s) => [...s, seg]);
    setCur(null); setText(""); setMode("camera");
    return seg;
  };

  const publishAll = async (extra) => {
    const all = extra ? [...segments, extra] : segments;
    if (all.length === 0) { toast.error("Ajoute au moins un média."); return; }
    if (visibility === "custom" && customList.length === 0) { setSheet(true); return; }
    setPublishing(true);
    try {
      for (const seg of all) {
        const fd = new FormData();
        fd.append("media_url", seg.media);
        fd.append("media_type", seg.type);
        fd.append("audience", visibility);
        fd.append("text", seg.text || "");
        if (visibility === "custom") fd.append("recipient_ids", customList.map((u) => u.id).join(","));
        await axios.post(`${API}/stories/`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      }
      window.dispatchEvent(new CustomEvent("nexus:realtime", { detail: { type: "story" } }));
      toast.success(all.length > 1 ? `Story publiée (${all.length} médias)` : "Story publiée");
      onPublished?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Publication impossible.");
      setPublishing(false);
    }
  };

  const publishFromEdit = () => {
    const seg = { media: cur.media, type: cur.type, text: text.trim() };
    publishAll(seg);
  };

  const visLabel = VIS[visibility].label;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col select-none"
      style={{ background: C.bg, WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}>
      {/* Barre supérieure */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2" style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10">
          <span className="material-symbols-outlined text-white">close</span>
        </button>
        <span className="font-bold text-white">Nouvelle story</span>
        <button onClick={() => setSheet(true)} className="flex items-center gap-1.5 px-3 h-9 rounded-full text-sm font-semibold"
          style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}>
          <span className="material-symbols-outlined text-[18px]" style={{ color: C.accent }}>{VIS[visibility].icon}</span>
          <span className="max-w-[110px] truncate">{visibility === "custom" && customList.length ? `Perso (${customList.length})` : visLabel}</span>
        </button>
      </div>

      {/* Zone média */}
      <div className="flex-1 flex items-center justify-center px-3 min-h-0">
        <div className="relative w-full h-full flex items-center justify-center">
          {mode === "camera" ? (
            <div className="relative w-full h-full flex items-center justify-center">
              <video ref={videoRef} muted playsInline autoPlay className="max-w-full max-h-full rounded-3xl object-contain"
                style={{ transform: facing === "user" ? "scaleX(-1)" : "none" }} />
              {!ready && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="animate-spin rounded-full h-9 w-9 border-b-2" style={{ borderColor: C.accent }} />
                  <span className="text-[12px] text-white/70">Initialisation de la caméra…</span>
                </div>
              )}
              {recording && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold text-white"
                  style={{ background: "rgba(239,68,68,0.9)" }}>
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  {Math.min(15, Math.ceil((recordPct / 100) * 15))}s / 15s
                </div>
              )}
            </div>
          ) : (
            <div className="relative w-full h-full flex items-center justify-center">
              {cur?.type === "video"
                ? <video src={cur.media} className="max-w-full max-h-full rounded-3xl object-contain" autoPlay playsInline muted loop />
                : <img src={cur?.media} alt="" className="max-w-full max-h-full rounded-3xl object-contain" />}
              {text.trim() && (
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center px-6 pointer-events-none">
                  <span className="text-center text-white text-2xl font-black leading-snug px-3 py-1 rounded-lg"
                    style={{ background: "rgba(0,0,0,0.35)", textShadow: "0 2px 6px rgba(0,0,0,0.5)" }}>{text.trim()}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Barre du bas */}
      {mode === "camera" ? (
        <div className="px-6 pb-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}>
          {segments.length > 0 && (
            <div className="flex items-center gap-2 mb-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {segments.map((s, i) => (
                <div key={i} className="relative flex-shrink-0 rounded-lg overflow-hidden" style={{ width: 44, height: 60, background: C.container }}>
                  {s.type === "video"
                    ? <video src={s.media} className="w-full h-full object-cover" muted playsInline />
                    : <img src={s.media} alt="" className="w-full h-full object-cover" />}
                  <button onClick={() => setSegments((arr) => arr.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
                    <span className="material-symbols-outlined text-white" style={{ fontSize: 12 }}>close</span>
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <button onClick={() => fileRef.current?.click()} className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.1)" }} aria-label="Galerie">
              <span className="material-symbols-outlined text-white">photo_library</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*" onChange={onImport} className="hidden" />

            <button onPointerDown={onShutterDown} onPointerUp={onShutterUp} onPointerCancel={onShutterUp}
              onContextMenu={(e) => e.preventDefault()} disabled={!ready}
              style={{ touchAction: "none" }}
              className="relative w-[76px] h-[76px] rounded-full active:scale-95 transition-transform disabled:opacity-40"
              aria-label="Photo (appui court) ou vidéo (appui long, max 15 s)">
              <span className="absolute inset-0 rounded-full border-4" style={{ borderColor: recording ? "#ef4444" : "rgba(255,255,255,0.7)" }} />
              {recording
                ? <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-red-500" style={{ width: 28, height: 28 }} />
                : <span className="absolute inset-[6px] rounded-full bg-white" />}
              {recording && (
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 76 76" style={{ pointerEvents: "none" }}>
                  <circle cx="38" cy="38" r="35" fill="none" stroke="#ef4444" strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 35} strokeDashoffset={(1 - recordPct / 100) * 2 * Math.PI * 35} />
                </svg>
              )}
            </button>

            {segments.length > 0 ? (
              <button onClick={() => publishAll()} disabled={publishing}
                className="h-14 px-4 rounded-2xl font-black text-sm disabled:opacity-60"
                style={{ background: `linear-gradient(135deg,${C.accent},#3b82f6)`, color: C.onPrimary }}>
                {publishing ? "…" : "Publier"}
              </button>
            ) : (
              <button onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
                className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.1)" }} aria-label="Changer de caméra">
                <span className="material-symbols-outlined text-white">cameraswitch</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="px-4 pb-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}>
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} placeholder="Ajouter du texte…"
            className="w-full text-center text-sm px-4 py-2.5 rounded-full border-none outline-none mb-3 placeholder:text-white/40"
            style={{ background: "rgba(255,255,255,0.1)", color: "#fff", WebkitUserSelect: "text", userSelect: "text" }} />
          <div className="flex items-center gap-3">
            <button onClick={() => { setCur(null); setText(""); setMode("camera"); }}
              className="px-4 py-3 rounded-full font-semibold" style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}>
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <button onClick={commitCurrent}
              className="flex-1 py-3 rounded-full font-bold" style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}>
              Ajouter un autre média
            </button>
            <button onClick={publishFromEdit} disabled={publishing}
              className="flex-1 py-3 rounded-full font-black disabled:opacity-60"
              style={{ background: `linear-gradient(135deg,${C.accent},#3b82f6)`, color: C.onPrimary }}>
              {publishing ? "Publication…" : "Publier"}
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <VisibilitySheet
          user={user} visibility={visibility} customList={customList}
          onClose={() => setSheet(false)}
          onPick={(v, list) => { setVisibility(v); if (list) setCustomList(list); setSheet(false); }}
        />
      )}
    </div>
  );
}

// ── Sélecteur de visibilité (Tout le monde / Amis proches / Personnalisé) ────
function VisibilitySheet({ user, visibility, customList, onClose, onPick }) {
  const [mode, setMode] = useState(null);            // null | "custom" | "close"
  const [selected, setSelected] = useState(customList || []);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== "close") return;
    axios.get(`${API}/instants/close-friends`).then((r) => setSelected(r.data || [])).catch(() => {});
  }, [mode]);

  useEffect(() => {
    if (!mode || !q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/users/search?q=${encodeURIComponent(q.trim())}`);
        setResults((r.data || []).filter((u) => u.id !== user?.id));
      } catch { /* noop */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q, mode, user]);

  const toggle = (u) => setSelected((p) => p.find((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u]);

  const confirm = async () => {
    if (mode === "close") {
      setSaving(true);
      try { await axios.put(`${API}/instants/close-friends`, { ids: selected.map((u) => u.id) }); } catch { /* noop */ }
      setSaving(false);
      onPick("close_friends");
    } else {
      onPick("custom", selected);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl p-4 pb-6 max-h-[80vh] overflow-y-auto"
        style={{ background: C.surface, paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1.5 rounded-full mx-auto mb-4" style={{ background: C.high }} />
        {!mode ? (
          <>
            <h3 className="font-black text-lg mb-3 px-1" style={{ color: C.onSurface }}>Qui peut voir ?</h3>
            <button onClick={() => onPick("everyone")} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
              style={{ background: visibility === "everyone" ? `${C.accent}1a` : "transparent" }}>
              <span className="material-symbols-outlined" style={{ color: C.accent }}>public</span>
              <div className="flex-1"><p className="font-bold" style={{ color: C.onSurface }}>Tout le monde</p><p className="text-xs" style={{ color: C.outline }}>Vos abonnés</p></div>
              {visibility === "everyone" && <span className="material-symbols-outlined" style={{ color: C.accent }}>check_circle</span>}
            </button>
            <button onClick={() => setMode("close")} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
              style={{ background: visibility === "close_friends" ? `${C.accent}1a` : "transparent" }}>
              <span className="material-symbols-outlined" style={{ color: "#22c55e" }}>star</span>
              <div className="flex-1"><p className="font-bold" style={{ color: C.onSurface }}>Ami·e·s proches</p><p className="text-xs" style={{ color: C.outline }}>Votre liste privée (modifiable)</p></div>
              <span className="material-symbols-outlined" style={{ color: C.outline }}>chevron_right</span>
            </button>
            <button onClick={() => { setSelected(customList || []); setMode("custom"); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
              style={{ background: visibility === "custom" ? `${C.accent}1a` : "transparent" }}>
              <span className="material-symbols-outlined" style={{ color: C.accent }}>group</span>
              <div className="flex-1"><p className="font-bold" style={{ color: C.onSurface }}>Liste personnalisée</p><p className="text-xs" style={{ color: C.outline }}>Choisir des destinataires précis</p></div>
              <span className="material-symbols-outlined" style={{ color: C.outline }}>chevron_right</span>
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => setMode(null)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/5">
                <span className="material-symbols-outlined" style={{ color: C.onSurface }}>arrow_back</span>
              </button>
              <h3 className="font-black text-lg" style={{ color: C.onSurface }}>{mode === "close" ? "Ami·e·s proches" : "Liste personnalisée"}</h3>
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un·e utilisateur·rice…"
              className="w-full text-sm px-4 py-2.5 rounded-xl border-none outline-none mb-3 placeholder:text-slate-500"
              style={{ background: C.high, color: C.onSurface }} />
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {selected.map((u) => (
                  <button key={u.id} onClick={() => toggle(u)} className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
                    style={{ background: `${C.accent}18`, color: C.accent, border: `1px solid ${C.accent}30` }}>
                    @{u.username}<span className="material-symbols-outlined text-xs">close</span>
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-1 mb-4">
              {results.map((u) => {
                const on = !!selected.find((x) => x.id === u.id);
                return (
                  <button key={u.id} onClick={() => toggle(u)} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 text-left">
                    <Avatar username={u.username} pic={u.profile_pic} size={32} />
                    <span className="text-sm font-medium flex-1" style={{ color: C.onSurface }}>@{u.username}</span>
                    <span className="material-symbols-outlined" style={{ color: on ? C.accent : C.outline }}>{on ? "check_circle" : "radio_button_unchecked"}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={confirm} disabled={saving || selected.length === 0}
              className="w-full py-3 rounded-2xl font-black disabled:opacity-40"
              style={{ background: `linear-gradient(135deg,${C.accent},#3b82f6)`, color: C.onPrimary }}>
              {saving ? "Enregistrement…" : mode === "close" ? "Enregistrer & choisir" : `Choisir ${selected.length || 0} destinataire${selected.length > 1 ? "s" : ""}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
