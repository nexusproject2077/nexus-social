// Composer de Story façon Instagram.
//  • Caméra PLEIN ÉCRAN. Rail de modes à gauche (Créer/Boomerang/Layout/Mains
//    libres) dont les libellés s'estompent après quelques secondes.
//  • Photo (appui court) / vidéo (appui long, max 15 s) ou import galerie.
//  • Écran d'édition : rail d'outils à droite (Aa texte, stickers, musique,
//    effets/filtres), « Ajoutez une légende… », pastilles de publication
//    (Votre story / Ami·e·s proches) + flèche.
//  • Enchaîner plusieurs médias (segments). Visibilité everyone/close/custom.
//  • Filtres (presets CSS) appliqués et « cuits » dans la photo à la publication.
// (Stickers sondage/questions/musique et dessin : passes suivantes.)
import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { API } from "../App";
import { toast } from "sonner";

const ACCENT = (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee";
const C = {
  bg: "#000", surface: "#0b1326", container: "#171f33", high: "#222a3d",
  accent: ACCENT, onPrimary: "#00363e", onSurface: "#dae2fd", onVariant: "#bbc9cd", outline: "#859397",
};
const MAX_VIDEO_MS = 15000;
const MAX_IMPORT = 10 * 1024 * 1024;

const FILTERS = [
  { key: "none", label: "Normal", css: "none" },
  { key: "eclat", label: "Éclat", css: "brightness(1.08) saturate(1.18) contrast(1.05)" },
  { key: "chaud", label: "Chaud", css: "sepia(0.25) saturate(1.3) brightness(1.05)" },
  { key: "froid", label: "Froid", css: "saturate(1.1) brightness(1.03) contrast(1.05) hue-rotate(-12deg)" },
  { key: "nb", label: "N&B", css: "grayscale(1) contrast(1.1)" },
  { key: "vintage", label: "Vintage", css: "sepia(0.5) contrast(0.9) brightness(1.05) saturate(1.2)" },
  { key: "vif", label: "Vif", css: "saturate(1.6) contrast(1.12)" },
];

// Modes du rail gauche (visuels façon Instagram). « Créer » à venir, les autres
// annoncés « bientôt ».
const MODES = [
  { key: "create", label: "Créer", txt: "Aa" },
  { key: "boomerang", label: "Boomerang", icon: "all_inclusive" },
  { key: "layout", label: "Layout", icon: "grid_view" },
  { key: "hands", label: "Mains libres", icon: "radio_button_checked" },
];

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

// Applique (cuit) un filtre CSS dans une photo → nouvelle data URL.
function bakePhoto(dataUrl, cssFilter) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.filter = cssFilter || "none";
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

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
  const [torch, setTorch] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordPct, setRecordPct] = useState(0);
  const [showLabels, setShowLabels] = useState(true);

  const [mode, setMode] = useState("camera");      // "camera" | "edit"
  const [segments, setSegments] = useState([]);     // [{ media, type, text, filter }]
  const [cur, setCur] = useState(null);             // { media, type }
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("none");     // key
  const [showFilters, setShowFilters] = useState(false);

  const [visibility, setVisibility] = useState("everyone");
  const [customList, setCustomList] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const filterCss = FILTERS.find((f) => f.key === filter)?.css || "none";

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
    stopStream(); setReady(false); setTorch(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: f } }, audio: false });
      streamRef.current = stream;
      attach(stream);
    } catch {
      toast.error("Caméra inaccessible — tu peux importer depuis la galerie.");
    }
  }, [attach]);

  useEffect(() => { if (mode === "camera") startCam(facing); else stopStream(); }, [facing, mode, startCam]);
  useEffect(() => {
    // Libellés du rail : visibles quelques secondes puis s'estompent.
    setShowLabels(true);
    const t = setTimeout(() => setShowLabels(false), 3500);
    return () => clearTimeout(t);
  }, [mode]);
  useEffect(() => () => {
    stopStream();
    clearTimeout(maxRef.current); clearInterval(progressRef.current); clearTimeout(pressRef.current.timer);
    const r = recorderRef.current; if (r && r.state !== "inactive") { try { r.stop(); } catch { /* noop */ } }
  }, []);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    const caps = track?.getCapabilities?.();
    if (track && caps && "torch" in caps) {
      try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); return; } catch { /* noop */ }
    }
    setTorch((t) => !t);
  };

  // ── Capture ───────────────────────────────────────────────────────────────
  const toEdit = (media, type) => { setCur({ media, type }); setText(""); setFilter("none"); setShowFilters(false); setMode("edit"); };

  const capturePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    // Recadrage 9:16 centré (comme l'aperçu plein écran).
    const vw = v.videoWidth, vh = v.videoHeight, target = 9 / 16;
    let cw = vw, ch = Math.round(vw / target);
    if (ch > vh) { ch = vh; cw = Math.round(vh * target); }
    const sx = Math.round((vw - cw) / 2), sy = Math.round((vh - ch) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (facing === "user") { ctx.translate(cw, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, sx, sy, cw, ch, 0, 0, cw, ch);
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
    for (const m of ["video/mp4", "video/webm;codecs=vp9", "video/webm"]) { if (MediaRecorder.isTypeSupported?.(m)) { mime = m; break; } }
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
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) { toast.error("Image ou vidéo uniquement."); return; }
    if (f.size > MAX_IMPORT) { toast.error("Fichier trop lourd (max 10 Mo)."); return; }
    const fr = new FileReader();
    fr.onload = () => toEdit(fr.result, f.type.startsWith("video/") ? "video" : "image");
    fr.readAsDataURL(f);
  };

  const onModeTap = (m) => {
    setShowLabels(true);
    clearTimeout(maxRef.current);
    if (m === "create") toast("Mode « Créer » : bientôt.");
    else toast(`« ${MODES.find((x) => x.key === m)?.label} » : bientôt.`);
    setTimeout(() => setShowLabels(false), 3500);
  };

  // ── Segments & publication ───────────────────────────────────────────────
  const packedCurrent = () => (cur ? { media: cur.media, type: cur.type, text: text.trim(), filter } : null);

  const addMore = () => {
    const seg = packedCurrent();
    if (seg) setSegments((s) => [...s, seg]);
    setCur(null); setText(""); setFilter("none"); setShowFilters(false); setMode("camera");
  };

  const publish = async (vis, list) => {
    const all = [...segments];
    const seg = packedCurrent();
    if (seg) all.push(seg);
    if (all.length === 0) { toast.error("Ajoute au moins un média."); return; }
    if (vis === "custom" && (!list || list.length === 0)) { setSheet(true); return; }
    setPublishing(true);
    try {
      for (const s of all) {
        let media = s.media;
        const css = FILTERS.find((f) => f.key === s.filter)?.css;
        if (s.type === "image" && css && css !== "none") media = await bakePhoto(s.media, css);
        const fd = new FormData();
        fd.append("media_url", media);
        fd.append("media_type", s.type);
        fd.append("audience", vis);
        fd.append("text", s.text || "");
        if (vis === "custom") fd.append("recipient_ids", (list || []).map((u) => u.id).join(","));
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

  // ══════════════════════════════════════ CAMÉRA ══════════════════════════════
  if (mode === "camera") {
    return (
      <div className="fixed inset-0 z-[80] select-none" style={{ background: "#000" }}>
        <video ref={videoRef} muted playsInline autoPlay className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: facing === "user" ? "scaleX(-1)" : "none" }} />
        {!ready && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="animate-spin rounded-full h-9 w-9 border-b-2" style={{ borderColor: C.accent }} />
            <span className="text-[12px] text-white/70">Initialisation de la caméra…</span>
          </div>
        )}

        {/* Barre supérieure */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-3"
          style={{ paddingTop: "max(env(safe-area-inset-top), 14px)" }}>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full">
            <span className="material-symbols-outlined text-white" style={{ fontSize: 30 }}>close</span>
          </button>
          <button onClick={toggleTorch} className="w-10 h-10 flex items-center justify-center rounded-full">
            <span className="material-symbols-outlined text-white">{torch ? "flash_on" : "flash_off"}</span>
          </button>
          <button onClick={() => setSheet(true)} className="w-10 h-10 flex items-center justify-center rounded-full" aria-label="Visibilité">
            <span className="material-symbols-outlined text-white">settings</span>
          </button>
        </div>

        {/* Rail de modes (gauche) — libellés qui s'estompent */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-6">
          {MODES.map((m) => (
            <button key={m.key} onClick={() => onModeTap(m.key)} className="flex items-center gap-3">
              <span className="w-11 h-11 flex items-center justify-center">
                {m.txt
                  ? <span className="text-white font-black text-2xl" style={{ fontFamily: "Georgia, serif" }}>{m.txt}</span>
                  : <span className="material-symbols-outlined text-white" style={{ fontSize: 28 }}>{m.icon}</span>}
              </span>
              <span className="text-white font-bold text-base transition-opacity duration-500"
                style={{ opacity: showLabels ? 1 : 0, textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>{m.label}</span>
            </button>
          ))}
        </div>

        {recording && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold text-white"
            style={{ background: "rgba(239,68,68,0.9)" }}>
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            {Math.min(15, Math.ceil((recordPct / 100) * 15))}s / 15s
          </div>
        )}

        {/* Barre du bas : galerie · déclencheur · flip */}
        <div className="absolute bottom-0 left-0 right-0 px-8 pb-6" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}>
          <div className="flex items-center justify-between">
            <button onClick={() => fileRef.current?.click()} className="w-11 h-11 rounded-lg overflow-hidden flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }} aria-label="Galerie">
              <span className="material-symbols-outlined text-white">photo_library</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*" onChange={onImport} className="hidden" />

            <button onPointerDown={onShutterDown} onPointerUp={onShutterUp} onPointerCancel={onShutterUp}
              onContextMenu={(e) => e.preventDefault()} disabled={!ready}
              style={{ touchAction: "none" }}
              className="relative w-[80px] h-[80px] rounded-full active:scale-95 transition-transform disabled:opacity-40"
              aria-label="Photo (appui court) ou vidéo (appui long, max 15 s)">
              <span className="absolute inset-0 rounded-full border-[5px]" style={{ borderColor: recording ? "#ef4444" : "#fff" }} />
              {recording
                ? <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-red-500" style={{ width: 30, height: 30 }} />
                : <span className="absolute inset-[7px] rounded-full" style={{ background: "rgba(255,255,255,0.9)" }} />}
              {recording && (
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80" style={{ pointerEvents: "none" }}>
                  <circle cx="40" cy="40" r="37" fill="none" stroke="#ef4444" strokeWidth="5" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 37} strokeDashoffset={(1 - recordPct / 100) * 2 * Math.PI * 37} />
                </svg>
              )}
            </button>

            <button onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
              className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }} aria-label="Changer de caméra">
              <span className="material-symbols-outlined text-white">cameraswitch</span>
            </button>
          </div>
          <p className="text-center text-white/90 font-bold text-sm mt-4 tracking-wide">STORY</p>
        </div>

        {sheet && (
          <VisibilitySheet user={user} visibility={visibility} customList={customList}
            onClose={() => setSheet(false)}
            onPick={(v, list) => { setVisibility(v); if (list) setCustomList(list); setSheet(false); }} />
        )}
      </div>
    );
  }

  // ══════════════════════════════════════ ÉDITION ═════════════════════════════
  return (
    <div className="fixed inset-0 z-[80] select-none" style={{ background: "#000" }}>
      {/* Média plein écran (object-contain : imports non 9:16 letterboxés sans fond) */}
      {cur?.type === "video"
        ? <video src={cur.media} className="absolute inset-0 w-full h-full object-contain" style={{ filter: filterCss }} autoPlay playsInline muted loop />
        : <img src={cur?.media} alt="" className="absolute inset-0 w-full h-full object-contain" style={{ filter: filterCss }} />}

      {/* Texte incrusté (aperçu) */}
      {text.trim() && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center px-6 pointer-events-none">
          <span className="text-center text-white text-2xl font-black leading-snug px-3 py-1 rounded-lg"
            style={{ background: "rgba(0,0,0,0.35)", textShadow: "0 2px 6px rgba(0,0,0,0.5)" }}>{text.trim()}</span>
        </div>
      )}

      {/* X (haut gauche) */}
      <div className="absolute top-0 left-0 px-4 pt-3" style={{ paddingTop: "max(env(safe-area-inset-top), 14px)" }}>
        <button onClick={() => { setCur(null); setText(""); setMode("camera"); }} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <span className="material-symbols-outlined text-white">close</span>
        </button>
      </div>

      {/* Rail d'outils (haut droite) */}
      <div className="absolute top-0 right-0 px-4 pt-3 flex flex-col gap-3" style={{ paddingTop: "max(env(safe-area-inset-top), 14px)" }}>
        {[
          { icon: null, txt: "Aa", label: "Texte", on: () => document.getElementById("story-caption")?.focus() },
          { icon: "sentiment_satisfied", label: "Stickers", on: () => toast("Stickers (sondage/questions) : bientôt.") },
          { icon: "music_note", label: "Musique", on: () => toast("Musique : bientôt.") },
          { icon: "auto_awesome", label: "Effets", on: () => setShowFilters((s) => !s) },
        ].map((t, i) => (
          <button key={i} onClick={t.on} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }} aria-label={t.label}>
            {t.txt ? <span className="text-white font-black text-lg" style={{ fontFamily: "Georgia, serif" }}>{t.txt}</span>
              : <span className="material-symbols-outlined text-white" style={{ fontSize: 22 }}>{t.icon}</span>}
          </button>
        ))}
      </div>

      {/* Sélecteur de filtres (si Effets actif, images uniquement) */}
      {showFilters && cur?.type === "image" && (
        <div className="absolute left-0 right-0 bottom-32 px-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          <div className="flex gap-3">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} className="flex-shrink-0 flex flex-col items-center gap-1">
                <div className="w-14 h-14 rounded-xl overflow-hidden" style={{ border: filter === f.key ? `2px solid ${C.accent}` : "2px solid transparent" }}>
                  <img src={cur.media} alt="" className="w-full h-full object-cover" style={{ filter: f.css }} />
                </div>
                <span className="text-[11px]" style={{ color: filter === f.key ? C.accent : "#fff" }}>{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bas : légende + pastilles de publication */}
      <div className="absolute bottom-0 left-0 right-0 px-4 pb-5 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 18px)", background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent)" }}>
        <input id="story-caption" value={text} onChange={(e) => setText(e.target.value.slice(0, 500))}
          placeholder="Ajoutez une légende…"
          className="w-full text-sm px-1 py-2 bg-transparent border-none outline-none placeholder:text-white/70 text-white mb-2"
          style={{ WebkitUserSelect: "text", userSelect: "text" }} />
        <div className="flex items-center gap-2">
          <button onClick={() => publish("everyone")} disabled={publishing}
            className="flex items-center gap-2 pl-1 pr-4 h-11 rounded-full font-bold text-sm disabled:opacity-60" style={{ background: C.high, color: "#fff" }}>
            <Avatar username={user?.username} pic={user?.profile_pic} size={30} />
            Votre story
          </button>
          <button onClick={() => publish("close_friends")} disabled={publishing}
            className="flex items-center gap-2 pl-1 pr-4 h-11 rounded-full font-bold text-sm disabled:opacity-60" style={{ background: C.high, color: "#fff" }}>
            <span className="w-[30px] h-[30px] rounded-full flex items-center justify-center" style={{ background: "#22c55e" }}>
              <span className="material-symbols-outlined text-white" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>star</span>
            </span>
            Ami·e·s proches
          </button>
          <button onClick={addMore} disabled={publishing} className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.high }} aria-label="Ajouter un média">
            <span className="material-symbols-outlined text-white">add</span>
          </button>
          <button onClick={() => setSheet(true)} disabled={publishing} className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: `linear-gradient(135deg,${C.accent},#3b82f6)`, color: C.onPrimary }} aria-label="Publier">
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
        {segments.length > 0 && (
          <p className="text-center text-[11px] mt-2 text-white/60">{segments.length} média{segments.length > 1 ? "s" : ""} ajouté{segments.length > 1 ? "s" : ""} — « Votre story » publie tout</p>
        )}
      </div>

      {sheet && (
        <VisibilitySheet user={user} visibility={visibility} customList={customList}
          onClose={() => setSheet(false)}
          onPick={(v, list) => { setVisibility(v); if (list) setCustomList(list); setSheet(false); publish(v, list); }} />
      )}
    </div>
  );
}

// ── Sélecteur de visibilité ─────────────────────────────────────────────────
function VisibilitySheet({ user, visibility, customList, onClose, onPick }) {
  const [mode, setMode] = useState(null);
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
              {saving ? "Enregistrement…" : mode === "close" ? "Enregistrer & publier" : `Publier pour ${selected.length || 0} destinataire${selected.length > 1 ? "s" : ""}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
