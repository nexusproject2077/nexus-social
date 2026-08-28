// Composer de Story façon Instagram.
//  • Caméra PLEIN ÉCRAN. Rail de modes à gauche (Créer/Boomerang/Layout/Mains
//    libres) dont les libellés s'estompent après quelques secondes.
//  • Photo (appui court) / vidéo (appui long, max 15 s) ou import galerie.
//  • Écran d'édition : rail d'outils à droite (Aa texte, stickers, musique,
//    effets/filtres), « Ajoutez une légende… », pastilles de publication
//    (Votre story / Ami·e·s proches) + flèche.
//  • Enchaîner plusieurs médias (segments). Visibilité everyone/close/custom.
//  • Édition riche (photos) : filtres (presets CSS), dessin à main levée, et
//    stickers déplaçables (emoji, sondage, questions, musique) — le tout
//    « cuit » dans l'image à la publication.
import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { API } from "../App";
import { toast } from "sonner";
import { PreviewAudio } from "@/lib/silentAudio";
import i18n from "@/i18n";

const ACCENT =
  (typeof window !== "undefined" &&
    window.localStorage.getItem("nexus_accent")) ||
  "#22d3ee";
const C = {
  bg: "#000",
  surface: "#0b1326",
  container: "#171f33",
  high: "#222a3d",
  accent: ACCENT,
  onPrimary: "#00363e",
  onSurface: "#dae2fd",
  onVariant: "#bbc9cd",
  outline: "#859397",
};
const MAX_VIDEO_MS = 15000;
const MAX_IMPORT = 10 * 1024 * 1024; // Stories : légères (éphémères, courtes)
const MAX_IMPORT_CLIP = 50 * 1024 * 1024; // Clips : vidéos plus longues (upload Cloudinary)

// ── POLITIQUE ÉTHIQUE : filtres CHROMATIQUES uniquement ───────────────────────
// Choix produit assumé (santé des jeunes) : AUCUN filtre ne déforme la
// morphologie du visage (yeux, nez, structure). On n'autorise que des réglages
// colorimétriques (luminosité, saturation, contraste, teinte, sépia, N&B). Les
// fonctions CSS géométriques (blur au sens flou de peau « beauté », ou toute
// transformation de forme) sont INTERDITES. Le garde-fou `assertChromatic`
// ci-dessous fait échouer bruyamment toute tentative d'ajout non conforme.
const CHROMATIC_FN =
  /^(none|brightness|contrast|saturate|grayscale|sepia|invert|hue-rotate|opacity)$/;
const assertChromatic = (css) => {
  if (!css || css === "none") return css;
  for (const m of css.matchAll(/([a-z-]+)\(/g)) {
    if (!CHROMATIC_FN.test(m[1])) {
      // eslint-disable-next-line no-console
      console.error(`Filtre non conforme (non chromatique) rejeté: ${m[1]}()`);
      return "none";
    }
  }
  return css;
};

const FILTERS = [
  { key: "none", label: "Normal", css: "none" },
  {
    key: "eclat",
    label: "Éclat",
    css: "brightness(1.08) saturate(1.18) contrast(1.05)",
  },
  {
    key: "chaud",
    label: "Chaud",
    css: "sepia(0.25) saturate(1.3) brightness(1.05)",
  },
  {
    key: "froid",
    label: "Froid",
    css: "saturate(1.1) brightness(1.03) contrast(1.05) hue-rotate(-12deg)",
  },
  { key: "nb", label: "N&B", css: "grayscale(1) contrast(1.1)" },
  {
    key: "vintage",
    label: "Vintage",
    css: "sepia(0.5) contrast(0.9) brightness(1.05) saturate(1.2)",
  },
  { key: "vif", label: "Vif", css: "saturate(1.6) contrast(1.12)" },
].map((f) => ({ ...f, css: assertChromatic(f.css) }));

// Modes du rail gauche (façon Instagram).
const MODES = [
  { key: "create", label: "Créer", txt: "Aa" },
  { key: "boomerang", label: "Boomerang", icon: "all_inclusive" },
  { key: "layout", label: "Layout", icon: "grid_view" },
  { key: "hands", label: "Mains libres", icon: "back_hand" },
];

// Fonds pour le mode « Créer ».
const BACKGROUNDS = [
  {
    id: "g1",
    css: "linear-gradient(135deg,#22d3ee,#3b82f6)",
    colors: ["#22d3ee", "#3b82f6"],
  },
  {
    id: "g2",
    css: "linear-gradient(135deg,#ec4899,#f59e0b)",
    colors: ["#ec4899", "#f59e0b"],
  },
  {
    id: "g3",
    css: "linear-gradient(135deg,#8b5cf6,#ec4899)",
    colors: ["#8b5cf6", "#ec4899"],
  },
  {
    id: "g4",
    css: "linear-gradient(135deg,#22c55e,#14b8a6)",
    colors: ["#22c55e", "#14b8a6"],
  },
  {
    id: "g5",
    css: "linear-gradient(135deg,#f43f5e,#8b5cf6)",
    colors: ["#f43f5e", "#8b5cf6"],
  },
  { id: "d1", css: "#0b1326", colors: ["#0b1326"] },
  { id: "d2", css: "#000000", colors: ["#000000"] },
  { id: "w1", css: "#ffffff", colors: ["#ffffff"] },
  { id: "r1", css: "#ef4444", colors: ["#ef4444"] },
  { id: "b1", css: "#3b82f6", colors: ["#3b82f6"] },
];
const LAYOUTS = [2, 3, 4, 6];

// Formats de capture Nexus Clips (sélecteur coulissant façon TikTok).
// Les durées pilotent la limite d'enregistrement (clipDurRef). Nexus Clips est
// un format VIDÉO → on ne propose que des durées (pas de photo/texte, qui
// n'auraient pas leur place dans le fil Clips et finiraient en impasse).
const CLIP_FORMATS = [
  { key: "3min", label: "3 min", ms: 180000 },
  { key: "60s", label: "60 s", ms: 60000 },
  { key: "15s", label: "15 s", ms: 15000 },
];

function Avatar({ username, pic, size = 32 }) {
  const s = `${size}px`;
  return pic ? (
    <img
      src={pic}
      alt={username}
      className="rounded-full object-cover"
      style={{ width: s, height: s }}
    />
  ) : (
    <div
      className="rounded-full flex items-center justify-center font-bold"
      style={{
        width: s,
        height: s,
        fontSize: size * 0.4,
        background: "linear-gradient(135deg,#22d3ee,#3b82f6)",
        color: C.onPrimary,
      }}
    >
      {username?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

const uid = () => Math.random().toString(36).slice(2);
const blobToDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
const loadImg = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const EMOJIS = [
  "❤️",
  "😂",
  "😍",
  "🔥",
  "😮",
  "👏",
  "🙏",
  "😢",
  "🎉",
  "✨",
  "💯",
  "😎",
  "🥳",
  "👍",
  "😭",
  "🤔",
  "💀",
  "👀",
  "🙌",
  "🍀",
  "⭐",
  "🌈",
  "☀️",
  "🥰",
];

export default function StoryComposer({
  user,
  onClose,
  onPublished,
  target = "story",
}) {
  const isClip = target === "clip";
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordingRef = useRef(false);
  const pressRef = useRef({ timer: null, longPress: false });
  const progressRef = useRef(null);
  const maxRef = useRef(null);
  const rafRef = useRef(null);
  const editVideoRef = useRef(null); // aperçu vidéo de l'éditeur (avec son)

  const [facing, setFacing] = useState("user");
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordPct, setRecordPct] = useState(0);
  const [showLabels, setShowLabels] = useState(true);

  const [mode, setMode] = useState("camera"); // "camera" | "edit"
  const [segments, setSegments] = useState([]); // [{ media, type, text, filter }]
  const [cur, setCur] = useState(null); // { media, type }
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("none"); // key
  const [showFilters, setShowFilters] = useState(false);

  const [visibility, setVisibility] = useState("everyone");
  const [customList, setCustomList] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // ── Édition riche (stickers / dessin) ──
  const stageRef = useRef(null);
  const drawCanvasRef = useRef(null);
  const drawingActiveRef = useRef(false);
  const dragRef = useRef(null);
  const [overlays, setOverlays] = useState([]); // {id,type,x,y,...}
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState("#ffffff");
  const [stickerMenu, setStickerMenu] = useState(false);
  const [emojiPicker, setEmojiPicker] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [stickerForm, setStickerForm] = useState(null); // "poll"|"question"|"link"|"location"|"mention"|"hashtag"|"slider"|"countdown"
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const resizeRef = useRef(null);
  const [selectedId, setSelectedId] = useState(null);
  const [eraser, setEraser] = useState(false);
  const [textEditor, setTextEditor] = useState(null); // {id?, text, color}
  // Aperçu musique via Web Audio (pas de session « Now Playing » iOS → aucun
  // indicateur son dans la barre d'état / Dynamic Island).
  const audioRef = useRef(null);
  if (!audioRef.current) audioRef.current = new PreviewAudio();
  const [music, setMusic] = useState(null); // {url,title,artist}
  const [musicOpen, setMusicOpen] = useState(false);
  const [camMode, setCamMode] = useState("normal"); // normal | boomerang | layout
  const [makingBoomerang, setMakingBoomerang] = useState(false);
  const [layoutN, setLayoutN] = useState(null); // 2 | 3 | 4 | 6
  const [layoutCells, setLayoutCells] = useState([]); // dataURL | null
  const layoutFileRef = useRef(null);
  const layoutTargetRef = useRef(0);

  // ── Capture Nexus Clips (interface façon TikTok) ──
  const [clipFmt, setClipFmt] = useState("60s"); // format sélectionné
  const [beauty, setBeauty] = useState(false); // retouche (filtre doux live)
  const [timerSec, setTimerSec] = useState(0); // 0 | 3 | 10 (minuteur)
  const [countdown, setCountdown] = useState(0); // décompte en cours
  const clipDurRef = useRef(60000); // limite d'enreg. selon le format
  const countdownRef = useRef(null);

  // Choix d'un format : met à jour la limite d'enregistrement (vidéo).
  const pickFormat = (f) => {
    if (recordingRef.current) return;
    setClipFmt(f.key);
    if (f.ms) clipDurRef.current = f.ms;
  };
  // Minuteur : off → 3 s → 10 s → off.
  const cycleTimer = () => setTimerSec((s) => (s === 0 ? 3 : s === 3 ? 10 : 0));
  // Exécute une action après le décompte du minuteur (ou immédiatement si off).
  const runTimer = (fn) => {
    if (!timerSec) {
      fn();
      return;
    }
    let n = timerSec;
    setCountdown(n);
    clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countdownRef.current);
        setCountdown(0);
        fn();
      } else setCountdown(n);
    }, 1000);
  };
  // Bouton d'obturation Clips : tap = démarrer / arrêter l'enregistrement.
  const onClipShutter = () => {
    if (!ready) return;
    if (recordingRef.current) {
      stopRec();
      return;
    }
    runTimer(startRec);
  };

  // Applique une musique : passage de départ (start) + style d'affichage
  // ("title" = sticker titre, "cover" = pochette+titre, "none" = son seul).
  const applyMusic = (track, start, style) => {
    setMusic({
      url: track.preview_url,
      title: track.title,
      artist: track.artist,
      artwork: track.artwork,
      start: start || 0,
    });
    setOverlays((ov) => {
      const without = ov.filter((o) => o.type !== "music");
      if (style === "none") return without;
      return [
        ...without,
        {
          id: uid(),
          x: 0.5,
          y: 0.78,
          scale: 1,
          type: "music",
          title: track.title,
          artwork: style === "cover" ? track.artwork : null,
        },
      ];
    });
    setMusicOpen(false);
    // Joue la musique dans l'éditeur pour l'écouter/tester.
    try {
      audioRef.current?.play(track.preview_url, start || 0);
    } catch {
      /* noop */
    }
  };
  const stopMusicPreview = () => {
    try {
      audioRef.current?.pause();
    } catch {
      /* noop */
    }
  };

  const filterCss = FILTERS.find((f) => f.key === filter)?.css || "none";
  const curFit = cur?.fit || (cur?.type === "image" ? "cover" : "contain");
  const canEdit = cur?.type === "image" || cur?.type === "background"; // texte/stickers/dessin (cuits)

  // Mesure la scène d'édition (pour cuire stickers/dessin aux bonnes positions).
  useEffect(() => {
    if (mode !== "edit") return;
    const measure = () => {
      const r = stageRef.current?.getBoundingClientRect();
      if (r) setStage({ w: r.width, h: r.height });
    };
    measure();
    const t = setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [mode, cur]);

  const stopStream = () => {
    try {
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch {
      /* noop */
    }
    streamRef.current = null;
  };

  const attach = useCallback((stream) => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    const mark = () => {
      if (v.videoWidth > 0) setReady(true);
    };
    v.onloadedmetadata = () => {
      v.play?.().catch(() => {});
      mark();
    };
    v.onplaying = mark;
    v.play?.()
      .then(mark)
      .catch(() => {});
  }, []);

  const startCam = useCallback(
    async (f) => {
      stopStream();
      setReady(false);
      setTorch(false);
      // audio: true → les vidéos auront du SON (aperçu vidéo resté muet).
      let stream = null;
      // Caméra STANDARD : pas de contrainte de résolution (forcer 9:16 recadrait
      // le capteur sur iPhone → effet « zoom »). On garde le champ de vision natif.
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: f } },
          audio: true,
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: f } },
            audio: false,
          });
        } catch {
          toast.error(i18n.t("story.err_camera"));
          return;
        }
      }
      streamRef.current = stream;
      attach(stream);
    },
    [attach],
  );

  useEffect(() => {
    if (mode === "camera") startCam(facing);
    else stopStream();
  }, [facing, mode, startCam]);
  useEffect(() => {
    // Libellés du rail : visibles quelques secondes puis s'estompent.
    setShowLabels(true);
    const t = setTimeout(() => setShowLabels(false), 3500);
    return () => clearTimeout(t);
  }, [mode]);
  useEffect(
    () => () => {
      stopStream();
      clearTimeout(maxRef.current);
      clearInterval(progressRef.current);
      clearTimeout(pressRef.current.timer);
      clearInterval(countdownRef.current);
      cancelAnimationFrame(rafRef.current);
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        try {
          r.stop();
        } catch {
          /* noop */
        }
      }
      try {
        audioRef.current?.destroy();
      } catch {
        /* noop */
      }
    },
    [],
  );

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    const caps = track?.getCapabilities?.();
    if (track && caps && "torch" in caps) {
      try {
        await track.applyConstraints({ advanced: [{ torch: !torch }] });
        setTorch(!torch);
        return;
      } catch {
        /* noop */
      }
    }
    setTorch((t) => !t);
  };

  // ── Capture ───────────────────────────────────────────────────────────────
  const toEdit = (media, type, fit = "contain", extra = {}) => {
    setCur({ media, type, fit, ...extra });
    setText("");
    setFilter("none");
    setShowFilters(false);
    setOverlays([]);
    setDrawMode(false);
    setStickerMenu(false);
    setEmojiPicker(false);
    setStickerForm(null);
    setMusic(null);
    stopMusicPreview();
    setSelectedId(null);
    if (drawCanvasRef.current) {
      const c = drawCanvasRef.current;
      c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    }
    setMode("edit");
  };

  const capturePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    // Recadrage 9:16 centré (comme l'aperçu plein écran).
    const vw = v.videoWidth,
      vh = v.videoHeight,
      target = 9 / 16;
    let cw = vw,
      ch = Math.round(vw / target);
    if (ch > vh) {
      ch = vh;
      cw = Math.round(vh * target);
    }
    const sx = Math.round((vw - cw) / 2),
      sy = Math.round((vh - ch) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (facing === "user") {
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, sx, sy, cw, ch, 0, 0, cw, ch);
    toEdit(canvas.toDataURL("image/jpeg", 0.85), "image", "cover");
  };

  const stopRec = () => {
    clearTimeout(maxRef.current);
    clearInterval(progressRef.current);
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {
        /* noop */
      }
    }
  };
  // Enregistrement du FLUX CAMÉRA brut (fiable partout, y compris iOS où le
  // captureStream d'un canvas renvoie du noir). Le son est inclus (audio:true).
  // La caméra frontale sera remise « à l'endroit » via un flag « mirror ».
  const startRec = () => {
    const src = streamRef.current;
    if (!src || typeof MediaRecorder === "undefined") {
      toast.error(i18n.t("story.err_video_unsupported"));
      return;
    }
    let mime = "";
    for (const m of [
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ]) {
      if (MediaRecorder.isTypeSupported?.(m)) {
        mime = m;
        break;
      }
    }
    let r;
    try {
      r = new MediaRecorder(src, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: 3_000_000,
      });
    } catch {
      toast.error(i18n.t("story.err_video_unsupported"));
      return;
    }
    const mir = facing === "user";
    chunksRef.current = [];
    r.ondataavailable = (e) => {
      if (e.data && e.data.size) chunksRef.current.push(e.data);
    };
    r.onstop = () => {
      recordingRef.current = false;
      setRecording(false);
      setRecordPct(0);
      const blob = new Blob(chunksRef.current, {
        type: r.mimeType || mime || "video/webm",
      });
      chunksRef.current = [];
      // Aperçu via blob URL (iOS lit mal les vidéos data:) ; base64 à la publication.
      if (blob.size > 0)
        toEdit(URL.createObjectURL(blob), "video", "cover", {
          mirror: mir,
          blob,
        });
    };
    recorderRef.current = r;
    recordingRef.current = true;
    setRecording(true);
    setRecordPct(0);
    try {
      r.start();
    } catch {
      recordingRef.current = false;
      setRecording(false);
      return;
    }
    const limitMs = isClip ? clipDurRef.current : MAX_VIDEO_MS;
    const t0 = Date.now();
    progressRef.current = setInterval(
      () => setRecordPct(Math.min(100, ((Date.now() - t0) / limitMs) * 100)),
      80,
    );
    maxRef.current = setTimeout(stopRec, limitMs);
  };

  const onShutterDown = (e) => {
    // Boomerang & Mains libres : déclenchés au relâchement (pas de maintien).
    if (!ready || camMode === "boomerang" || camMode === "hands") return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    pressRef.current.longPress = false;
    clearTimeout(pressRef.current.timer);
    pressRef.current.timer = setTimeout(() => {
      pressRef.current.longPress = true;
      startRec();
    }, 280);
  };
  const onShutterUp = () => {
    if (camMode === "boomerang") {
      if (ready) recordBoomerang();
      return;
    }
    if (camMode === "hands") {
      if (recordingRef.current) stopRec();
      else if (ready) startRec();
      return;
    }
    clearTimeout(pressRef.current.timer);
    if (recordingRef.current) {
      stopRec();
      return;
    }
    if (!pressRef.current.longPress) capturePhoto();
  };

  const onImport = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {
      toast.error(i18n.t("story.err_img_video_only"));
      return;
    }
    const limit = isClip ? MAX_IMPORT_CLIP : MAX_IMPORT;
    if (f.size > limit) {
      toast.error(
        i18n.t("story.file_too_large", { mb: Math.round(limit / 1024 / 1024) }),
      );
      return;
    }
    if (f.type.startsWith("video/")) {
      // Vidéo : aperçu via blob URL (fiable iOS), base64 à la publication.
      toEdit(URL.createObjectURL(f), "video", "cover", { blob: f });
    } else {
      const fr = new FileReader();
      fr.onload = () => toEdit(fr.result, "image", "contain");
      fr.readAsDataURL(f);
    }
  };

  const onModeTap = (m) => {
    setShowLabels(true);
    clearTimeout(maxRef.current);
    if (m === "create") {
      toEdit(null, "background", "cover", { bg: BACKGROUNDS[0] });
      return;
    }
    if (m === "boomerang") {
      setCamMode("boomerang");
      toast(i18n.t("story.boomerang_hint"));
    } else if (m === "layout") {
      setCamMode("layout");
      setLayoutN(null);
      setLayoutCells([]);
    } else if (m === "hands") {
      setCamMode("hands");
      toast(i18n.t("story.hands_hint"));
    }
    setTimeout(() => setShowLabels(false), 3500);
  };

  // ── Boomerang : capture courte → boucle aller-retour ré-encodée ────────────
  const recordBoomerang = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || makingBoomerang) return;
    setMakingBoomerang(true);
    try {
      const W = 480,
        H = Math.round((W * 16) / 9);
      const grab = document.createElement("canvas");
      grab.width = W;
      grab.height = H;
      const gctx = grab.getContext("2d");
      const frames = [];
      const drawFrame = () => {
        const vw = v.videoWidth,
          vh = v.videoHeight,
          tR = 9 / 16;
        let cw = vw,
          ch = Math.round(vw / tR);
        if (ch > vh) {
          ch = vh;
          cw = Math.round(vh * tR);
        }
        const sx = (vw - cw) / 2,
          sy = (vh - ch) / 2;
        gctx.save();
        if (facing === "user") {
          gctx.translate(W, 0);
          gctx.scale(-1, 1);
        }
        gctx.drawImage(v, sx, sy, cw, ch, 0, 0, W, H);
        gctx.restore();
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        c.getContext("2d").drawImage(grab, 0, 0);
        frames.push(c);
      };
      for (let i = 0; i < 26; i++) {
        drawFrame();
        await new Promise((r) => setTimeout(r, 55));
      }
      const seq = frames.concat(frames.slice(1, -1).reverse());

      const out = document.createElement("canvas");
      out.width = W;
      out.height = H;
      const octx = out.getContext("2d");
      if (typeof out.captureStream !== "function") {
        // iOS/Safari sans captureStream : repli → court clip vidéo (bouclé).
        setMakingBoomerang(false);
        toast(i18n.t("story.boomerang_fallback"));
        startRec();
        setTimeout(stopRec, 1400);
        return;
      }
      const stream = out.captureStream(24);
      let mime = "";
      for (const mm of ["video/mp4", "video/webm;codecs=vp9", "video/webm"])
        if (MediaRecorder.isTypeSupported?.(mm)) {
          mime = mm;
          break;
        }
      const rec = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: 3_000_000,
      });
      const chunks = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      const done = new Promise((resolve) => {
        rec.onstop = () =>
          resolve(
            new Blob(chunks, { type: rec.mimeType || mime || "video/webm" }),
          );
      });
      rec.start();
      const frameMs = 1000 / 24;
      for (let pass = 0; pass < 2; pass++) {
        for (const fr of seq) {
          octx.drawImage(fr, 0, 0);
          await new Promise((r) => setTimeout(r, frameMs));
        }
      }
      rec.stop();
      const blob = await done;
      setMakingBoomerang(false);
      setCamMode("normal");
      toEdit(URL.createObjectURL(blob), "video", "cover", { blob });
    } catch {
      setMakingBoomerang(false);
      toast.error(i18n.t("story.err_boomerang"));
    }
  };

  // ── Layout : grille collage 2–6 photos → une image ─────────────────────────
  const layoutNextEmpty = () => layoutCells.findIndex((c) => !c);
  const captureLayoutCell = () => {
    const i = layoutNextEmpty();
    if (i < 0) return;
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const s = Math.min(v.videoWidth, v.videoHeight);
    const sx = (v.videoWidth - s) / 2,
      sy = (v.videoHeight - s) / 2;
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 640;
    const ctx = c.getContext("2d");
    if (facing === "user") {
      ctx.translate(640, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, sx, sy, s, s, 0, 0, 640, 640);
    setLayoutCells((cells) =>
      cells.map((x, j) => (j === i ? c.toDataURL("image/jpeg", 0.85) : x)),
    );
  };
  const importLayoutCell = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !f.type.startsWith("image/")) return;
    const i = layoutTargetRef.current;
    const fr = new FileReader();
    fr.onload = () =>
      setLayoutCells((cells) => cells.map((x, j) => (j === i ? fr.result : x)));
    fr.readAsDataURL(f);
  };
  const finishLayout = async () => {
    if (layoutCells.some((c) => !c)) {
      toast.error(i18n.t("story.err_fill_all"));
      return;
    }
    const grid = { 2: [1, 2], 3: [1, 3], 4: [2, 2], 6: [2, 3] }[layoutN];
    const [cols, rows] = grid;
    const W = 1080,
      H = 1920;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const cw = W / cols,
      ch = H / rows;
    for (let i = 0; i < layoutN; i++) {
      try {
        const img = await loadImg(layoutCells[i]);
        const cx = (i % cols) * cw,
          cy = Math.floor(i / cols) * ch;
        const iR = img.naturalWidth / img.naturalHeight,
          cR = cw / ch;
        let dw, dh;
        if (iR > cR) {
          dh = ch;
          dw = ch * iR;
        } else {
          dw = cw;
          dh = cw / iR;
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx, cy, cw, ch);
        ctx.clip();
        ctx.drawImage(img, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh);
        ctx.restore();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 8;
        ctx.strokeRect(cx, cy, cw, ch);
      } catch {
        /* skip */
      }
    }
    setCamMode("normal");
    setLayoutN(null);
    setLayoutCells([]);
    toEdit(canvas.toDataURL("image/jpeg", 0.9), "image", "cover");
  };

  // ── Édition riche : dessin, drag des stickers ─────────────────────────────
  const drawStart = (e) => {
    if (!drawMode) return;
    const c = drawCanvasRef.current;
    if (!c) return;
    drawingActiveRef.current = true;
    try {
      c.setPointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    const ctx = c.getContext("2d");
    const r = c.getBoundingClientRect();
    ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    ctx.strokeStyle = eraser ? "rgba(0,0,0,1)" : drawColor;
    ctx.lineWidth = eraser
      ? Math.max(18, c.width * 0.035)
      : Math.max(4, c.width * 0.012);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(
      (e.clientX - r.left) * (c.width / r.width),
      (e.clientY - r.top) * (c.height / r.height),
    );
  };
  const drawMove = (e) => {
    if (!drawMode || !drawingActiveRef.current) return;
    const c = drawCanvasRef.current;
    const ctx = c.getContext("2d");
    const r = c.getBoundingClientRect();
    ctx.lineTo(
      (e.clientX - r.left) * (c.width / r.width),
      (e.clientY - r.top) * (c.height / r.height),
    );
    ctx.stroke();
  };
  const drawEnd = () => {
    drawingActiveRef.current = false;
  };
  const clearDraw = () => {
    const c = drawCanvasRef.current;
    if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
  };

  // ── Gestes tactiles FLUIDES (déplacer + zoom + rotation) ───────────────────
  // Clé de la fluidité « façon Instagram » : pendant le geste on met à jour le
  // transform du sticker DIRECTEMENT dans le DOM (aucun setState par frame → 0
  // saccade), et on ne « commit » l'état React qu'au relâchement du doigt.
  //   • 1 doigt  → déplacer
  //   • 2 doigts → zoom (pincer) + rotation, simultanément
  const gRef = useRef(null); // geste multi-touch en cours sur un sticker
  const hRef = useRef(null); // geste via la poignée coin (1 doigt : zoom+rotation)

  const _geom = (pts) => {
    const a = [...pts.values()];
    if (a.length < 2)
      return { cx: a[0]?.x || 0, cy: a[0]?.y || 0, dist: 1, ang: 0 };
    return {
      cx: (a[0].x + a[1].x) / 2,
      cy: (a[0].y + a[1].y) / 2,
      dist: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1,
      ang: Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x),
    };
  };
  const _applyLive = (el, v) => {
    if (!el) return;
    el.style.left = `${v.x * 100}%`;
    el.style.top = `${v.y * 100}%`;
    el.style.transform = `translate(-50%,-50%) rotate(${v.rotate}deg) scale(${v.scale})`;
  };
  const _rebase = (g) => {
    g.baseGeom = _geom(g.pointers);
    g.baseVal = { ...g.live };
  };

  const ovDown = (e, o) => {
    if (drawMode) return;
    e.stopPropagation();
    const el = e.currentTarget;
    setSelectedId(o.id);
    let g = gRef.current;
    if (!g || g.id !== o.id) {
      g = {
        id: o.id,
        el,
        pointers: new Map(),
        live: { x: o.x, y: o.y, scale: o.scale || 1, rotate: o.rotate || 0 },
      };
      gRef.current = g;
    }
    g.el = el;
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    _rebase(g);
  };
  const ovMove = (e) => {
    const g = gRef.current;
    if (!g || !g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    const now = _geom(g.pointers),
      base = g.baseGeom,
      bv = g.baseVal;
    let x = bv.x + (now.cx - base.cx) / r.width;
    let y = bv.y + (now.cy - base.cy) / r.height;
    let scale = bv.scale,
      rotate = bv.rotate;
    if (g.pointers.size >= 2) {
      scale = Math.min(6, Math.max(0.3, bv.scale * (now.dist / base.dist)));
      rotate = bv.rotate + ((now.ang - base.ang) * 180) / Math.PI;
    }
    g.live = {
      x: Math.min(1.12, Math.max(-0.12, x)),
      y: Math.min(1.12, Math.max(-0.12, y)),
      scale,
      rotate,
    };
    _applyLive(g.el, g.live);
  };
  const ovUp = (e) => {
    const g = gRef.current;
    if (!g) return;
    g.pointers.delete(e.pointerId);
    try {
      g.el?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    if (g.pointers.size > 0) {
      _rebase(g);
      return;
    } // encore un doigt posé → on rebase
    const v = g.live;
    setOverlays((ov) =>
      ov.map((o) =>
        o.id === g.id
          ? { ...o, x: v.x, y: v.y, scale: v.scale, rotate: v.rotate }
          : o,
      ),
    );
    gRef.current = null;
  };

  // Poignée coin : zoom + rotation à un doigt (précision / desktop).
  const rzDown = (e, o) => {
    e.stopPropagation();
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    const el = e.currentTarget.closest("[data-ov]");
    const cx = r.left + o.x * r.width,
      cy = r.top + o.y * r.height;
    hRef.current = {
      id: o.id,
      el,
      cx,
      cy,
      startDist: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
      startAng: Math.atan2(e.clientY - cy, e.clientX - cx),
      baseScale: o.scale || 1,
      baseRot: o.rotate || 0,
      x: o.x,
      y: o.y,
      live: { scale: o.scale || 1, rotate: o.rotate || 0 },
    };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
  };
  const rzMove = (e) => {
    const h = hRef.current;
    if (!h) return;
    const d = Math.hypot(e.clientX - h.cx, e.clientY - h.cy) || 1;
    const a = Math.atan2(e.clientY - h.cy, e.clientX - h.cx);
    h.live = {
      scale: Math.min(6, Math.max(0.3, h.baseScale * (d / h.startDist))),
      rotate: h.baseRot + ((a - h.startAng) * 180) / Math.PI,
    };
    _applyLive(h.el, {
      x: h.x,
      y: h.y,
      scale: h.live.scale,
      rotate: h.live.rotate,
    });
  };
  const rzUp = (e) => {
    const h = hRef.current;
    if (!h) return;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    setOverlays((ov) =>
      ov.map((o) =>
        o.id === h.id
          ? { ...o, scale: h.live.scale, rotate: h.live.rotate }
          : o,
      ),
    );
    hRef.current = null;
  };

  const addOverlay = (o) => {
    setOverlays((ov) => [
      ...ov,
      { id: uid(), x: 0.5, y: 0.42, scale: 1, rotate: 0, ...o },
    ]);
    setStickerMenu(false);
    setEmojiPicker(false);
    setStickerForm(null);
    setGifOpen(false);
  };

  // Météo : géolocalisation + open-meteo (gratuit, sans clé). Repli propre si refus.
  const weatherIcon = (code) => {
    if (code === 0) return "☀️";
    if ([1, 2].includes(code)) return "🌤️";
    if (code === 3) return "☁️";
    if ([45, 48].includes(code)) return "🌫️";
    if (code >= 51 && code <= 67) return "🌧️";
    if (code >= 71 && code <= 77) return "🌨️";
    if (code >= 80 && code <= 82) return "🌦️";
    if (code >= 95) return "⛈️";
    return "🌡️";
  };
  const addWeather = () => {
    setStickerMenu(false);
    const fallback = () =>
      addOverlay({ type: "weather", temp: null, icon: "🌡️" });
    if (!navigator.geolocation) return fallback();
    toast.message(i18n.t("story.locating"));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const r = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`,
          );
          const j = await r.json();
          const cw = j.current_weather || {};
          addOverlay({
            type: "weather",
            temp: cw.temperature != null ? Math.round(cw.temperature) : null,
            icon: weatherIcon(cw.weathercode),
          });
        } catch {
          fallback();
        }
      },
      () => fallback(),
      { timeout: 8000, maximumAge: 600000 },
    );
  };
  const removeOverlay = (id) =>
    setOverlays((ov) => ov.filter((o) => o.id !== id));

  const wrap = (ctx, t, maxW) => {
    const words = String(t || "").split(" ");
    const lines = [];
    let line = "";
    for (const wd of words) {
      const s = line ? line + " " + wd : wd;
      if (ctx.measureText(s).width > maxW && line) {
        lines.push(line);
        line = wd;
      } else line = s;
    }
    if (line) lines.push(line);
    return lines.slice(0, 4);
  };
  // Cuisson : média (filtré) + dessin + stickers → une seule image JPEG.
  const composeImage = async () => {
    const st = stage.w
      ? stage
      : {
          w: stageRef.current?.clientWidth || 1080,
          h: stageRef.current?.clientHeight || 1920,
        };
    const scale = Math.min(2, 1080 / Math.max(1, st.w));
    const W = Math.round(st.w * scale),
      H = Math.round(st.h * scale);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (cur.type === "background") {
      const bg = cur.bg;
      if (bg?.colors?.length > 1) {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, bg.colors[0]);
        g.addColorStop(1, bg.colors[1]);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = bg?.colors?.[0] || "#0b1326";
      }
      ctx.fillRect(0, 0, W, H);
    } else {
      try {
        const img = await loadImg(cur.media);
        const iR = img.naturalWidth / img.naturalHeight,
          sR = W / H;
        let dw, dh;
        if (curFit === "cover") {
          if (iR > sR) {
            dh = H;
            dw = H * iR;
          } else {
            dw = W;
            dh = W / iR;
          }
        } else {
          if (iR > sR) {
            dw = W;
            dh = W / iR;
          } else {
            dh = H;
            dw = H * iR;
          }
        }
        ctx.save();
        ctx.filter = filterCss;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
        ctx.restore();
      } catch {
        /* fond noir */
      }
    }
    const dc = drawCanvasRef.current;
    if (dc && dc.width) {
      try {
        ctx.drawImage(dc, 0, 0, W, H);
      } catch {
        /* noop */
      }
    }
    // Pré-charge les GIF (CORS) pour pouvoir les incruster dans l'image cuite.
    const gifImgs = {};
    await Promise.all(
      overlays
        .filter((o) => o.type === "gif" && o.url)
        .map(
          (o) =>
            new Promise((res) => {
              const im = new Image();
              im.crossOrigin = "anonymous";
              im.onload = () => {
                gifImgs[o.id] = im;
                res();
              };
              im.onerror = () => res();
              im.src = o.url;
            }),
        ),
    );
    for (const o of overlays) paintOverlay(ctx, o, W, H, gifImgs[o.id]);
    return canvas.toDataURL("image/jpeg", 0.9);
  };

  const paintOverlay = (ctx, o, W, H, gimg) => {
    const S = W * (o.scale || 1); // base d'échelle (positions inchangées, tailles × scale)
    ctx.save();
    ctx.translate(o.x * W, o.y * H); // centre du sticker
    ctx.rotate(((o.rotate || 0) * Math.PI) / 180); // rotation autour du centre
    const px = 0,
      py = 0; // tout est dessiné autour de l'origine
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = S * 0.03;
    ctx.shadowOffsetY = S * 0.012;
    // Petit utilitaire « pilule » (lien / lieu / mention).
    const chip = (label, bg, fg) => {
      ctx.font = `700 ${Math.round(S * 0.04)}px sans-serif`;
      const w = Math.min(S * 0.9, ctx.measureText(label).width + S * 0.09),
        h = S * 0.09;
      ctx.fillStyle = bg;
      roundRect(ctx, px - w / 2, py - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.fillText(label, px, py);
    };
    if (o.type === "link") {
      chip(`🔗  ${o.label || o.url}`, "#ffffff", "#111");
    } else if (o.type === "location") {
      chip(`📍  ${o.place}`, "#f97316", "#fff");
    } else if (o.type === "mention") {
      chip(`@${(o.username || "").replace(/^@/, "")}`, "#22d3ee", "#00252b");
    } else if (o.type === "hashtag") {
      ctx.font = `900 ${Math.round(S * 0.075)}px sans-serif`;
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = S * 0.02;
      ctx.shadowOffsetY = S * 0.008;
      ctx.fillStyle = "#fff";
      ctx.fillText(`#${(o.tag || "").replace(/^#/, "")}`, px, py);
    } else if (o.type === "gif") {
      if (gimg && gimg.width) {
        const w = S * 0.42,
          h = w * (gimg.height / gimg.width || 1);
        try {
          ctx.drawImage(gimg, px - w / 2, py - h / 2, w, h);
        } catch {
          /* taint */
        }
      }
    } else if (o.type === "time") {
      const now = new Date();
      ctx.font = `900 ${Math.round(S * 0.07)}px sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.fillText(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
        px,
        py,
      );
    } else if (o.type === "weather") {
      const now = new Date();
      const label = `${o.icon || "☀️"}  ${o.temp != null ? o.temp + "°" : ""}  ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      ctx.font = `700 ${Math.round(S * 0.05)}px sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.fillText(label, px, py);
    } else if (o.type === "slider") {
      const w = S * 0.74,
        pad = S * 0.045;
      ctx.font = `700 ${Math.round(S * 0.042)}px sans-serif`;
      const lines = wrap(
        ctx,
        o.q || i18n.t("story.slider_default"),
        w - pad * 2,
      );
      const lh = S * 0.055,
        trackH = S * 0.02,
        h = pad + lh * lines.length + pad + S * 0.08 + pad;
      ctx.fillStyle = "#fff";
      roundRect(ctx, px - w / 2, py - h / 2, w, h, S * 0.04);
      ctx.fill();
      ctx.fillStyle = "#111";
      lines.forEach((ln, i) =>
        ctx.fillText(ln, px, py - h / 2 + pad + lh / 2 + i * lh),
      );
      const ty = py + h / 2 - pad - S * 0.04;
      ctx.fillStyle = "#dbe4ff";
      roundRect(
        ctx,
        px - (w - pad * 2) / 2,
        ty - trackH / 2,
        w - pad * 2,
        trackH,
        trackH / 2,
      );
      ctx.fill();
      ctx.font = `${Math.round(S * 0.075)}px "Apple Color Emoji","Segoe UI Emoji",serif`;
      ctx.fillText(o.emoji || "😍", px + (w - pad * 2) * 0.12, ty);
    } else if (o.type === "countdown") {
      const ms = Math.max(
        0,
        new Date(o.target || Date.now()).getTime() - Date.now(),
      );
      const s = Math.floor(ms / 1000);
      const parts = `${Math.floor(s / 86400)}j ${String(Math.floor((s % 86400) / 3600)).padStart(2, "0")}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
      const w = S * 0.62,
        h = S * 0.16;
      ctx.fillStyle = "#7c3aed";
      roundRect(ctx, px - w / 2, py - h / 2, w, h, S * 0.04);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `900 ${Math.round(S * 0.052)}px sans-serif`;
      ctx.fillText(parts, px, py - S * 0.02);
      ctx.font = `700 ${Math.round(S * 0.03)}px sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(
        (o.title || i18n.t("story.countdown_default")).slice(0, 30),
        px,
        py + S * 0.045,
      );
    } else if (o.type === "text") {
      const size = Math.round(S * 0.06);
      ctx.font = `800 ${size}px sans-serif`;
      const lines = wrap(ctx, o.text, S * 0.86);
      const lh = size * 1.2;
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = size * 0.15;
      ctx.shadowOffsetY = size * 0.06;
      ctx.fillStyle = o.color || "#fff";
      lines.forEach((ln, i) =>
        ctx.fillText(ln, px, py - ((lines.length - 1) * lh) / 2 + i * lh),
      );
    } else if (o.type === "emoji") {
      ctx.font = `${Math.round(S * 0.13)}px "Apple Color Emoji","Segoe UI Emoji",serif`;
      ctx.fillText(o.emoji, px, py);
    } else if (o.type === "music") {
      ctx.font = `600 ${Math.round(S * 0.042)}px sans-serif`;
      const label = `♫  ${o.title}`;
      const w = Math.min(S * 0.82, ctx.measureText(label).width + S * 0.09),
        h = S * 0.1;
      ctx.fillStyle = "#fff";
      roundRect(ctx, px - w / 2, py - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.fillText(label, px, py);
    } else if (o.type === "question") {
      const w = S * 0.7,
        pad = S * 0.04;
      ctx.font = `700 ${Math.round(S * 0.045)}px sans-serif`;
      const lines = wrap(ctx, o.q, w - pad * 2);
      const lh = S * 0.06,
        h = lh * lines.length + pad * 2 + S * 0.075;
      ctx.fillStyle = "#fff";
      roundRect(ctx, px - w / 2, py - h / 2, w, h, S * 0.03);
      ctx.fill();
      ctx.fillStyle = "#111";
      lines.forEach((ln, i) =>
        ctx.fillText(ln, px, py - h / 2 + pad + lh / 2 + i * lh),
      );
      ctx.font = `500 ${Math.round(S * 0.034)}px sans-serif`;
      ctx.fillStyle = "#9aa";
      ctx.fillText(i18n.t("story.reply"), px, py + h / 2 - S * 0.05);
    } else if (o.type === "poll") {
      const w = S * 0.72,
        pad = S * 0.035;
      ctx.font = `700 ${Math.round(S * 0.045)}px sans-serif`;
      const qLines = wrap(ctx, o.q, w - pad * 2);
      const lh = S * 0.06,
        optH = S * 0.11;
      const h = pad + lh * qLines.length + pad + optH + pad;
      ctx.fillStyle = "rgba(255,255,255,0.96)";
      roundRect(ctx, px - w / 2, py - h / 2, w, h, S * 0.035);
      ctx.fill();
      ctx.fillStyle = "#111";
      qLines.forEach((ln, i) =>
        ctx.fillText(ln, px, py - h / 2 + pad + lh / 2 + i * lh),
      );
      const oy = py - h / 2 + pad + lh * qLines.length + pad + optH / 2;
      const half = (w - pad * 3) / 2;
      ctx.font = `700 ${Math.round(S * 0.04)}px sans-serif`;
      [
        ["a", -1],
        ["b", 1],
      ].forEach(([k, dir]) => {
        const cx = px + dir * (half / 2 + pad / 2);
        ctx.fillStyle = k === "a" ? "#22d3ee" : "#3b82f6";
        roundRect(ctx, cx - half / 2, oy - optH / 2, half, optH, S * 0.02);
        ctx.fill();
        ctx.fillStyle = "#00363e";
        ctx.fillText(o[k], cx, oy);
      });
    }
    ctx.restore();
  };

  // ── Segments & publication ───────────────────────────────────────────────
  // Cuit la photo courante (filtre + dessin + stickers) ; la vidéo reste brute.
  const packCurrentBaked = async () => {
    if (!cur) return null;
    if (cur.type === "image" || cur.type === "background")
      return {
        media: await composeImage(),
        type: "image",
        text: text.trim(),
        music,
      };
    // Vidéo : le média stocké côté serveur est en base64 → on convertit le blob.
    const media = cur.blob ? await blobToDataURL(cur.blob) : cur.media;
    return {
      media,
      type: cur.type,
      text: text.trim(),
      music,
      mirror: cur.mirror,
    };
  };

  const addMore = async () => {
    const seg = await packCurrentBaked();
    if (seg) setSegments((s) => [...s, seg]);
    setCur(null);
    setText("");
    setFilter("none");
    setShowFilters(false);
    setOverlays([]);
    setDrawMode(false);
    clearDraw();
    setMode("camera");
  };

  // Publication en tant que CLIP (Nexus Clips) : le média baké (vidéo) est
  // envoyé à /clips. Réutilise toute l'interface caméra du composer.
  const publishClip = async () => {
    setPublishing(true);
    try {
      const curSeg = await packCurrentBaked();
      const all = [...segments];
      if (curSeg) all.push(curSeg);
      const seg = all.find((s) => s.type === "video") || all[0];
      if (!seg) {
        toast.error(i18n.t("story.err_record_clip"));
        setPublishing(false);
        return;
      }
      if (seg.type !== "video") {
        toast.error(i18n.t("story.err_clip_video"));
        setPublishing(false);
        return;
      }
      const blob = await (await fetch(seg.media)).blob();
      const file = new File([blob], `clip_${Date.now()}.mp4`, {
        type: blob.type || "video/mp4",
      });
      const fd = new FormData();
      fd.append("file", file);
      fd.append("caption", (seg.text || text || "").slice(0, 500));
      await axios.post(`${API}/clips`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(i18n.t("story.clip_published"));
      onPublished?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || i18n.t("story.publish_failed"));
      setPublishing(false);
    }
  };

  const publish = async (vis, list) => {
    if (vis === "custom" && (!list || list.length === 0)) {
      setSheet(true);
      return;
    }
    setPublishing(true);
    try {
      const curSeg = await packCurrentBaked();
      const all = [...segments];
      if (curSeg) all.push(curSeg);
      if (all.length === 0) {
        toast.error(i18n.t("story.err_add_media"));
        setPublishing(false);
        return;
      }
      for (const s of all) {
        const fd = new FormData();
        fd.append("media_url", s.media);
        fd.append("media_type", s.type);
        fd.append("audience", vis);
        fd.append("text", s.text || "");
        if (s.music) {
          fd.append("music_url", s.music.url || "");
          fd.append("music_title", s.music.title || "");
          fd.append("music_artist", s.music.artist || "");
          fd.append("music_start", String(s.music.start || 0));
        }
        if (s.mirror) fd.append("mirror", "1");
        if (vis === "custom")
          fd.append("recipient_ids", (list || []).map((u) => u.id).join(","));
        await axios.post(`${API}/stories/`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      window.dispatchEvent(
        new CustomEvent("nexus:realtime", { detail: { type: "story" } }),
      );
      toast.success(
        all.length > 1
          ? i18n.t("story.story_published_multi", { count: all.length })
          : i18n.t("story.story_published"),
      );
      onPublished?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || i18n.t("story.publish_failed"));
      setPublishing(false);
    }
  };

  // ══════════════════════════════════════ CAMÉRA ══════════════════════════════
  if (mode === "camera") {
    // ─────────── Interface de capture Nexus Clips (façon TikTok) ───────────
    if (isClip) {
      const activeCss = FILTERS.find((f) => f.key === filter)?.css || "none";
      // « Éclat » = léger réglage CHROMATIQUE (luminosité/contraste/saturation) —
      // aucune retouche de forme du visage (cf. politique éthique en tête de fichier).
      const beautyCss = assertChromatic(
        "brightness(1.06) contrast(1.03) saturate(1.06)",
      );
      const liveFilter =
        [activeCss !== "none" ? activeCss : "", beauty ? beautyCss : ""]
          .filter(Boolean)
          .join(" ") || "none";
      const tool = (icon, label, active, onClick) => (
        <button
          onClick={onClick}
          className="flex flex-col items-center gap-1"
          aria-label={label}
        >
          <span
            className="material-symbols-outlined text-white"
            style={{
              fontSize: 27,
              fontVariationSettings: "'wght' 300",
              filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.6))",
              opacity: active ? 1 : 0.95,
            }}
          >
            {icon}
          </span>
          <span
            className="text-white text-[10px] font-medium"
            style={{
              textShadow: "0 1px 3px rgba(0,0,0,0.6)",
              color: active ? C.accent : "#fff",
            }}
          >
            {label}
          </span>
        </button>
      );
      return (
        <div
          className="fixed inset-0 z-[80] select-none"
          style={{
            background: "#000",
            WebkitUserSelect: "none",
            userSelect: "none",
            WebkitTouchCallout: "none",
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              transform: facing === "user" ? "scaleX(-1)" : "none",
              filter: liveFilter,
            }}
          />
          {!ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div
                className="animate-spin rounded-full h-9 w-9 border-b-2"
                style={{ borderColor: C.accent }}
              />
              <span className="text-[12px] text-white/70">
                {i18n.t("story.init_camera")}
              </span>
            </div>
          )}

          {/* Décompte du minuteur */}
          {countdown > 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span
                className="text-white font-black"
                style={{
                  fontSize: 96,
                  textShadow: "0 2px 20px rgba(0,0,0,0.5)",
                }}
              >
                {countdown}
              </span>
            </div>
          )}

          {/* Barre supérieure : fermer + capsule « Ajouter un son » */}
          <div
            className="absolute top-0 left-0 right-0 flex items-center px-3"
            style={{ paddingTop: "max(env(safe-area-inset-top), 14px)" }}
          >
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center"
              aria-label={i18n.t("story.close")}
            >
              <span
                className="material-symbols-outlined text-white"
                style={{
                  fontSize: 30,
                  filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.6))",
                }}
              >
                close
              </span>
            </button>
            <button
              onClick={() => setMusicOpen(true)}
              className="mx-auto flex items-center gap-1.5 px-4 h-9 rounded-full active:scale-95 transition-transform"
              style={{
                background: "rgba(0,0,0,0.42)",
                backdropFilter: "blur(6px)",
              }}
            >
              <span
                className="material-symbols-outlined text-white"
                style={{ fontSize: 18 }}
              >
                music_note
              </span>
              <span className="text-white text-[13px] font-semibold truncate max-w-[46vw]">
                {music ? music.title : i18n.t("story.add_sound")}
              </span>
            </button>
            <div className="w-10 h-10" aria-hidden />
          </div>

          {/* Barre d'outils verticale (droite) */}
          <div
            className="absolute right-2.5 flex flex-col gap-5 items-center"
            style={{ top: "calc(max(env(safe-area-inset-top), 14px) + 64px)" }}
          >
            {tool("cameraswitch", i18n.t("story.flip"), false, () =>
              setFacing((f) => (f === "user" ? "environment" : "user")),
            )}
            {tool("auto_fix_high", i18n.t("story.filters"), showFilters, () =>
              setShowFilters((v) => !v),
            )}
            {tool(
              "face_retouching_natural",
              i18n.t("story.retouch"),
              beauty,
              () => setBeauty((v) => !v),
            )}
            {tool(
              "timer",
              timerSec ? `${timerSec}s` : i18n.t("story.timer"),
              timerSec > 0,
              cycleTimer,
            )}
          </div>

          {/* Indicateur d'enregistrement */}
          {recording && (
            <div
              className="absolute top-20 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold text-white"
              style={{ background: "rgba(239,68,68,0.9)" }}
            >
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              {Math.ceil((recordPct / 100) * (clipDurRef.current / 1000))}s
            </div>
          )}

          {/* Carrousel de filtres (miniatures) */}
          {showFilters && (
            <div
              className="absolute left-0 right-0 flex gap-2.5 px-4 overflow-x-auto pb-2"
              style={{
                bottom: "calc(env(safe-area-inset-bottom, 0px) + 12.5rem)",
                scrollbarWidth: "none",
              }}
            >
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className="flex flex-col items-center gap-1 shrink-0"
                >
                  <span
                    className="w-12 h-12 rounded-full border-2 overflow-hidden"
                    style={{
                      borderColor:
                        filter === f.key ? C.accent : "rgba(255,255,255,0.5)",
                      filter: f.css === "none" ? "none" : f.css,
                      background: "linear-gradient(135deg,#22d3ee,#3b82f6)",
                    }}
                  />
                  <span
                    className="text-white text-[10px]"
                    style={{ opacity: filter === f.key ? 1 : 0.75 }}
                  >
                    {i18n.t("story.f_" + f.key)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Bas : sélecteur de format + galerie + obturateur + effets */}
          <div
            className="absolute bottom-0 left-0 right-0"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 22px)" }}
          >
            {!recording && countdown === 0 && (
              <div
                className="flex items-center justify-center gap-6 mb-5 px-6 overflow-x-auto"
                style={{ scrollbarWidth: "none" }}
              >
                {CLIP_FORMATS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => pickFormat(f)}
                    className="shrink-0 text-[13px] font-bold tracking-wide transition-all"
                    style={{
                      color:
                        clipFmt === f.key ? "#fff" : "rgba(255,255,255,0.55)",
                      textShadow: "0 1px 3px rgba(0,0,0,0.6)",
                      transform: clipFmt === f.key ? "scale(1.06)" : "scale(1)",
                    }}
                  >
                    {i18n.t("story.fmt_" + f.key)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between px-9">
              {/* Galerie (bas-gauche) */}
              <button
                onClick={() => fileRef.current?.click()}
                className="w-11 h-11 rounded-xl flex items-center justify-center border-2 border-white/70"
                style={{
                  background: "rgba(255,255,255,0.12)",
                  visibility: recording ? "hidden" : "visible",
                }}
                aria-label={i18n.t("story.gallery")}
              >
                <span
                  className="material-symbols-outlined text-white"
                  style={{ fontSize: 24 }}
                >
                  photo_library
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                onChange={onImport}
                className="hidden"
              />

              {/* Obturateur double-cercle */}
              <button
                onClick={onClipShutter}
                disabled={!ready}
                className="relative w-[84px] h-[84px] rounded-full active:scale-95 transition-transform disabled:opacity-40"
                aria-label={
                  recording ? i18n.t("story.stop") : i18n.t("story.record")
                }
              >
                <span
                  className="absolute inset-0 rounded-full border-[5px]"
                  style={{
                    borderColor: recording
                      ? "#ef4444"
                      : "rgba(255,255,255,0.9)",
                  }}
                />
                {recording ? (
                  <span
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-red-500"
                    style={{ width: 30, height: 30 }}
                  />
                ) : (
                  <span
                    className="absolute inset-[8px] rounded-full"
                    style={{ background: "#ef4444" }}
                  />
                )}
                {recording && (
                  <svg
                    className="absolute inset-0 -rotate-90"
                    viewBox="0 0 84 84"
                    style={{ pointerEvents: "none" }}
                  >
                    <circle
                      cx="42"
                      cy="42"
                      r="39"
                      fill="none"
                      stroke={C.accent}
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 39}
                      strokeDashoffset={
                        (1 - recordPct / 100) * 2 * Math.PI * 39
                      }
                    />
                  </svg>
                )}
              </button>

              {/* Effets (miniature façon carrousel) */}
              <button
                onClick={() => setShowFilters((v) => !v)}
                className="w-11 h-11 rounded-xl flex items-center justify-center border-2 border-white/70"
                style={{
                  background: "rgba(255,255,255,0.12)",
                  visibility: recording ? "hidden" : "visible",
                }}
                aria-label={i18n.t("story.effects")}
              >
                <span
                  className="material-symbols-outlined text-white"
                  style={{
                    fontSize: 24,
                    color: showFilters ? C.accent : "#fff",
                  }}
                >
                  auto_awesome
                </span>
              </button>
            </div>
          </div>

          {musicOpen && (
            <MusicSearch
              onClose={() => setMusicOpen(false)}
              onAdd={applyMusic}
              current={music}
              onRemove={() => {
                setMusic(null);
                stopMusicPreview();
                setMusicOpen(false);
              }}
            />
          )}
        </div>
      );
    }

    return (
      <div
        className="fixed inset-0 z-[80] select-none"
        style={{
          background: "#000",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: facing === "user" ? "scaleX(-1)" : "none" }}
        />
        {!ready && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div
              className="animate-spin rounded-full h-9 w-9 border-b-2"
              style={{ borderColor: C.accent }}
            />
            <span className="text-[12px] text-white/70">
              {i18n.t("story.init_camera")}
            </span>
          </div>
        )}

        {/* Barre supérieure */}
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-3"
          style={{ paddingTop: "max(env(safe-area-inset-top), 14px)" }}
        >
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full"
          >
            <span
              className="material-symbols-outlined text-white"
              style={{ fontSize: 30 }}
            >
              close
            </span>
          </button>
          <button
            onClick={toggleTorch}
            className="w-10 h-10 flex items-center justify-center rounded-full"
          >
            <span className="material-symbols-outlined text-white">
              {torch ? "flash_on" : "flash_off"}
            </span>
          </button>
          <button
            onClick={() => setSheet(true)}
            className="w-10 h-10 flex items-center justify-center rounded-full"
            aria-label={i18n.t("story.visibility")}
          >
            <span className="material-symbols-outlined text-white">
              settings
            </span>
          </button>
        </div>

        {/* Rail de modes (gauche) — libellés qui s'estompent */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-6">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => onModeTap(m.key)}
              className="flex items-center gap-3"
            >
              <span className="w-11 h-11 flex items-center justify-center">
                {m.txt ? (
                  <span
                    className="text-white font-black text-2xl"
                    style={{ fontFamily: "Georgia, serif" }}
                  >
                    {m.txt}
                  </span>
                ) : (
                  <span
                    className="material-symbols-outlined text-white"
                    style={{ fontSize: 28 }}
                  >
                    {m.icon}
                  </span>
                )}
              </span>
              <span
                className="text-white font-bold text-base transition-opacity duration-500"
                style={{
                  opacity: showLabels ? 1 : 0,
                  textShadow: "0 1px 3px rgba(0,0,0,0.6)",
                }}
              >
                {i18n.t("story.m_" + m.key)}
              </span>
            </button>
          ))}
        </div>

        {recording && (
          <div
            className="absolute top-20 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold text-white"
            style={{ background: "rgba(239,68,68,0.9)" }}
          >
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            {Math.min(15, Math.ceil((recordPct / 100) * 15))}s / 15s
          </div>
        )}

        {/* Boomerang en cours de génération */}
        {makingBoomerang && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ background: "rgba(0,0,0,0.55)" }}
          >
            <div
              className="animate-spin rounded-full h-10 w-10 border-b-2"
              style={{ borderColor: C.accent }}
            />
            <span className="text-white/85 text-sm">
              {i18n.t("story.creating_boomerang")}
            </span>
          </div>
        )}

        {/* Grille Layout (par-dessus la caméra) */}
        {camMode === "layout" && layoutN && (
          <div className="absolute inset-x-0 top-24 bottom-40 px-6 flex items-center">
            <div
              className="w-full grid gap-1"
              style={{
                gridTemplateColumns: `repeat(${{ 2: 1, 3: 1, 4: 2, 6: 2 }[layoutN]}, 1fr)`,
                aspectRatio: "9/16",
              }}
            >
              {layoutCells.map((cell, i) => (
                <button
                  key={i}
                  onClick={() =>
                    cell &&
                    setLayoutCells((c) => c.map((x, j) => (j === i ? null : x)))
                  }
                  className="relative overflow-hidden rounded-md flex items-center justify-center"
                  style={{
                    background: "rgba(255,255,255,0.12)",
                    border:
                      layoutNextEmpty() === i
                        ? `2px solid ${C.accent}`
                        : "2px solid rgba(255,255,255,0.25)",
                  }}
                >
                  {cell ? (
                    <img
                      src={cell}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="material-symbols-outlined text-white/60">
                      add
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Barre du bas */}
        <div
          className="absolute bottom-0 left-0 right-0 px-8 pb-6"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
        >
          {camMode === "layout" ? (
            !layoutN ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-white font-semibold text-sm">
                  {i18n.t("story.choose_grid")}
                </p>
                <div className="flex gap-3">
                  {LAYOUTS.map((n) => (
                    <button
                      key={n}
                      onClick={() => {
                        setLayoutN(n);
                        setLayoutCells(Array(n).fill(null));
                      }}
                      className="w-14 h-14 rounded-xl flex items-center justify-center font-black text-lg"
                      style={{
                        background: "rgba(255,255,255,0.15)",
                        color: "#fff",
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setCamMode("normal")}
                  className="text-white/70 text-sm mt-1"
                >
                  {i18n.t("story.cancel")}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => {
                    const i = layoutNextEmpty();
                    layoutTargetRef.current = i < 0 ? 0 : i;
                    layoutFileRef.current?.click();
                  }}
                  disabled={layoutNextEmpty() < 0}
                  className="w-11 h-11 rounded-lg flex items-center justify-center disabled:opacity-40"
                  style={{ background: "rgba(255,255,255,0.15)" }}
                  aria-label={i18n.t("story.import")}
                >
                  <span className="material-symbols-outlined text-white">
                    photo_library
                  </span>
                </button>
                <input
                  ref={layoutFileRef}
                  type="file"
                  accept="image/*"
                  onChange={importLayoutCell}
                  className="hidden"
                />
                {layoutNextEmpty() >= 0 ? (
                  <button
                    onClick={captureLayoutCell}
                    disabled={!ready}
                    className="relative w-[76px] h-[76px] rounded-full active:scale-95 disabled:opacity-40"
                    aria-label={i18n.t("story.fill_cell")}
                  >
                    <span className="absolute inset-0 rounded-full border-[5px] border-white" />
                    <span
                      className="absolute inset-[7px] rounded-full"
                      style={{ background: "rgba(255,255,255,0.9)" }}
                    />
                  </button>
                ) : (
                  <button
                    onClick={finishLayout}
                    className="px-6 h-12 rounded-full font-black"
                    style={{
                      background: `linear-gradient(135deg,${C.accent},#3b82f6)`,
                      color: C.onPrimary,
                    }}
                  >
                    {i18n.t("story.done")}
                  </button>
                )}
                <button
                  onClick={() =>
                    setFacing((f) => (f === "user" ? "environment" : "user"))
                  }
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.15)" }}
                  aria-label={i18n.t("story.switch_camera")}
                >
                  <span className="material-symbols-outlined text-white">
                    cameraswitch
                  </span>
                </button>
              </div>
            )
          ) : (
            <>
              <div className="flex items-center justify-between">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-11 h-11 rounded-lg overflow-hidden flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.15)" }}
                  aria-label={i18n.t("story.gallery")}
                >
                  <span className="material-symbols-outlined text-white">
                    photo_library
                  </span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={onImport}
                  className="hidden"
                />

                <button
                  onPointerDown={onShutterDown}
                  onPointerUp={onShutterUp}
                  onPointerCancel={onShutterUp}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={!ready || makingBoomerang}
                  style={{ touchAction: "none" }}
                  className="relative w-[80px] h-[80px] rounded-full active:scale-95 transition-transform disabled:opacity-40"
                  aria-label={
                    camMode === "boomerang"
                      ? i18n.t("story.boomerang")
                      : i18n.t("story.photo_or_video")
                  }
                >
                  <span
                    className="absolute inset-0 rounded-full border-[5px]"
                    style={{
                      borderColor: recording
                        ? "#ef4444"
                        : camMode === "boomerang" || camMode === "hands"
                          ? C.accent
                          : "#fff",
                    }}
                  />
                  {recording ? (
                    <span
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-red-500"
                      style={{ width: 30, height: 30 }}
                    />
                  ) : (
                    <span
                      className="absolute inset-[7px] rounded-full flex items-center justify-center"
                      style={{ background: "rgba(255,255,255,0.9)" }}
                    >
                      {camMode === "boomerang" && (
                        <span
                          className="material-symbols-outlined"
                          style={{ color: C.accent, fontSize: 30 }}
                        >
                          all_inclusive
                        </span>
                      )}
                      {camMode === "hands" && (
                        <span
                          className="material-symbols-outlined"
                          style={{ color: C.accent, fontSize: 26 }}
                        >
                          back_hand
                        </span>
                      )}
                    </span>
                  )}
                  {recording && (
                    <svg
                      className="absolute inset-0 -rotate-90"
                      viewBox="0 0 80 80"
                      style={{ pointerEvents: "none" }}
                    >
                      <circle
                        cx="40"
                        cy="40"
                        r="37"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 37}
                        strokeDashoffset={
                          (1 - recordPct / 100) * 2 * Math.PI * 37
                        }
                      />
                    </svg>
                  )}
                </button>

                <button
                  onClick={() =>
                    setFacing((f) => (f === "user" ? "environment" : "user"))
                  }
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.15)" }}
                  aria-label={i18n.t("story.switch_camera")}
                >
                  <span className="material-symbols-outlined text-white">
                    cameraswitch
                  </span>
                </button>
              </div>
              <p className="text-center text-white/90 font-bold text-sm mt-4 tracking-wide">
                {camMode === "boomerang"
                  ? i18n.t("story.lbl_boomerang")
                  : camMode === "hands"
                    ? i18n.t("story.lbl_hands")
                    : i18n.t("story.lbl_story")}
              </p>
              {(camMode === "boomerang" || camMode === "hands") && (
                <button
                  onClick={() => {
                    if (recordingRef.current) stopRec();
                    setCamMode("normal");
                  }}
                  className="block mx-auto text-white/60 text-xs mt-1"
                >
                  {i18n.t("story.normal_mode")}
                </button>
              )}
            </>
          )}
        </div>

        {sheet && (
          <VisibilitySheet
            user={user}
            visibility={visibility}
            customList={customList}
            onClose={() => setSheet(false)}
            onPick={(v, list) => {
              setVisibility(v);
              if (list) setCustomList(list);
              setSheet(false);
            }}
          />
        )}
      </div>
    );
  }

  // ══════════════════════════════════════ ÉDITION ═════════════════════════════
  return (
    <div
      className="fixed inset-0 z-[80] select-none"
      style={{
        background: "#000",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      {/* Scène : média (filtré) + dessin + stickers (draggables) */}
      <div
        ref={stageRef}
        className="absolute inset-0"
        onPointerDown={() => {
          setSelectedId(null);
          try {
            editVideoRef.current?.play?.().catch(() => {});
          } catch {
            /* noop */
          }
        }}
      >
        {cur?.type === "background" ? (
          <div
            className="absolute inset-0"
            style={{ background: cur.bg?.css }}
          />
        ) : cur?.type === "video" ? (
          <video
            ref={editVideoRef}
            src={cur.media}
            className="absolute inset-0 w-full h-full"
            style={{
              filter: filterCss,
              objectFit: curFit,
              transform: cur.mirror ? "scaleX(-1)" : "none",
            }}
            autoPlay
            playsInline
            loop
            muted={!!music}
            onCanPlay={(e) => e.currentTarget.play().catch(() => {})}
          />
        ) : (
          <img
            src={cur?.media}
            alt=""
            className="absolute inset-0 w-full h-full"
            style={{ filter: filterCss, objectFit: curFit }}
          />
        )}

        {/* Calque de dessin (photos) */}
        {canEdit && stage.w > 0 && (
          <canvas
            ref={drawCanvasRef}
            width={Math.round(stage.w * 2)}
            height={Math.round(stage.h * 2)}
            className="absolute inset-0 w-full h-full"
            style={{
              touchAction: "none",
              pointerEvents: drawMode ? "auto" : "none",
            }}
            onPointerDown={drawStart}
            onPointerMove={drawMove}
            onPointerUp={drawEnd}
            onPointerCancel={drawEnd}
          />
        )}

        {/* Stickers & textes : déplaçables / zoom / rotation au doigt (fluide) */}
        {overlays.map((o) => (
          <div
            key={o.id}
            data-ov
            onPointerDown={(e) => ovDown(e, o)}
            onPointerMove={ovMove}
            onPointerUp={ovUp}
            onPointerCancel={ovUp}
            className="absolute will-change-transform"
            style={{
              left: `${o.x * 100}%`,
              top: `${o.y * 100}%`,
              transform: `translate(-50%,-50%) rotate(${o.rotate || 0}deg) scale(${o.scale || 1})`,
              touchAction: "none",
              cursor: "move",
              filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.45))",
            }}
          >
            <OverlayView
              o={o}
              selected={selectedId === o.id}
              onRemove={() => {
                removeOverlay(o.id);
                setSelectedId(null);
              }}
              onEdit={
                o.type === "text"
                  ? () =>
                      setTextEditor({ id: o.id, text: o.text, color: o.color })
                  : undefined
              }
              onResizeStart={(e) => rzDown(e, o)}
              onResizeMove={rzMove}
              onResizeEnd={rzUp}
            />
          </div>
        ))}

        {/* Légende incrustée (aperçu) */}
        {text.trim() && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center px-6 pointer-events-none">
            <span
              className="text-center text-white text-2xl font-black leading-snug px-3 py-1 rounded-lg"
              style={{
                background: "rgba(0,0,0,0.35)",
                textShadow: "0 2px 6px rgba(0,0,0,0.5)",
              }}
            >
              {text.trim()}
            </span>
          </div>
        )}
      </div>

      {/* Barre de DESSIN (couleurs) */}
      {drawMode ? (
        <div
          className="absolute top-0 left-0 right-0 flex flex-col gap-2 px-3 pt-3"
          style={{ paddingTop: "max(env(safe-area-inset-top), 14px)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setEraser(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: !eraser ? C.accent : "rgba(0,0,0,0.4)" }}
                aria-label={i18n.t("story.pencil")}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 20,
                    color: !eraser ? C.onPrimary : "#fff",
                  }}
                >
                  edit
                </span>
              </button>
              <button
                onClick={() => setEraser(true)}
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: eraser ? C.accent : "rgba(0,0,0,0.4)" }}
                aria-label={i18n.t("story.eraser")}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 20, color: eraser ? C.onPrimary : "#fff" }}
                >
                  ink_eraser
                </span>
              </button>
              <button
                onClick={clearDraw}
                className="text-white text-sm font-bold px-3 py-1.5 rounded-full"
                style={{ background: "rgba(0,0,0,0.4)" }}
              >
                {i18n.t("story.clear_all")}
              </button>
            </div>
            <button
              onClick={() => {
                setDrawMode(false);
                setEraser(false);
              }}
              className="text-sm font-black px-3 py-1.5 rounded-full flex-shrink-0"
              style={{ background: C.accent, color: C.onPrimary }}
            >
              {i18n.t("story.done")}
            </button>
          </div>
          {!eraser && (
            <div
              className="flex gap-1.5 overflow-x-auto"
              style={{ scrollbarWidth: "none" }}
            >
              {[
                "#ffffff",
                "#000000",
                "#ef4444",
                "#22d3ee",
                "#3b82f6",
                "#22c55e",
                "#eab308",
                "#ec4899",
                "#a855f7",
              ].map((c) => (
                <button
                  key={c}
                  onClick={() => setDrawColor(c)}
                  className="w-7 h-7 rounded-full flex-shrink-0"
                  style={{
                    background: c,
                    border:
                      drawColor === c
                        ? "3px solid #fff"
                        : "2px solid rgba(255,255,255,0.5)",
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* X (haut gauche) */}
          <div
            className="absolute top-0 left-0 px-4 pt-3"
            style={{ paddingTop: "max(env(safe-area-inset-top), 14px)" }}
          >
            <button
              onClick={() => {
                setCur(null);
                setText("");
                setMode("camera");
              }}
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "rgba(0,0,0,0.4)" }}
            >
              <span className="material-symbols-outlined text-white">
                close
              </span>
            </button>
          </div>
          {/* Rail d'outils (haut droite) */}
          <div
            className="absolute top-0 right-0 px-4 pt-3 flex flex-col gap-3"
            style={{ paddingTop: "max(env(safe-area-inset-top), 14px)" }}
          >
            {[
              {
                txt: "Aa",
                label: i18n.t("story.tool_text"),
                on: () =>
                  canEdit
                    ? setTextEditor({ text: "", color: "#ffffff" })
                    : toast(i18n.t("story.text_photos_only")),
              },
              {
                icon: "sentiment_satisfied",
                label: i18n.t("story.tool_stickers"),
                on: () =>
                  canEdit
                    ? setStickerMenu(true)
                    : toast(i18n.t("story.photos_only")),
              },
              {
                icon: "music_note",
                label: i18n.t("story.st_music"),
                on: () => setMusicOpen(true),
              },
              {
                icon: "auto_awesome",
                label: i18n.t("story.effects"),
                on: () =>
                  cur?.type === "background"
                    ? toast(i18n.t("story.filters_photo_video"))
                    : setShowFilters((s) => !s),
              },
              {
                icon: "draw",
                label: i18n.t("story.tool_draw"),
                on: () =>
                  canEdit
                    ? setDrawMode(true)
                    : toast(i18n.t("story.photos_only")),
              },
            ].map((t, i) => (
              <button
                key={i}
                onClick={t.on}
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "rgba(0,0,0,0.4)" }}
                aria-label={t.label}
              >
                {t.txt ? (
                  <span
                    className="text-white font-black text-lg"
                    style={{ fontFamily: "Georgia, serif" }}
                  >
                    {t.txt}
                  </span>
                ) : (
                  <span
                    className="material-symbols-outlined text-white"
                    style={{ fontSize: 22 }}
                  >
                    {t.icon}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Fonds (mode Créer) */}
      {!drawMode && cur?.type === "background" && (
        <div
          className="absolute left-0 right-0 bottom-32 px-3 overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >
          <div className="flex gap-2">
            {BACKGROUNDS.map((bg) => (
              <button
                key={bg.id}
                onClick={() => setCur((c) => ({ ...c, bg }))}
                className="w-10 h-10 rounded-full flex-shrink-0"
                style={{
                  background: bg.css,
                  border:
                    cur.bg?.id === bg.id
                      ? "3px solid #fff"
                      : "2px solid rgba(255,255,255,0.4)",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sélecteur de filtres (si Effets actif, images uniquement) */}
      {!drawMode && showFilters && cur?.type === "image" && (
        <div
          className="absolute left-0 right-0 bottom-32 px-3 overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >
          <div className="flex gap-3">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="flex-shrink-0 flex flex-col items-center gap-1"
              >
                <div
                  className="w-14 h-14 rounded-xl overflow-hidden"
                  style={{
                    border:
                      filter === f.key
                        ? `2px solid ${C.accent}`
                        : "2px solid transparent",
                  }}
                >
                  <img
                    src={cur.media}
                    alt=""
                    className="w-full h-full object-cover"
                    style={{ filter: f.css }}
                  />
                </div>
                <span
                  className="text-[11px]"
                  style={{ color: filter === f.key ? C.accent : "#fff" }}
                >
                  {i18n.t("story.f_" + f.key)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bas : légende + pastilles de publication (masqué en mode dessin) */}
      {!drawMode && (
        <div
          className="absolute bottom-0 left-0 right-0 px-4 pb-5 pt-3"
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom), 18px)",
            background:
              "linear-gradient(to top, rgba(0,0,0,0.55), transparent)",
          }}
        >
          <input
            id="story-caption"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 500))}
            placeholder={
              isClip ? i18n.t("story.caption_clip") : i18n.t("story.caption")
            }
            className="w-full text-sm px-1 py-2 bg-transparent border-none outline-none placeholder:text-white/70 text-white mb-2"
            style={{ WebkitUserSelect: "text", userSelect: "text" }}
          />
          {isClip ? (
            <div className="flex items-center gap-2">
              <button
                onClick={addMore}
                disabled={publishing}
                className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: C.high }}
                aria-label={i18n.t("story.add_media")}
              >
                <span className="material-symbols-outlined text-white">
                  add
                </span>
              </button>
              <button
                onClick={publishClip}
                disabled={publishing}
                className="flex-1 h-11 rounded-full font-black text-sm disabled:opacity-60 flex items-center justify-center gap-2"
                style={{
                  background: `linear-gradient(135deg,${C.accent},#3b82f6)`,
                  color: C.onPrimary,
                }}
              >
                <span className="material-symbols-outlined">movie</span>
                {publishing
                  ? i18n.t("story.publishing")
                  : i18n.t("story.publish_clip")}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => publish("everyone")}
                disabled={publishing}
                className="flex items-center gap-2 pl-1 pr-4 h-11 rounded-full font-bold text-sm disabled:opacity-60"
                style={{ background: C.high, color: "#fff" }}
              >
                <Avatar
                  username={user?.username}
                  pic={user?.profile_pic}
                  size={30}
                />
                {i18n.t("story.your_story")}
              </button>
              <button
                onClick={() => publish("close_friends")}
                disabled={publishing}
                className="flex items-center gap-2 pl-1 pr-4 h-11 rounded-full font-bold text-sm disabled:opacity-60"
                style={{ background: C.high, color: "#fff" }}
              >
                <span
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center"
                  style={{ background: "#22c55e" }}
                >
                  <span
                    className="material-symbols-outlined text-white"
                    style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}
                  >
                    star
                  </span>
                </span>
                {i18n.t("story.close_friends")}
              </button>
              <button
                onClick={addMore}
                disabled={publishing}
                className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: C.high }}
                aria-label={i18n.t("story.add_media")}
              >
                <span className="material-symbols-outlined text-white">
                  add
                </span>
              </button>
              <button
                onClick={() => setSheet(true)}
                disabled={publishing}
                className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: `linear-gradient(135deg,${C.accent},#3b82f6)`,
                  color: C.onPrimary,
                }}
                aria-label={i18n.t("story.publish")}
              >
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            </div>
          )}
          {!isClip && segments.length > 0 && (
            <p className="text-center text-[11px] mt-2 text-white/60">
              {i18n.t("story.media_added", { count: segments.length })}
            </p>
          )}
        </div>
      )}

      {/* Menu stickers */}
      {stickerMenu && (
        <div
          className="fixed inset-0 z-[90] flex items-end"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setStickerMenu(false)}
        >
          <div
            className="w-full rounded-t-3xl p-4 pb-8"
            style={{
              background: C.surface,
              paddingBottom: "max(env(safe-area-inset-bottom), 24px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="w-10 h-1.5 rounded-full mx-auto mb-4"
              style={{ background: C.high }}
            />
            <div className="grid grid-cols-3 gap-2.5 max-h-[60vh] overflow-y-auto">
              {[
                {
                  k: "gif",
                  icon: "gif_box",
                  label: i18n.t("story.st_gif"),
                  on: () => {
                    setStickerMenu(false);
                    setGifOpen(true);
                  },
                },
                {
                  k: "mention",
                  icon: "alternate_email",
                  label: i18n.t("story.st_mention"),
                  on: () => {
                    setStickerMenu(false);
                    setStickerForm("mention");
                  },
                },
                {
                  k: "hashtag",
                  icon: "tag",
                  label: i18n.t("story.st_hashtag"),
                  on: () => {
                    setStickerMenu(false);
                    setStickerForm("hashtag");
                  },
                },
                {
                  k: "link",
                  icon: "link",
                  label: i18n.t("story.st_link"),
                  on: () => {
                    setStickerMenu(false);
                    setStickerForm("link");
                  },
                },
                {
                  k: "location",
                  icon: "location_on",
                  label: i18n.t("story.st_location"),
                  on: () => {
                    setStickerMenu(false);
                    setStickerForm("location");
                  },
                },
                {
                  k: "countdown",
                  icon: "hourglass_top",
                  label: i18n.t("story.st_countdown"),
                  on: () => {
                    setStickerMenu(false);
                    setStickerForm("countdown");
                  },
                },
                {
                  k: "slider",
                  icon: "sentiment_satisfied",
                  label: i18n.t("story.st_slider"),
                  on: () => {
                    setStickerMenu(false);
                    setStickerForm("slider");
                  },
                },
                {
                  k: "poll",
                  icon: "bar_chart",
                  label: i18n.t("story.st_poll"),
                  on: () => {
                    setStickerMenu(false);
                    setStickerForm("poll");
                  },
                },
                {
                  k: "question",
                  icon: "help",
                  label: i18n.t("story.st_question"),
                  on: () => {
                    setStickerMenu(false);
                    setStickerForm("question");
                  },
                },
                {
                  k: "time",
                  icon: "schedule",
                  label: i18n.t("story.st_time"),
                  on: () => addOverlay({ type: "time" }),
                },
                {
                  k: "weather",
                  icon: "partly_cloudy_day",
                  label: i18n.t("story.st_weather"),
                  on: addWeather,
                },
                {
                  k: "emoji",
                  icon: "mood",
                  label: i18n.t("story.st_emoji"),
                  on: () => {
                    setStickerMenu(false);
                    setEmojiPicker(true);
                  },
                },
                {
                  k: "music",
                  icon: "music_note",
                  label: i18n.t("story.st_music"),
                  on: () => {
                    setStickerMenu(false);
                    setMusicOpen(true);
                  },
                },
              ].map((s) => (
                <button
                  key={s.k}
                  onClick={s.on}
                  className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-2xl text-center"
                  style={{ background: C.container }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ color: C.accent }}
                  >
                    {s.icon}
                  </span>
                  <span
                    className="font-bold text-[11px] leading-tight"
                    style={{ color: C.onSurface }}
                  >
                    {i18n.t("story.st_" + s.k)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sélecteur d'emoji */}
      {emojiPicker && (
        <div
          className="fixed inset-0 z-[90] flex items-end"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setEmojiPicker(false)}
        >
          <div
            className="w-full rounded-t-3xl p-4 pb-8"
            style={{
              background: C.surface,
              paddingBottom: "max(env(safe-area-inset-bottom), 24px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="w-10 h-1.5 rounded-full mx-auto mb-4"
              style={{ background: C.high }}
            />
            <div className="grid grid-cols-6 gap-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => addOverlay({ type: "emoji", emoji: e })}
                  className="text-3xl py-1 active:scale-110 transition-transform"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sélecteur de GIF (GIPHY) */}
      {gifOpen && (
        <GifPicker
          onClose={() => setGifOpen(false)}
          onPick={(url) => addOverlay({ type: "gif", url })}
        />
      )}

      {/* Formulaire sticker (sondage / questions / lien / mention / hashtag / lieu / curseur / compte à rebours) */}
      {stickerForm && (
        <StickerForm
          type={stickerForm}
          onCancel={() => setStickerForm(null)}
          onAdd={addOverlay}
        />
      )}

      {/* L'aperçu musique passe par la Web Audio API (PreviewAudio) → aucun
          élément <audio> visible et aucune session « Now Playing » iOS. */}

      {/* Recherche de musique (extraits gratuits iTunes) */}
      {musicOpen && (
        <MusicSearch
          onClose={() => setMusicOpen(false)}
          onAdd={applyMusic}
          current={music}
          onRemove={() => {
            setMusic(null);
            stopMusicPreview();
            setOverlays((ov) => ov.filter((o) => o.type !== "music"));
            setMusicOpen(false);
          }}
        />
      )}

      {/* Éditeur de texte (élément déplaçable, distinct de la légende) */}
      {textEditor && (
        <TextEditor
          value={textEditor}
          onCancel={() => setTextEditor(null)}
          onSave={(t, color) => {
            if (!t.trim()) {
              setTextEditor(null);
              return;
            }
            if (textEditor.id)
              setOverlays((ov) =>
                ov.map((o) =>
                  o.id === textEditor.id ? { ...o, text: t, color } : o,
                ),
              );
            else addOverlay({ type: "text", text: t, color });
            setTextEditor(null);
          }}
        />
      )}

      {sheet && (
        <VisibilitySheet
          user={user}
          visibility={visibility}
          customList={customList}
          onClose={() => setSheet(false)}
          onPick={(v, list) => {
            setVisibility(v);
            if (list) setCustomList(list);
            setSheet(false);
            publish(v, list);
          }}
        />
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
    axios
      .get(`${API}/instants/close-friends`)
      .then((r) => setSelected(r.data || []))
      .catch(() => {});
  }, [mode]);

  useEffect(() => {
    if (!mode || !q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(
          `${API}/users/search?q=${encodeURIComponent(q.trim())}`,
        );
        setResults((r.data || []).filter((u) => u.id !== user?.id));
      } catch {
        /* noop */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, mode, user]);

  const toggle = (u) =>
    setSelected((p) =>
      p.find((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u],
    );

  const confirm = async () => {
    if (mode === "close") {
      setSaving(true);
      try {
        await axios.put(`${API}/instants/close-friends`, {
          ids: selected.map((u) => u.id),
        });
      } catch {
        /* noop */
      }
      setSaving(false);
      onPick("close_friends");
    } else {
      onPick("custom", selected);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl p-4 pb-6 max-h-[80vh] overflow-y-auto"
        style={{
          background: C.surface,
          paddingBottom: "max(env(safe-area-inset-bottom), 20px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-10 h-1.5 rounded-full mx-auto mb-4"
          style={{ background: C.high }}
        />
        {!mode ? (
          <>
            <h3
              className="font-black text-lg mb-3 px-1"
              style={{ color: C.onSurface }}
            >
              {i18n.t("story.who_can_see")}
            </h3>
            <button
              onClick={() => onPick("everyone")}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
              style={{
                background:
                  visibility === "everyone" ? `${C.accent}1a` : "transparent",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ color: C.accent }}
              >
                public
              </span>
              <div className="flex-1">
                <p className="font-bold" style={{ color: C.onSurface }}>
                  {i18n.t("story.everyone")}
                </p>
                <p className="text-xs" style={{ color: C.outline }}>
                  {i18n.t("story.your_followers")}
                </p>
              </div>
              {visibility === "everyone" && (
                <span
                  className="material-symbols-outlined"
                  style={{ color: C.accent }}
                >
                  check_circle
                </span>
              )}
            </button>
            <button
              onClick={() => setMode("close")}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
              style={{
                background:
                  visibility === "close_friends"
                    ? `${C.accent}1a`
                    : "transparent",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ color: "#22c55e" }}
              >
                star
              </span>
              <div className="flex-1">
                <p className="font-bold" style={{ color: C.onSurface }}>
                  {i18n.t("story.close_friends")}
                </p>
                <p className="text-xs" style={{ color: C.outline }}>
                  {i18n.t("story.private_list")}
                </p>
              </div>
              <span
                className="material-symbols-outlined"
                style={{ color: C.outline }}
              >
                chevron_right
              </span>
            </button>
            <button
              onClick={() => {
                setSelected(customList || []);
                setMode("custom");
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
              style={{
                background:
                  visibility === "custom" ? `${C.accent}1a` : "transparent",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ color: C.accent }}
              >
                group
              </span>
              <div className="flex-1">
                <p className="font-bold" style={{ color: C.onSurface }}>
                  {i18n.t("story.custom_list")}
                </p>
                <p className="text-xs" style={{ color: C.outline }}>
                  {i18n.t("story.pick_recipients")}
                </p>
              </div>
              <span
                className="material-symbols-outlined"
                style={{ color: C.outline }}
              >
                chevron_right
              </span>
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => setMode(null)}
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/5"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ color: C.onSurface }}
                >
                  arrow_back
                </span>
              </button>
              <h3 className="font-black text-lg" style={{ color: C.onSurface }}>
                {mode === "close"
                  ? i18n.t("story.close_friends")
                  : i18n.t("story.custom_list_title")}
              </h3>
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={i18n.t("story.ph_search_user")}
              className="w-full text-sm px-4 py-2.5 rounded-xl border-none outline-none mb-3 placeholder:text-slate-500"
              style={{ background: C.high, color: C.onSurface }}
            />
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {selected.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => toggle(u)}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
                    style={{
                      background: `${C.accent}18`,
                      color: C.accent,
                      border: `1px solid ${C.accent}30`,
                    }}
                  >
                    @{u.username}
                    <span className="material-symbols-outlined text-xs">
                      close
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-1 mb-4">
              {results.map((u) => {
                const on = !!selected.find((x) => x.id === u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => toggle(u)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 text-left"
                  >
                    <Avatar
                      username={u.username}
                      pic={u.profile_pic}
                      size={32}
                    />
                    <span
                      className="text-sm font-medium flex-1"
                      style={{ color: C.onSurface }}
                    >
                      @{u.username}
                    </span>
                    <span
                      className="material-symbols-outlined"
                      style={{ color: on ? C.accent : C.outline }}
                    >
                      {on ? "check_circle" : "radio_button_unchecked"}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={confirm}
              disabled={saving || selected.length === 0}
              className="w-full py-3 rounded-2xl font-black disabled:opacity-40"
              style={{
                background: `linear-gradient(135deg,${C.accent},#3b82f6)`,
                color: C.onPrimary,
              }}
            >
              {saving
                ? i18n.t("story.saving")
                : mode === "close"
                  ? i18n.t("story.save_publish")
                  : i18n.t("story.publish_for", {
                      count: selected.length || 0,
                    })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Rendu DOM d'un sticker (miroir du rendu « cuit » sur canvas) ─────────────
// Horloge vivante (sticker Heure / Météo).
function LiveClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <>
      {String(t.getHours()).padStart(2, "0")}:
      {String(t.getMinutes()).padStart(2, "0")}
    </>
  );
}

// Compte à rebours vivant.
function CountdownView({ target }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const ms = Math.max(0, new Date(target || Date.now()).getTime() - now);
  const s = Math.floor(ms / 1000);
  const box = (v, l) => (
    <div className="flex flex-col items-center">
      <span className="font-black" style={{ fontSize: 22, lineHeight: 1 }}>
        {String(v).padStart(2, "0")}
      </span>
      <span className="text-[9px] uppercase opacity-80">{l}</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 justify-center">
      {box(Math.floor(s / 86400), "j")}
      <span className="opacity-60">:</span>
      {box(Math.floor((s % 86400) / 3600), "h")}
      <span className="opacity-60">:</span>
      {box(Math.floor((s % 3600) / 60), "m")}
      <span className="opacity-60">:</span>
      {box(s % 60, "s")}
    </div>
  );
}

function OverlayView({
  o,
  selected,
  onRemove,
  onEdit,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
}) {
  const Controls = () =>
    selected ? (
      <>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-3 -left-3 w-6 h-6 rounded-full flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.65)" }}
        >
          <span
            className="material-symbols-outlined text-white"
            style={{ fontSize: 14 }}
          >
            close
          </span>
        </button>
        {onEdit && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="absolute -top-3 -right-3 w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.65)" }}
          >
            <span
              className="material-symbols-outlined text-white"
              style={{ fontSize: 14 }}
            >
              edit
            </span>
          </button>
        )}
        <div
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          className="absolute -bottom-3 -right-3 w-6 h-6 rounded-full flex items-center justify-center"
          style={{
            background: "#22d3ee",
            touchAction: "none",
            cursor: "nwse-resize",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 14, color: "#00363e" }}
          >
            sync
          </span>
        </div>
      </>
    ) : null;
  const ring = selected ? "0 0 0 2px rgba(34,211,238,0.9)" : "none";
  const chip = (icon, text, bg = "#fff", fg = "#111") => (
    <div
      className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold text-sm"
      style={{ background: bg, color: fg, maxWidth: 260, boxShadow: ring }}
    >
      {icon && (
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          {icon}
        </span>
      )}
      <span className="truncate">{text}</span>
      <Controls />
    </div>
  );

  if (o.type === "link") return chip("link", o.label || o.url, "#fff", "#111");
  if (o.type === "location")
    return chip(
      "location_on",
      o.place,
      "linear-gradient(135deg,#f97316,#ec4899)",
      "#fff",
    );
  if (o.type === "mention")
    return chip(
      "alternate_email",
      (o.username || "").replace(/^@/, ""),
      "linear-gradient(135deg,#22d3ee,#3b82f6)",
      "#00252b",
    );
  if (o.type === "hashtag")
    return (
      <div
        className="relative font-black"
        style={{
          color: "#fff",
          fontSize: 34,
          textShadow: "0 2px 8px rgba(0,0,0,0.5)",
          boxShadow: ring,
          borderRadius: 8,
          padding: "0 6px",
        }}
      >
        #{(o.tag || "").replace(/^#/, "")}
        <Controls />
      </div>
    );
  if (o.type === "gif")
    return (
      <div
        className="relative"
        style={{ boxShadow: ring, borderRadius: 12, overflow: "hidden" }}
      >
        <img
          src={o.url}
          alt="gif"
          draggable={false}
          style={{ width: 150, display: "block", pointerEvents: "none" }}
        />
        <Controls />
      </div>
    );
  if (o.type === "time")
    return (
      <div
        className="relative px-4 py-2 rounded-2xl font-black"
        style={{
          background: "rgba(0,0,0,0.35)",
          color: "#fff",
          fontSize: 26,
          letterSpacing: 1,
          backdropFilter: "blur(4px)",
          boxShadow: ring,
        }}
      >
        <LiveClock />
        <Controls />
      </div>
    );
  if (o.type === "weather")
    return (
      <div
        className="relative flex items-center gap-2 px-4 py-2 rounded-2xl font-bold"
        style={{
          background: "rgba(0,0,0,0.35)",
          color: "#fff",
          fontSize: 20,
          backdropFilter: "blur(4px)",
          boxShadow: ring,
        }}
      >
        <span style={{ fontSize: 24 }}>{o.icon || "☀️"}</span>
        <span>{o.temp != null ? `${o.temp}°` : "—"}</span>
        <span className="opacity-80">
          <LiveClock />
        </span>
        <Controls />
      </div>
    );
  if (o.type === "slider")
    return (
      <div
        className="relative px-4 py-4 rounded-3xl"
        style={{
          background: "#fff",
          color: "#111",
          width: 250,
          boxShadow: ring,
        }}
      >
        <p className="font-bold text-sm mb-3 text-center leading-snug">
          {o.q || i18n.t("story.slider_default")}
        </p>
        <div
          className="relative h-2 rounded-full"
          style={{ background: "linear-gradient(90deg,#e5e7eb,#c7d2fe)" }}
        >
          <div
            className="absolute top-1/2 -translate-y-1/2"
            style={{
              left: "62%",
              fontSize: 30,
              transform: "translate(-50%,-50%)",
            }}
          >
            {o.emoji || "😍"}
          </div>
        </div>
        <Controls />
      </div>
    );
  if (o.type === "countdown")
    return (
      <div
        className="relative px-5 py-3 rounded-3xl text-center"
        style={{
          background: "linear-gradient(135deg,#7c3aed,#ec4899)",
          color: "#fff",
          minWidth: 200,
          boxShadow: ring,
        }}
      >
        <CountdownView target={o.target} />
        <p className="text-xs font-bold mt-1 opacity-90 truncate">
          {o.title || i18n.t("story.countdown_default")}
        </p>
        <Controls />
      </div>
    );

  if (o.type === "text") {
    return (
      <div className="relative" style={{ boxShadow: ring, borderRadius: 8 }}>
        <span
          style={{
            color: o.color || "#fff",
            fontWeight: 800,
            fontSize: 30,
            lineHeight: 1.15,
            textShadow: "0 2px 6px rgba(0,0,0,0.5)",
            whiteSpace: "pre-wrap",
            display: "inline-block",
            textAlign: "center",
            maxWidth: 260,
            padding: "2px 6px",
          }}
        >
          {o.text}
        </span>
        <Controls />
      </div>
    );
  }
  if (o.type === "emoji") {
    return (
      <div className="relative" style={{ boxShadow: ring, borderRadius: 12 }}>
        <span style={{ fontSize: 52 }}>{o.emoji}</span>
        <Controls />
      </div>
    );
  }
  if (o.type === "music") {
    return (
      <div
        className="relative flex items-center gap-2 px-3 py-2 rounded-full"
        style={{
          background: "#fff",
          color: "#111",
          maxWidth: 260,
          boxShadow: ring,
        }}
      >
        {o.artwork ? (
          <img
            src={o.artwork}
            alt=""
            className="w-6 h-6 rounded object-cover"
          />
        ) : (
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            music_note
          </span>
        )}
        <span className="font-semibold text-sm truncate">{o.title}</span>
        <Controls />
      </div>
    );
  }
  if (o.type === "question") {
    return (
      <div
        className="relative px-4 py-3 rounded-2xl text-center"
        style={{
          background: "#fff",
          color: "#111",
          width: 230,
          boxShadow: ring,
        }}
      >
        <p className="font-bold text-sm mb-2 leading-snug">{o.q}</p>
        <div
          className="text-xs rounded-lg py-1.5"
          style={{ background: "#eef1f6", color: "#8894a8" }}
        >
          {i18n.t("story.reply")}
        </div>
        <Controls />
      </div>
    );
  }
  if (o.type === "poll") {
    return (
      <div
        className="relative px-3 py-3 rounded-2xl text-center"
        style={{
          background: "rgba(255,255,255,0.96)",
          color: "#111",
          width: 240,
          boxShadow: ring,
        }}
      >
        <p className="font-bold text-sm mb-2 leading-snug">{o.q}</p>
        <div className="flex gap-2">
          <div
            className="flex-1 py-2 rounded-lg font-bold text-sm"
            style={{ background: "#22d3ee", color: "#00363e" }}
          >
            {o.a}
          </div>
          <div
            className="flex-1 py-2 rounded-lg font-bold text-sm"
            style={{ background: "#3b82f6", color: "#00363e" }}
          >
            {o.b}
          </div>
        </div>
        <Controls />
      </div>
    );
  }
  return null;
}

// ── Éditeur de texte (élément déplaçable) ────────────────────────────────────
function TextEditor({ value, onCancel, onSave }) {
  const [t, setT] = useState(value.text || "");
  const [color, setColor] = useState(value.color || "#ffffff");
  const COLORS = [
    "#ffffff",
    "#000000",
    "#ef4444",
    "#22d3ee",
    "#3b82f6",
    "#22c55e",
    "#eab308",
    "#ec4899",
    "#a855f7",
  ];
  return (
    <div
      className="fixed inset-0 z-[95] flex flex-col"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onCancel}
    >
      <div
        className="flex justify-end px-4 pt-4"
        style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
      >
        <button
          onClick={() => onSave(t, color)}
          className="font-black px-4 py-2 rounded-full"
          style={{ background: C.accent, color: C.onPrimary }}
        >
          OK
        </button>
      </div>
      <div
        className="flex-1 flex items-center justify-center px-6"
        onClick={(e) => e.stopPropagation()}
      >
        <textarea
          autoFocus
          value={t}
          onChange={(e) => setT(e.target.value.slice(0, 200))}
          placeholder={i18n.t("story.ph_your_text")}
          rows={3}
          className="w-full bg-transparent border-none outline-none text-center resize-none"
          style={{
            color,
            fontWeight: 800,
            fontSize: 30,
            textShadow: "0 2px 6px rgba(0,0,0,0.5)",
            WebkitUserSelect: "text",
            userSelect: "text",
          }}
        />
      </div>
      <div
        className="flex justify-center gap-2 pb-8 px-4 flex-wrap"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
      >
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className="w-8 h-8 rounded-full"
            style={{
              background: c,
              border:
                color === c
                  ? "3px solid #fff"
                  : "2px solid rgba(255,255,255,0.5)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Formulaire de sticker (saisie) ───────────────────────────────────────────
const SLIDER_EMOJIS = [
  "😍",
  "🔥",
  "😂",
  "😮",
  "😢",
  "👏",
  "💯",
  "❤️",
  "⭐",
  "🚀",
];
function StickerForm({ type, onCancel, onAdd }) {
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [emoji, setEmoji] = useState("😍");
  const [when, setWhen] = useState("");
  const title =
    {
      poll: i18n.t("story.st_poll"),
      question: i18n.t("story.st_question"),
      link: i18n.t("story.st_link"),
      location: i18n.t("story.st_location"),
      mention: i18n.t("story.st_mention"),
      hashtag: i18n.t("story.st_hashtag"),
      slider: i18n.t("story.st_slider"),
      countdown: i18n.t("story.st_countdown"),
    }[type] || i18n.t("story.form_sticker");
  const submit = () => {
    if (type === "poll")
      onAdd({
        type: "poll",
        q: q.trim() || i18n.t("story.def_poll_q"),
        a: a.trim() || i18n.t("story.def_yes"),
        b: b.trim() || i18n.t("story.def_no"),
      });
    else if (type === "question")
      onAdd({ type: "question", q: q.trim() || i18n.t("story.def_question") });
    else if (type === "link") {
      let u = q.trim();
      if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
      onAdd({
        type: "link",
        url: u || "https://",
        label: a.trim() || u.replace(/^https?:\/\//, ""),
      });
    } else if (type === "location")
      onAdd({
        type: "location",
        place: q.trim() || i18n.t("story.def_location"),
      });
    else if (type === "mention")
      onAdd({
        type: "mention",
        username: q.trim().replace(/^@/, "") || i18n.t("story.def_user"),
      });
    else if (type === "hashtag")
      onAdd({
        type: "hashtag",
        tag: q.trim().replace(/^#/, "") || i18n.t("story.def_hashtag"),
      });
    else if (type === "slider")
      onAdd({
        type: "slider",
        q: q.trim() || i18n.t("story.def_slide"),
        emoji,
      });
    else if (type === "countdown")
      onAdd({
        type: "countdown",
        title: q.trim() || i18n.t("story.def_event"),
        target: when || new Date(Date.now() + 86400000).toISOString(),
      });
  };
  const input =
    "w-full text-sm px-4 py-3 rounded-xl border-none outline-none mb-3 placeholder:text-slate-500";
  const ph =
    {
      link: i18n.t("story.ph_link"),
      location: i18n.t("story.ph_location"),
      mention: i18n.t("story.ph_mention"),
      hashtag: i18n.t("story.ph_hashtag"),
      slider: i18n.t("story.ph_your_question"),
      countdown: i18n.t("story.ph_event_name"),
      poll: i18n.t("story.ph_your_question"),
      question: i18n.t("story.ph_ask_question"),
    }[type] || "…";
  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-5"
        style={{ background: C.surface }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-black text-lg mb-4" style={{ color: C.onSurface }}>
          {title}
        </h3>

        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value.slice(0, 140))}
          placeholder={ph}
          className={input}
          style={{ background: C.high, color: C.onSurface }}
        />

        {type === "poll" && (
          <div className="flex gap-2">
            <input
              value={a}
              onChange={(e) => setA(e.target.value.slice(0, 24))}
              placeholder={i18n.t("story.ph_option1")}
              className={input}
              style={{ background: C.high, color: C.onSurface }}
            />
            <input
              value={b}
              onChange={(e) => setB(e.target.value.slice(0, 24))}
              placeholder={i18n.t("story.ph_option2")}
              className={input}
              style={{ background: C.high, color: C.onSurface }}
            />
          </div>
        )}
        {type === "link" && (
          <input
            value={a}
            onChange={(e) => setA(e.target.value.slice(0, 40))}
            placeholder={i18n.t("story.ph_displayed_text")}
            className={input}
            style={{ background: C.high, color: C.onSurface }}
          />
        )}
        {type === "slider" && (
          <div className="flex flex-wrap gap-2 mb-3">
            {SLIDER_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className="text-2xl w-11 h-11 rounded-xl flex items-center justify-center transition-transform active:scale-90"
                style={{ background: emoji === e ? C.accent : C.high }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        {type === "countdown" && (
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className={input}
            style={{
              background: C.high,
              color: C.onSurface,
              colorScheme: "dark",
            }}
          />
        )}

        <div className="flex gap-2 mt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-2xl font-bold"
            style={{ background: C.high, color: C.onSurface }}
          >
            {i18n.t("story.cancel")}
          </button>
          <button
            onClick={submit}
            className="flex-1 py-3 rounded-2xl font-black"
            style={{
              background: `linear-gradient(135deg,${C.accent},#3b82f6)`,
              color: C.onPrimary,
            }}
          >
            {i18n.t("story.add")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sélecteur de GIF (GIPHY — clé publique ou REACT_APP_GIPHY_KEY) ────────────
const GIPHY_KEY = process.env.REACT_APP_GIPHY_KEY || "dc6zaTOxFJmzC"; // clé de démo publique GIPHY
function GifPicker({ onClose, onPick }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancel = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const base = q.trim()
          ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&limit=24&rating=pg-13&q=${encodeURIComponent(q.trim())}`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=24&rating=pg-13`;
        const r = await fetch(base);
        const j = await r.json();
        if (!cancel)
          setItems(
            (j.data || []).map((g) => ({
              id: g.id,
              url: g.images?.fixed_width?.url,
              prev:
                g.images?.fixed_width_small?.url || g.images?.fixed_width?.url,
            })),
          );
      } catch {
        if (!cancel) setItems([]);
      }
      if (!cancel) setLoading(false);
    }, 350);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div
      className="fixed inset-0 z-[96] flex flex-col"
      style={{ background: "rgba(0,0,0,0.92)" }}
    >
      <div
        className="flex items-center gap-2 px-3 pt-4 pb-2"
        style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
      >
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center"
        >
          <span className="material-symbols-outlined text-white">
            arrow_back
          </span>
        </button>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={i18n.t("story.ph_search_gif")}
          className="flex-1 text-sm px-4 py-2.5 rounded-xl border-none outline-none"
          style={{ background: C.high, color: C.onSurface }}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-6">
        {loading && (
          <div className="flex justify-center pt-8">
            <div
              className="animate-spin rounded-full h-7 w-7 border-b-2"
              style={{ borderColor: C.accent }}
            />
          </div>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          {items.map((g) => (
            <button
              key={g.id}
              onClick={() => onPick(g.url)}
              className="rounded-lg overflow-hidden"
              style={{ background: C.high }}
            >
              <img
                src={g.prev}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
                style={{ aspectRatio: "1/1" }}
              />
            </button>
          ))}
        </div>
        {!loading && items.length === 0 && (
          <p className="text-center text-sm mt-8" style={{ color: C.outline }}>
            {i18n.t("story.no_gif")}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Recherche + configuration de la musique (extraits gratuits iTunes) ────────
function MusicSearch({ onClose, onAdd, current, onRemove }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(null); // piste choisie (étape config)
  const [start, setStart] = useState(0);
  const [style, setStyle] = useState("title"); // title | cover | none
  // Aperçu via Web Audio (aucun indicateur son dans la barre d'état iOS).
  const audioRef = useRef(null);
  if (!audioRef.current) audioRef.current = new PreviewAudio();

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await axios.get(
          `${API}/stories/music/search?q=${encodeURIComponent(q.trim())}`,
        );
        setResults(r.data || []);
      } catch {
        setResults([]);
      }
      setLoading(false);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(
    () => () => {
      try {
        audioRef.current?.destroy();
      } catch {
        /* noop */
      }
    },
    [],
  );
  // Lance l'aperçu audio dès qu'une piste est choisie (étape config).
  useEffect(() => {
    if (!sel) return;
    try {
      audioRef.current?.play(sel.preview_url, 0);
    } catch {
      /* noop */
    }
  }, [sel]);

  const choose = (t) => {
    setSel(t);
    setStart(0);
    setStyle("title");
  };
  const onSlide = (v) => {
    setStart(v);
    try {
      audioRef.current?.seek(v);
    } catch {
      /* noop */
    }
  };

  // Étape 2 : configuration de la piste choisie.
  if (sel) {
    return (
      <div
        className="fixed inset-0 z-[95] flex flex-col"
        style={{ background: "rgba(0,0,0,0.92)" }}
      >
        {/* Aperçu audio géré par Web Audio (PreviewAudio) — pas d'élément <audio>. */}
        <div
          className="flex items-center justify-between px-4 pt-4"
          style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
        >
          <button
            onClick={() => {
              setSel(null);
              try {
                audioRef.current?.pause();
              } catch {
                /* noop */
              }
            }}
            className="text-white text-sm font-bold"
          >
            {i18n.t("story.back")}
          </button>
          <button
            onClick={() => {
              try {
                audioRef.current?.pause();
              } catch {
                /* noop */
              }
              onAdd(sel, start, style);
            }}
            className="font-black px-4 py-2 rounded-full"
            style={{ background: C.accent, color: C.onPrimary }}
          >
            {i18n.t("story.add")}
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 gap-4">
          {sel.artwork && (
            <img
              src={sel.artwork}
              alt=""
              className="w-40 h-40 rounded-2xl object-cover shadow-2xl"
            />
          )}
          <div className="text-center">
            <p className="text-white font-bold text-lg">{sel.title}</p>
            <p className="text-sm" style={{ color: C.outline }}>
              {sel.artist}
            </p>
          </div>
          <div className="w-full max-w-sm mt-2">
            <p className="text-white/70 text-xs mb-1">
              {i18n.t("story.passage", { sec: Math.round(start) })}
            </p>
            <input
              type="range"
              min={0}
              max={25}
              step={1}
              value={start}
              onChange={(e) => onSlide(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: C.accent }}
            />
          </div>
          <div className="flex gap-2 mt-2">
            {[
              ["title", i18n.t("story.style_title")],
              ["cover", i18n.t("story.style_cover")],
              ["none", i18n.t("story.style_sound_only")],
            ].map(([k, lbl]) => (
              <button
                key={k}
                onClick={() => setStyle(k)}
                className="px-4 py-2 rounded-full text-sm font-bold"
                style={{
                  background: style === k ? C.accent : "rgba(255,255,255,0.12)",
                  color: style === k ? C.onPrimary : "#fff",
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Étape 1 : recherche.
  return (
    <div
      className="fixed inset-0 z-[95] flex flex-col"
      style={{ background: "rgba(0,0,0,0.9)" }}
    >
      <div
        className="flex items-center gap-2 px-3 pt-4 pb-2"
        style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
      >
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center"
        >
          <span className="material-symbols-outlined text-white">
            arrow_back
          </span>
        </button>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={i18n.t("story.ph_search_music")}
          className="flex-1 text-sm px-4 py-2.5 rounded-xl border-none outline-none"
          style={{ background: C.high, color: C.onSurface }}
        />
      </div>
      {current && (
        <div
          className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: C.container }}
        >
          <span
            className="material-symbols-outlined"
            style={{ color: C.accent }}
          >
            music_note
          </span>
          <span className="flex-1 text-sm text-white truncate">
            {current.title} · {current.artist}
          </span>
          <button onClick={onRemove} className="text-xs text-red-400 font-bold">
            {i18n.t("story.remove")}
          </button>
        </div>
      )}
      <div
        className="flex-1 overflow-y-auto px-3"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {loading && (
          <div className="flex justify-center pt-8">
            <div
              className="animate-spin rounded-full h-7 w-7 border-b-2"
              style={{ borderColor: C.accent }}
            />
          </div>
        )}
        {results.map((t) => (
          <button
            key={t.id}
            onClick={() => choose(t)}
            className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/5 text-left"
          >
            {t.artwork ? (
              <img
                src={t.artwork}
                alt=""
                className="w-11 h-11 rounded-lg object-cover"
              />
            ) : (
              <div
                className="w-11 h-11 rounded-lg flex items-center justify-center"
                style={{ background: C.high }}
              >
                <span className="material-symbols-outlined text-white">
                  music_note
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {t.title}
              </p>
              <p className="text-xs truncate" style={{ color: C.outline }}>
                {t.artist}
              </p>
            </div>
            <span
              className="material-symbols-outlined"
              style={{ color: C.accent }}
            >
              play_circle
            </span>
          </button>
        ))}
        {!loading && q.trim() && results.length === 0 && (
          <p className="text-center text-sm pt-8" style={{ color: C.outline }}>
            {i18n.t("story.no_results")}
          </p>
        )}
        {!q.trim() && (
          <p className="text-center text-sm pt-8" style={{ color: C.outline }}>
            {i18n.t("story.music_hint")}
          </p>
        )}
      </div>
    </div>
  );
}
