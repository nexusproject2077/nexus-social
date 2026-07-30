// Instantanés (photos éphémères façon Instagram) — intégré à la page Messages.
//
// • Entrée : bouton caméra « + » (FAB) + bandeau des instantanés reçus.
// • Caméra plein écran : photo prise EN DIRECT uniquement (pas d'import galerie),
//   AUCUNE retouche (ni filtre, ni sticker, ni édition). Légende courte avant
//   la prise. Choix de l'audience : Ami·e·s proches / Mutuels / Sélection.
// • Double caméra (avant + arrière simultanément) : on active/désactive par un
//   DOUBLE APPUI sur l'aperçu (message d'intro au premier essai).
// • L'instantané n'est visible qu'UNE FOIS par destinataire, puis disparaît
//   (ou au bout de 24 h). Réaction emoji + réponse (→ message privé).
// • Archive privée de l'auteur + bouton « Annuler » juste après l'envoi.
//
// Design sombre, fluide, mobile-first, cohérent avec MessagesPage.
import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";

const ACCENT = (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee";
const C = {
  bg: "#020617", surface: "#0b1326", container: "#171f33", high: "#222a3d",
  accent: ACCENT, onPrimary: "#00363e", onSurface: "#dae2fd", onVariant: "#bbc9cd", outline: "#859397",
};
const REACT_EMOJIS = ["❤️", "😂", "😮", "😍", "🔥", "👏", "😢", "🙏"];
const DUAL_PROMO_KEY = "nexus_instant_dual_promo_seen";

// iOS/Safari : la sélection d'objectif par deviceId renvoie un flux « vivant »
// mais NOIR (bug WebKit). Sur iOS on s'en tient donc à facingMode (rendu
// fiable) ; la sélection fine par deviceId reste réservée aux autres plateformes
// (Android), où elle évite l'ultra grand-angle sans casser l'affichage.
const IS_IOS = typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1));

function Avatar({ username, pic, size = 40, ring = false }) {
  const s = `${size}px`;
  const inner = pic ? (
    <img src={pic} alt={username} className="rounded-full object-cover" style={{ width: s, height: s }} />
  ) : (
    <div className="rounded-full flex items-center justify-center font-bold"
      style={{ width: s, height: s, fontSize: size * 0.4, background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
      {username?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
  if (!ring) return inner;
  return (
    <div className="rounded-full p-[2px]" style={{ background: `linear-gradient(135deg,${C.accent},#3b82f6)` }}>
      <div className="rounded-full p-[2px]" style={{ background: C.surface }}>{inner}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Caméra plein écran
// ──────────────────────────────────────────────────────────────────────────
function InstantsCamera({ user, onClose, onSent, onOpenArchive }) {
  const videoRef = useRef(null);      // caméra principale
  const pipRef = useRef(null);        // caméra secondaire (double caméra)
  const streamRef = useRef(null);
  const pipStreamRef = useRef(null);
  const lastTapRef = useRef(0);
  const triedFallbackRef = useRef(false);   // repli facingMode déjà tenté ?

  const pendingPhotoRef = useRef(null);   // photo capturée en attente (audience manuelle vide)

  const [facing, setFacing] = useState("environment");
  const [dual, setDual] = useState(false);
  const [torch, setTorch] = useState(false);
  const [flashPulse, setFlashPulse] = useState(false);
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState("mutuals");
  const [manual, setManual] = useState([]);        // [{id,username,profile_pic}]
  const [sheet, setSheet] = useState(false);        // sélecteur d'audience ouvert
  const [sheetMode, setSheetMode] = useState(null); // "manual" pour ouvrir direct sur la sélection
  const [promo, setPromo] = useState(false);        // modale double caméra
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);        // flux vidéo prêt (dimensions connues)
  const [showHint, setShowHint] = useState(true);   // indice « double-appui » (transitoire)

  // L'indice « double-appui » n'apparaît que quelques secondes (au démarrage
  // et à chaque changement d'état de la double caméra).
  useEffect(() => {
    setShowHint(true);
    const t = setTimeout(() => setShowHint(false), 4000);
    return () => clearTimeout(t);
  }, [dual]);

  const stopStream = (ref) => {
    try { ref.current?.getTracks?.().forEach((t) => t.stop()); } catch { /* noop */ }
    ref.current = null;
  };

  // Choisit le BON capteur. Sur les téléphones à plusieurs objectifs
  // (iPhone Pro, Android multi-capteurs), `facingMode:environment` sélectionne
  // parfois l'ultra grand-angle (ou le téléobjectif). On force l'objectif
  // principal « normal » : on privilégie la caméra dite « Back Camera »
  // (l'équivalent de l'app photo native) et on évite explicitement les labels
  // « ultra », « téléobjectif », « depth ». Les labels ne sont lisibles
  // QU'APRÈS avoir obtenu la permission caméra.
  const preferredDeviceId = async (f) => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      if (cams.length <= 1) return null;
      const backRe = /back|rear|arri[eè]re|environ/i;
      const frontRe = /front|avant|face|selfie/i;
      const avoidRe = /ultra|t[ée]l[ée]|tele|zoom|depth|truedepth|profondeur|macro/i;
      const exactRe = /^(back|front) camera$|^cam[ée]ra (arri[eè]re|avant)$/i;
      let pool = cams.filter((c) => (f === "user" ? frontRe : backRe).test(c.label || ""));
      if (!pool.length) pool = cams.filter((c) => c.label);       // labels dispo mais pas de match
      if (!pool.length) return null;                               // aucun label → laisse facingMode décider
      // 1) l'objectif principal exact (« Back Camera » / « Caméra arrière »)
      const exact = pool.find((c) => exactRe.test(c.label));
      if (exact) return exact.deviceId;
      // 2) sinon, le premier qui n'est ni ultra ni télé ni depth
      const normal = pool.find((c) => !avoidRe.test(c.label));
      return (normal || pool[0]).deviceId || null;
    } catch { return null; }
  };

  // Attache un flux au <video> et signale « prêt » dès que les dimensions
  // sont connues (loadedmetadata / playing).
  const attach = useCallback((stream) => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    const mark = () => { if (v.videoWidth > 0) setReady(true); };
    v.onloadedmetadata = () => { v.play?.().catch(() => {}); mark(); };
    v.onplaying = mark;
    v.play?.().then(mark).catch(() => {});
    if (v.readyState >= 1) mark();
  }, []);

  const startMain = useCallback(async (f) => {
    stopStream(streamRef);
    setTorch(false);
    setReady(false);
    triedFallbackRef.current = false;
    // UN SEUL accès caméra (iOS n'autorise qu'une caméra à la fois ; deux
    // getUserMedia d'affilée renvoyaient une image noire). Si les labels sont
    // déjà connus (permission accordée), on cible directement le bon objectif ;
    // sinon on laisse facingMode décider pour cette 1re ouverture.
    let stream = null;
    try {
      // Sur iOS : facingMode uniquement (le deviceId rend du noir). Ailleurs :
      // on cible le bon objectif si les labels sont connus.
      const devId = IS_IOS ? null : await preferredDeviceId(f);
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          devId ? { video: { deviceId: { exact: devId } }, audio: false }
                : { video: { facingMode: { ideal: f } }, audio: false }
        );
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: f }, audio: false });
      }
    } catch {
      toast.error("Caméra inaccessible — autorise l'accès à l'appareil photo.");
      return;
    }
    streamRef.current = stream;
    attach(stream);

    // Filet de sécurité : si aucune image après 2,5 s (capteur qui renvoie du
    // noir), on retombe UNE fois sur facingMode simple.
    setTimeout(async () => {
      if (streamRef.current !== stream) return;                 // déjà remplacé
      if (videoRef.current && videoRef.current.videoWidth > 0) return; // ok
      if (triedFallbackRef.current) return;
      triedFallbackRef.current = true;
      try {
        stopStream(streamRef);
        const fb = await navigator.mediaDevices.getUserMedia({ video: { facingMode: f }, audio: false });
        streamRef.current = fb;
        attach(fb);
      } catch { /* noop */ }
    }, 2500);
  }, [attach]);

  // Démarre la caméra selon l'orientation choisie.
  useEffect(() => { startMain(facing); }, [facing, startMain]);

  // Nettoyage : libère les caméras à la fermeture.
  useEffect(() => () => { stopStream(streamRef); stopStream(pipStreamRef); }, []);

  const enableDual = async () => {
    try {
      const s2 = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      pipStreamRef.current = s2;
      if (pipRef.current) { pipRef.current.srcObject = s2; await pipRef.current.play().catch(() => {}); }
      setDual(true);
    } catch {
      toast.error("Double caméra non prise en charge sur cet appareil.");
      setDual(false);
      // L'accès secondaire a pu perturber la caméra principale : on la relance.
      startMain(facing);
    }
  };

  const toggleDual = async () => {
    if (dual) { stopStream(pipStreamRef); setDual(false); return; }
    // iOS/Safari n'autorise qu'UNE caméra à la fois : ouvrir un 2e flux couperait
    // la caméra principale (aperçu noir). La double caméra simultanée n'existe
    // pas en web sur iPhone → on l'annonce sans toucher au flux principal.
    if (IS_IOS) { toast("Double caméra indisponible sur iPhone (limite de Safari)."); return; }
    if (!localStorage.getItem(DUAL_PROMO_KEY)) { setPromo(true); return; }
    await enableDual();
  };

  // Double appui sur l'aperçu → active/désactive la double caméra.
  const onPreviewTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) { lastTapRef.current = 0; toggleDual(); }
    else lastTapRef.current = now;
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    const caps = track?.getCapabilities?.();
    if (track && caps && "torch" in caps) {
      try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); return; }
      catch { /* fallback ci-dessous */ }
    }
    // Pas de vrai flash : on simule un éclair blanc à la capture.
    setTorch((t) => !t);
    if (!torch) toast("Flash simulé (éclair à la capture)", { duration: 1500 });
  };

  const roundRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // Envoi. Peut recevoir l'audience/liste explicitement (utile depuis le
  // sélecteur, où l'état n'est pas encore à jour).
  // Envoi/publication direct. L'audience peut être vide : on publie quand même
  // (pas de mise en attente). Peut recevoir l'audience/liste explicitement.
  const doSend = async (media, aud = audience, list = manual) => {
    setSending(true);
    try {
      const { data } = await axios.post(`${API}/instants`, {
        media,
        caption: caption.trim(),
        audience: aud,
        recipient_ids: aud === "manual" ? list.map((u) => u.id) : [],
      });
      pendingPhotoRef.current = null;
      onSent(data.instant, data.recipients);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Envoi impossible.");
      setSending(false);
    }
  };

  // Capture → ENVOI DIRECT (pas d'étape « reprendre / envoyer »).
  const capture = () => {
    if (sending) return;
    const v = videoRef.current;
    if (!v || !v.videoWidth) { toast.error("Caméra pas encore prête."); return; }
    if (torch) { setFlashPulse(true); setTimeout(() => setFlashPulse(false), 220); }
    const w = v.videoWidth, h = v.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    // Caméra frontale : miroir naturel (comme le viseur).
    if (facing === "user") { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Double caméra : incruste la frontale en médaillon (haut gauche).
    const pv = pipRef.current;
    if (dual && pv && pv.videoWidth) {
      const pw = Math.round(w * 0.30);
      const ph = Math.round(pw * (pv.videoHeight / pv.videoWidth || 1.4));
      const x = Math.round(w * 0.04), y = Math.round(w * 0.04);
      ctx.save(); roundRect(ctx, x, y, pw, ph, pw * 0.14); ctx.clip();
      ctx.translate(x + pw, y); ctx.scale(-1, 1);
      ctx.drawImage(pv, 0, 0, pw, ph); ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineWidth = Math.max(4, w * 0.006); ctx.strokeStyle = "rgba(255,255,255,0.9)";
      roundRect(ctx, x, y, pw, ph, pw * 0.14); ctx.stroke();
    }
    const media = canvas.toDataURL("image/jpeg", 0.85);
    // IMPORTANT : on garde la caméra ALLUMÉE. Si on coupait le flux ici,
    // l'aperçu resterait noir dès que l'envoi échoue (ex. audience sans
    // destinataire). Les flux sont libérés à la fermeture de l'écran.
    doSend(media);
  };

  const audienceLabel = { mutuals: "Mutuels", close_friends: "Ami·e·s proches", manual: manual.length ? `Sélection (${manual.length})` : "Sélection" }[audience];

  return (
    <div className="fixed inset-0 z-[80] flex flex-col select-none"
      style={{ background: C.bg, WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}>
      {/* Barre supérieure */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2" style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10" aria-label="Fermer">
          <span className="material-symbols-outlined" style={{ color: "#fff" }}>close</span>
        </button>
        <span className="font-bold text-white">Nouvel instantané</span>
        <button onClick={onOpenArchive} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10" aria-label="Archive">
          <span className="material-symbols-outlined" style={{ color: "#fff" }}>grid_view</span>
        </button>
      </div>

      {/* Zone viseur / aperçu */}
      <div className="flex-1 flex items-center justify-center px-4 min-h-0">
        <div className="relative w-full" style={{ maxWidth: 460 }}>
          <div className="relative overflow-hidden rounded-[36px] bg-black" style={{ aspectRatio: "3 / 4" }} onClick={onPreviewTap}>
            <video ref={videoRef} muted playsInline autoPlay
              className="w-full h-full object-cover"
              style={{ transform: facing === "user" ? "scaleX(-1)" : "none" }} />
            {/* Médaillon double caméra (frontale) */}
            <video ref={pipRef} muted playsInline autoPlay
              className="absolute top-3 left-3 rounded-2xl object-cover border-2 border-white/90 shadow-lg"
              style={{ width: "30%", aspectRatio: "3 / 4", transform: "scaleX(-1)", display: dual ? "block" : "none" }} />
            {flashPulse && <div className="absolute inset-0 bg-white" style={{ opacity: 0.85 }} />}
            {!ready && !sending && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: "rgba(0,0,0,0.35)" }}>
                <div className="animate-spin rounded-full h-9 w-9 border-b-2" style={{ borderColor: C.accent }} />
                <span className="text-[12px] text-white/70">Initialisation de la caméra…</span>
              </div>
            )}
            {sending && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
                <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: C.accent }} />
              </div>
            )}
            {showHint && !IS_IOS && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] px-3 py-1 rounded-full text-white/80 transition-opacity"
                style={{ background: "rgba(0,0,0,0.4)" }}>
                Double-appui : {dual ? "désactiver" : "activer"} la double caméra
              </div>
            )}
          </div>

          {/* Légende (avant la prise). L'envoi est immédiat à la capture. */}
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 200))}
            placeholder="Ajouter une légende…"
            className="mt-4 w-full text-center text-sm px-4 py-2.5 rounded-full border-none outline-none placeholder:text-white/40"
            style={{ background: "rgba(255,255,255,0.08)", color: "#fff", WebkitUserSelect: "text", userSelect: "text" }}
          />
        </div>
      </div>

      {/* Commandes du bas — la capture ENVOIE directement (pas de reprendre/envoyer). */}
      <div className="px-6 pb-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}>
        <div className="flex items-center justify-between">
          <button onClick={toggleTorch} className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.1)" }} aria-label="Flash">
            <span className="material-symbols-outlined" style={{ color: torch ? C.accent : "#fff" }}>
              {torch ? "flash_on" : "flash_off"}
            </span>
          </button>

          <button onClick={capture} disabled={sending || !ready} className="relative w-[76px] h-[76px] rounded-full active:scale-95 transition-transform disabled:opacity-40" aria-label="Prendre et envoyer">
            <span className="absolute inset-0 rounded-full border-4 border-white/70" />
            <span className="absolute inset-[6px] rounded-full bg-white" />
          </button>

          <button onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.1)" }} aria-label="Changer de caméra">
            <span className="material-symbols-outlined" style={{ color: "#fff" }}>cameraswitch</span>
          </button>
        </div>

        {/* Pilule audience */}
        <div className="flex justify-center mt-5">
          <button onClick={() => { setSheetMode(null); setSheet(true); }} className="flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm"
            style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}>
            <span className="material-symbols-outlined text-lg" style={{ color: C.accent }}>group</span>
            {audienceLabel}
            <span className="material-symbols-outlined text-lg">expand_more</span>
          </button>
        </div>
      </div>

      {sheet && (
        <AudienceSheet
          user={user} audience={audience} manual={manual} initialMode={sheetMode}
          onClose={() => { setSheet(false); pendingPhotoRef.current = null; }}
          onPick={(a, list) => {
            setAudience(a); if (list) setManual(list); setSheet(false);
            // Si une photo attend des destinataires (capture en audience vide), on l'envoie.
            if (pendingPhotoRef.current) doSend(pendingPhotoRef.current, a, list || manual);
          }}
        />
      )}

      {promo && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => { localStorage.setItem(DUAL_PROMO_KEY, "1"); setPromo(false); }}>
          <div className="w-full max-w-md m-3 mb-6 rounded-3xl p-6" style={{ background: C.container }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-2xl font-black text-white leading-tight mb-2">Créez des instantanés avec vos 2 caméras simultanément</h3>
            <p className="text-sm mb-6" style={{ color: C.onVariant }}>Vous pouvez désormais utiliser vos caméras avant et arrière en même temps.</p>
            <button onClick={() => { localStorage.setItem(DUAL_PROMO_KEY, "1"); setPromo(false); enableDual(); }}
              className="w-full py-3.5 rounded-2xl font-black mb-2" style={{ background: `linear-gradient(135deg,${C.accent},#3b82f6)`, color: C.onPrimary }}>
              Essayer
            </button>
            <button onClick={() => { localStorage.setItem(DUAL_PROMO_KEY, "1"); setPromo(false); }}
              className="w-full py-3 rounded-2xl font-bold" style={{ color: C.accent }}>Plus tard</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sélecteur d'audience (+ édition Ami·e·s proches / Sélection manuelle)
// ──────────────────────────────────────────────────────────────────────────
function AudienceSheet({ user, audience, manual, onClose, onPick, initialMode = null }) {
  const [mode, setMode] = useState(initialMode);       // null | "manual" | "close"
  const [selected, setSelected] = useState(manual || []);
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

  const toggle = (u) => setSelected((prev) => prev.find((x) => x.id === u.id) ? prev.filter((x) => x.id !== u.id) : [...prev, u]);

  const confirm = async () => {
    if (mode === "close") {
      setSaving(true);
      try { await axios.put(`${API}/instants/close-friends`, { ids: selected.map((u) => u.id) }); }
      catch { /* best-effort */ }
      setSaving(false);
      onPick("close_friends");
    } else {
      onPick("manual", selected);
    }
  };

  const Row = ({ children, onClick, active }) => (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
      style={{ background: active ? `${C.accent}1a` : "transparent" }}>{children}</button>
  );

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl p-4 pb-6 max-h-[80vh] overflow-y-auto"
        style={{ background: C.surface, paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1.5 rounded-full mx-auto mb-4" style={{ background: C.high }} />

        {!mode ? (
          <>
            <h3 className="font-black text-lg mb-3 px-1" style={{ color: C.onSurface }}>Envoyer à…</h3>
            <Row onClick={() => onPick("mutuals")} active={audience === "mutuals"}>
              <span className="material-symbols-outlined" style={{ color: C.accent }}>groups</span>
              <div className="flex-1"><p className="font-bold" style={{ color: C.onSurface }}>Mutuels</p><p className="text-xs" style={{ color: C.outline }}>Les personnes qui vous suivent mutuellement</p></div>
              {audience === "mutuals" && <span className="material-symbols-outlined" style={{ color: C.accent }}>check_circle</span>}
            </Row>
            <Row onClick={() => setMode("close")} active={audience === "close_friends"}>
              <span className="material-symbols-outlined" style={{ color: "#22c55e" }}>star</span>
              <div className="flex-1"><p className="font-bold" style={{ color: C.onSurface }}>Ami·e·s proches</p><p className="text-xs" style={{ color: C.outline }}>Votre liste privée (modifiable)</p></div>
              <span className="material-symbols-outlined" style={{ color: C.outline }}>chevron_right</span>
            </Row>
            <Row onClick={() => { setSelected(manual || []); setMode("manual"); }} active={audience === "manual"}>
              <span className="material-symbols-outlined" style={{ color: C.accent }}>person_add</span>
              <div className="flex-1"><p className="font-bold" style={{ color: C.onSurface }}>Sélection</p><p className="text-xs" style={{ color: C.outline }}>Choisir des destinataires précis</p></div>
              <span className="material-symbols-outlined" style={{ color: C.outline }}>chevron_right</span>
            </Row>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => setMode(null)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/5">
                <span className="material-symbols-outlined" style={{ color: C.onSurface }}>arrow_back</span>
              </button>
              <h3 className="font-black text-lg" style={{ color: C.onSurface }}>{mode === "close" ? "Ami·e·s proches" : "Sélection"}</h3>
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un·e utilisateur·rice…"
              className="w-full text-sm px-4 py-2.5 rounded-xl border-none outline-none mb-3 placeholder:text-slate-500"
              style={{ background: C.high, color: C.onSurface, WebkitUserSelect: "text", userSelect: "text" }} />
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
              {saving ? "Enregistrement…" : mode === "close" ? "Enregistrer & choisir" : `Envoyer à ${selected.length || 0} destinataire${selected.length > 1 ? "s" : ""}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Lecteur d'un instantané reçu (visible UNE fois)
// ──────────────────────────────────────────────────────────────────────────
function InstantViewer({ item, onClose, onConsumed }) {
  const [data, setData] = useState(null);
  const [gone, setGone] = useState(false);
  const [reply, setReply] = useState("");
  const [reacted, setReacted] = useState(null);
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;      // consomme une seule fois
    startedRef.current = true;
    (async () => {
      try {
        const r = await axios.post(`${API}/instants/${item.id}/view`);
        setData(r.data);
        onConsumed?.(item.id);
      } catch (e) {
        setGone(true);
        onConsumed?.(item.id);
        toast(e.response?.data?.detail || "Cet instantané a disparu.");
      }
    })();
  }, [item, onConsumed]);

  const react = async (emoji) => {
    setReacted(emoji);
    try { await axios.post(`${API}/instants/${item.id}/react`, { emoji }); toast("Réaction envoyée"); }
    catch (e) { toast.error(e.response?.data?.detail || "Impossible de réagir."); }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await axios.post(`${API}/instants/${item.id}/reply`, { content: reply.trim() });
      setReply("");
      toast("Réponse envoyée en message privé");
    } catch (e) { toast.error(e.response?.data?.detail || "Réponse impossible."); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[85] flex flex-col select-none"
      style={{ background: "#000", WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}>
      <div className="flex items-center gap-3 px-4 pt-3 pb-2" style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
        <Avatar username={item.author_username} pic={item.author_avatar} size={36} ring />
        <span className="font-bold text-white flex-1">@{item.author_username}</span>
        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10">
          <span className="material-symbols-outlined text-white">close</span>
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center min-h-0 px-2">
        {gone ? (
          <div className="text-center px-6">
            <span className="material-symbols-outlined text-5xl mb-2" style={{ color: C.outline }}>visibility_off</span>
            <p className="text-white/80">Cet instantané n'est plus disponible.</p>
          </div>
        ) : data ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <img src={data.media_url} alt="Instantané" className="max-w-full max-h-full object-contain rounded-2xl" />
            {data.caption && (
              <p className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[90%] text-center text-white text-sm px-4 py-2 rounded-2xl"
                style={{ background: "rgba(0,0,0,0.45)" }}>{data.caption}</p>
            )}
          </div>
        ) : (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: C.accent }} />
        )}
      </div>

      {data && !gone && (
        <div className="px-4 pb-4" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}>
          <div className="flex justify-center gap-2 mb-3">
            {REACT_EMOJIS.map((e) => (
              <button key={e} onClick={() => react(e)} className="text-2xl active:scale-125 transition-transform"
                style={{ opacity: reacted && reacted !== e ? 0.4 : 1 }}>{e}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input value={reply} onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendReply(); }}
              placeholder="Répondre en privé…"
              className="flex-1 text-sm px-4 py-3 rounded-full border-none outline-none placeholder:text-white/40"
              style={{ background: "rgba(255,255,255,0.1)", color: "#fff", WebkitUserSelect: "text", userSelect: "text" }} />
            <button onClick={sendReply} disabled={busy || !reply.trim()} className="w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40"
              style={{ background: `linear-gradient(135deg,${C.accent},#3b82f6)`, color: C.onPrimary }}>
              <span className="material-symbols-outlined">send</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Archive privée des instantanés envoyés
// ──────────────────────────────────────────────────────────────────────────
function InstantsArchive({ onClose, onChanged }) {
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    axios.get(`${API}/instants/archive`).then((r) => setItems(r.data || [])).catch(() => setItems([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const cancel = async (id) => {
    try {
      await axios.delete(`${API}/instants/${id}`);
      setItems((prev) => (prev || []).map((i) => (i.id === id ? { ...i, canceled: true, active: false } : i)));
      setOpen(null);
      onChanged?.();
      toast("Instantané annulé");
    } catch (e) { toast.error(e.response?.data?.detail || "Annulation impossible."); }
  };

  return (
    <div className="fixed inset-0 z-[85] flex flex-col select-none"
      style={{ background: C.bg, WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}>
      <div className="flex items-center gap-3 px-4 pt-3 pb-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)", paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10">
          <span className="material-symbols-outlined text-white">arrow_back</span>
        </button>
        <div className="flex-1">
          <p className="font-bold text-white">Vos instantanés</p>
          <p className="text-[11px]" style={{ color: C.outline }}>Archive privée · conservés 1 an</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {items === null ? (
          <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: C.accent }} /></div>
        ) : items.length === 0 ? (
          <div className="text-center pt-20 px-8">
            <span className="material-symbols-outlined text-5xl mb-2" style={{ color: C.outline }}>bolt</span>
            <p style={{ color: C.onVariant }}>Aucun instantané envoyé pour le moment.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {items.map((it) => (
              <button key={it.id} onClick={() => setOpen(it)} className="relative rounded-xl overflow-hidden" style={{ aspectRatio: "3 / 4", background: C.container }}>
                <img src={it.media_url} alt="" className="w-full h-full object-cover" style={{ opacity: it.canceled ? 0.35 : 1 }} />
                <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 flex items-center justify-between text-[10px] font-bold text-white"
                  style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent)" }}>
                  <span className="flex items-center gap-0.5"><span className="material-symbols-outlined text-[13px]">visibility</span>{it.seen}/{it.recipients}</span>
                  {it.canceled ? <span style={{ color: "#f87171" }}>Annulé</span> : it.active ? <span style={{ color: C.accent }}>Actif</span> : <span style={{ color: C.outline }}>Expiré</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-[90] flex flex-col" style={{ background: "#000" }} onClick={() => setOpen(null)}>
          <div className="flex items-center justify-end px-4 pt-3" style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
            <button className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10"><span className="material-symbols-outlined text-white">close</span></button>
          </div>
          <div className="flex-1 flex items-center justify-center min-h-0 px-3" onClick={(e) => e.stopPropagation()}>
            <img src={open.media_url} alt="" className="max-w-full max-h-full object-contain rounded-2xl" />
          </div>
          <div className="px-4 pb-6 pt-3" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}>
            {open.caption && <p className="text-center text-white/90 text-sm mb-2">{open.caption}</p>}
            <p className="text-center text-xs mb-3" style={{ color: C.outline }}>
              Vu par {open.seen}/{open.recipients} · {open.reactions?.length || 0} réaction{(open.reactions?.length || 0) > 1 ? "s" : ""}
              {open.reactions?.length ? "  " + open.reactions.map((r) => r.emoji).join(" ") : ""}
            </p>
            {!open.canceled && open.active && (
              <button onClick={() => cancel(open.id)} className="w-full py-3 rounded-2xl font-bold" style={{ background: "rgba(248,113,113,0.15)", color: "#f87171" }}>
                Annuler cet instantané
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Point d'entrée : FAB + bandeau reçus + orchestration des overlays
// ──────────────────────────────────────────────────────────────────────────
export default function InstantsEntry({ user, hidden = false }) {
  const [inbox, setInbox] = useState([]);
  const [screen, setScreen] = useState(null);   // null | "camera" | "archive"
  const [viewing, setViewing] = useState(null);  // item reçu en cours de lecture
  const [undo, setUndo] = useState(null);        // {id} instantané envoyé (annulable)
  const undoTimer = useRef(null);

  // Instantanés = MOBILE uniquement (désactivé sur PC).
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 1023px)").matches : true);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  const loadInbox = useCallback(() => {
    axios.get(`${API}/instants/inbox`).then((r) => setInbox(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user || !isMobile) return;
    loadInbox();
    const poll = setInterval(loadInbox, 25000);
    const onRealtime = (e) => {
      const t = e.detail?.type;
      if (t === "instant" || t === "instant_canceled") loadInbox();
    };
    const onOpen = () => setScreen("camera");
    window.addEventListener("nexus:realtime", onRealtime);
    window.addEventListener("nexus:instant-open", onOpen);
    return () => {
      clearInterval(poll);
      window.removeEventListener("nexus:realtime", onRealtime);
      window.removeEventListener("nexus:instant-open", onOpen);
    };
  }, [user, isMobile, loadInbox]);

  const onSent = (instant, recipients) => {
    setScreen(null);
    toast.success(recipients > 0
      ? `Instantané envoyé à ${recipients} destinataire${recipients > 1 ? "s" : ""}`
      : "Instantané publié");
    // Fenêtre d'annulation ~6 s.
    setUndo({ id: instant.id });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  };

  const doUndo = async () => {
    if (!undo) return;
    const id = undo.id;
    setUndo(null); clearTimeout(undoTimer.current);
    try { await axios.delete(`${API}/instants/${id}`); toast("Envoi annulé"); }
    catch (e) { toast.error(e.response?.data?.detail || "Trop tard pour annuler."); }
  };

  const consume = (id) => setInbox((prev) => prev.filter((i) => i.id !== id));

  if (!user || !isMobile) return null;   // mobile uniquement

  return (
    <>
      {/* Bandeau des instantanés reçus (pile d'avatars) */}
      {!hidden && !screen && !viewing && inbox.length > 0 && (
        <div className="fixed z-[55] left-1/2 -translate-x-1/2" style={{ top: "calc(max(env(safe-area-inset-top), 8px) + 6px)" }}>
          <button onClick={() => setViewing(inbox[0])}
            className="flex items-center gap-2 pl-2 pr-4 py-1.5 rounded-full shadow-xl"
            style={{ background: C.container, border: `1px solid ${C.accent}33` }}>
            <div className="flex -space-x-2">
              {inbox.slice(0, 3).map((i) => (
                <Avatar key={i.id} username={i.author_username} pic={i.author_avatar} size={30} ring />
              ))}
            </div>
            <span className="text-sm font-bold" style={{ color: C.onSurface }}>
              {inbox.length} instantané{inbox.length > 1 ? "s" : ""}
            </span>
          </button>
        </div>
      )}

      {/* FAB caméra « + » */}
      {!hidden && !screen && !viewing && (
        <button onClick={() => setScreen("camera")} aria-label="Nouvel instantané"
          className="fixed z-[55] flex items-center justify-center rounded-2xl shadow-2xl active:scale-95 transition-transform"
          style={{
            width: 60, height: 60,
            right: "16px", bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
            background: `linear-gradient(135deg,${C.accent},#3b82f6)`, color: C.onPrimary,
          }}>
          <span className="material-symbols-outlined" style={{ fontSize: 30 }}>photo_camera</span>
          {inbox.length > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center text-[11px] font-black"
              style={{ background: "#f87171", color: "#fff", border: `2px solid ${C.surface}` }}>{inbox.length}</span>
          )}
        </button>
      )}

      {/* Snackbar « Annuler » juste après l'envoi */}
      {undo && (
        <div className="fixed z-[70] left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 90px)", background: C.high, color: C.onSurface }}>
          <span className="text-sm font-semibold">Instantané envoyé</span>
          <button onClick={doUndo} className="text-sm font-black" style={{ color: C.accent }}>Annuler</button>
        </div>
      )}

      {screen === "camera" && (
        <InstantsCamera user={user} onClose={() => setScreen(null)} onSent={onSent} onOpenArchive={() => setScreen("archive")} />
      )}
      {screen === "archive" && (
        <InstantsArchive onClose={() => setScreen(null)} onChanged={loadInbox} />
      )}
      {viewing && (
        <InstantViewer item={viewing} onClose={() => setViewing(null)} onConsumed={consume} />
      )}
    </>
  );
}
