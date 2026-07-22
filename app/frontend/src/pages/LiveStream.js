import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";

// STUN public gratuit (Google). Pas de TURN => peut échouer derrière NAT symétrique.
const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const C = { cyan: (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee", onPrimary: "#00363e", surface: "#0b1326", outline: "#859397", onSurface: "#dae2fd" };

// Filtres façon TikTok (appliqués via canvas → transmis aux spectateurs).
const FILTERS = [
  { name: "Normal", css: "none" },
  { name: "N&B",    css: "grayscale(1) contrast(1.05)" },
  { name: "Chaud",  css: "sepia(0.35) saturate(1.4)" },
  { name: "Froid",  css: "saturate(1.3) hue-rotate(-12deg) brightness(1.05)" },
  { name: "Vif",    css: "saturate(1.7) contrast(1.15)" },
  { name: "Rétro",  css: "sepia(0.6) contrast(0.95) brightness(1.1)" },
];

const GIFTS = [
  { emoji: "🌹", name: "Rose" }, { emoji: "❤️", name: "Cœur" }, { emoji: "🎉", name: "Confetti" },
  { emoji: "🔥", name: "Feu" }, { emoji: "💎", name: "Diamant" }, { emoji: "👑", name: "Couronne" },
  { emoji: "🦄", name: "Licorne" }, { emoji: "🚀", name: "Fusée" },
];

function drawCover(ctx, video, cw, ch) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(cw / vw, ch / vh);
  const w = vw * scale, h = vh * scale;
  ctx.drawImage(video, (cw - w) / 2, (ch - h) / 2, w, h);
}

export default function LiveStream({ user }) {
  const { roomId: paramRoom } = useParams();
  const navigate = useNavigate();
  const isHost = !paramRoom;
  const [roomId] = useState(paramRoom || `live_${user.id}_${Date.now()}`);
  const [status, setStatus] = useState("idle"); // idle | connecting | live | ended

  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [viewers, setViewers]   = useState(0);
  const [likes, setLikes]       = useState(0);
  const [hearts, setHearts]     = useState([]);   // cœurs flottants
  const [flyGifts, setFlyGifts] = useState([]);   // gifts flottants
  const [showGifts, setShowGifts] = useState(false);
  const [filterIdx, setFilterIdx] = useState(0);
  const [savingReplay, setSavingReplay] = useState(false);

  const localRef  = useRef(null);
  const remoteRef = useRef(null);
  const pcRef     = useRef(null);
  const wsRef     = useRef(null);
  const streamRef = useRef(null);     // flux caméra brut
  const outStreamRef = useRef(null);  // flux filtré (transmis + enregistré)
  const offeredRef = useRef(false);
  const startedRef = useRef(false);
  const filterRef  = useRef(0);
  const rafRef     = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef  = useRef([]);
  const chatEndRef = useRef(null);

  useEffect(() => { filterRef.current = filterIdx; }, [filterIdx]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    try { wsRef.current?.close(); } catch { /* déjà fermé */ }
    try { pcRef.current?.close(); } catch { /* déjà fermé */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    outStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (startedRef.current) { startedRef.current = false; axios.post(`${API}/live/stop`).catch(() => {}); }
    pcRef.current = null; wsRef.current = null; streamRef.current = null; outStreamRef.current = null; offeredRef.current = false;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const send = (obj) => { try { wsRef.current?.send(JSON.stringify(obj)); } catch { /* socket non prêt */ } };

  // ── Overlays temps réel : cœurs / gifts flottants ──
  const spawnHeart = () => {
    const id = Math.random().toString(36).slice(2);
    setHearts((h) => [...h, { id, x: 10 + Math.random() * 60 }]);
    setTimeout(() => setHearts((h) => h.filter((x) => x.id !== id)), 2200);
  };
  const spawnGift = (g, from) => {
    const id = Math.random().toString(36).slice(2);
    setFlyGifts((arr) => [...arr, { id, emoji: g.emoji, name: g.name, from }]);
    setTimeout(() => setFlyGifts((arr) => arr.filter((x) => x.id !== id)), 3200);
  };

  const sendLike = () => { setLikes((n) => n + 1); spawnHeart(); send({ type: "like", from: user.username }); };
  const sendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    const m = { id: Math.random().toString(36).slice(2), from: user.username, pic: user.profile_pic, text };
    setMessages((prev) => [...prev.slice(-40), m]);
    send({ type: "chat", ...m });
    setChatInput("");
  };
  const sendGift = (g) => {
    spawnGift(g, "Vous");
    send({ type: "gift", from: user.username, emoji: g.emoji, name: g.name });
    setShowGifts(false);
    toast.success(`${g.emoji} ${g.name} envoyé`);
  };

  // ── Enregistrement du replay (hôte) → publié en clip à l'arrêt ──
  const startRecording = (stream) => {
    try {
      chunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: "video/webm" });
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.start(1000);
      recorderRef.current = mr;
    } catch { /* MediaRecorder indisponible */ }
  };
  const finishRecordingAndSave = async () => {
    const mr = recorderRef.current;
    if (!mr) return;
    const blob = await new Promise((resolve) => {
      mr.onstop = () => resolve(new Blob(chunksRef.current, { type: "video/webm" }));
      try { mr.stop(); } catch { resolve(null); }
    });
    recorderRef.current = null;
    if (!blob || blob.size < 50000) return;
    if (!window.confirm("Enregistrer le replay de votre direct dans Nexus Clips ?")) return;
    setSavingReplay(true);
    try {
      const form = new FormData();
      form.append("file", new File([blob], `replay_${Date.now()}.webm`, { type: "video/webm" }));
      form.append("caption", "Replay du direct 🔴");
      await axios.post(`${API}/clips`, form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Replay publié dans Nexus Clips");
    } catch { toast.error("Impossible d'enregistrer le replay"); }
    finally { setSavingReplay(false); }
  };

  const start = async () => {
    setStatus("connecting");
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;
    pc.onicecandidate = (e) => { if (e.candidate) send({ type: "ice", candidate: e.candidate }); };
    pc.ontrack = (e) => { if (remoteRef.current) remoteRef.current.srcObject = e.streams[0]; setStatus("live"); };
    pc.onconnectionstatechange = () => { if (["failed", "disconnected", "closed"].includes(pc.connectionState)) setStatus((s) => (s === "live" ? s : "ended")); };

    if (isHost) {
      let cam;
      try { cam = await navigator.mediaDevices.getUserMedia({ video: { width: 720, height: 1280, facingMode: "user" }, audio: true }); }
      catch { toast.error("Caméra/micro indisponible"); setStatus("idle"); return; }
      streamRef.current = cam;

      // Pipeline canvas → applique le filtre en direct et le transmet aux spectateurs.
      let outStream = cam;
      try {
        const camVideo = document.createElement("video");
        camVideo.srcObject = cam; camVideo.muted = true; camVideo.playsInline = true;
        await camVideo.play();
        const canvas = document.createElement("canvas");
        canvas.width = 720; canvas.height = 1280;
        const ctx = canvas.getContext("2d");
        const draw = () => {
          ctx.filter = FILTERS[filterRef.current]?.css || "none";
          drawCover(ctx, camVideo, canvas.width, canvas.height);
          rafRef.current = requestAnimationFrame(draw);
        };
        draw();
        const canvasStream = canvas.captureStream(30);
        const audio = cam.getAudioTracks()[0];
        outStream = new MediaStream([canvasStream.getVideoTracks()[0], ...(audio ? [audio] : [])]);
      } catch { outStream = cam; /* fallback sans filtre */ }

      outStreamRef.current = outStream;
      if (localRef.current) localRef.current.srcObject = outStream;
      outStream.getTracks().forEach((t) => pc.addTrack(t, outStream));
      startRecording(outStream);

      try { await axios.post(`${API}/live/start`, { room_id: roomId }); startedRef.current = true; toast.success("Vous êtes en direct — vos abonnés sont notifiés"); }
      catch { /* best-effort */ }
    }

    const token = localStorage.getItem("token");
    const wsBase = API.replace(/^http/, "ws").replace(/\/api\/?$/, "");
    const ws = new WebSocket(`${wsBase}/ws/live/${roomId}?token=${token}`);
    wsRef.current = ws;
    ws.onopen = () => { send(isHost ? { type: "hello-host" } : { type: "ready" }); if (!isHost) setStatus("live"); };

    ws.onmessage = async (event) => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      // ── Couche sociale (chat / likes / gifts / spectateurs) ──
      if (msg.type === "chat") { setMessages((p) => [...p.slice(-40), { id: msg.id || Math.random(), from: msg.from, pic: msg.pic, text: msg.text }]); return; }
      if (msg.type === "like") { setLikes((n) => n + 1); spawnHeart(); return; }
      if (msg.type === "gift") { spawnGift({ emoji: msg.emoji, name: msg.name }, msg.from); return; }
      if (msg.type === "viewers") { setViewers(msg.count || 0); return; }
      // ── Signaling WebRTC ──
      try {
        if (msg.type === "hello-host" && !isHost) { send({ type: "ready" }); }
        else if (msg.type === "ready" && isHost && !offeredRef.current) {
          offeredRef.current = true;
          const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
          send({ type: "offer", sdp: pc.localDescription });
        } else if (msg.type === "offer" && !isHost) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
          send({ type: "answer", sdp: pc.localDescription });
        } else if (msg.type === "answer" && isHost) { await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)); }
        else if (msg.type === "ice") { try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch { /* tardif */ } }
      } catch (err) { console.error("Live signaling:", err); }
    };
    ws.onerror = () => toast.error("Connexion live échouée");
  };

  const stop = async () => {
    if (isHost) await finishRecordingAndSave();
    cleanup();
    setStatus("ended");
  };

  const copyLink = () => {
    const link = `${window.location.origin}/live/${roomId}`;
    navigator.clipboard?.writeText(link).then(() => toast.success("Lien copié"), () => toast.error("Copie impossible"));
  };

  const live = status === "live" || status === "connecting";

  // ── Écran d'accueil (avant de démarrer / rejoindre) ──
  if (status === "idle" || status === "ended") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-6 select-none" style={{ background: C.surface, color: C.onSurface }}>
        <button onClick={() => navigate(-1)} className="absolute top-4 left-4" style={{ color: C.outline }}>
          <span className="material-symbols-outlined text-3xl">close</span>
        </button>
        <span className="material-symbols-outlined text-6xl" style={{ color: "#f87171" }}>sensors</span>
        <h1 className="text-2xl font-black" style={{ fontFamily: "Space Grotesk, sans-serif" }}>{isHost ? "Passer en direct" : "Rejoindre le direct"}</h1>
        <p className="text-sm text-center max-w-xs" style={{ color: C.outline }}>
          {status === "ended" ? "Direct terminé." : (isHost ? "Vertical plein écran · chat · likes · cadeaux · replay automatique." : "Vous allez rejoindre ce direct.")}
        </p>
        {savingReplay && <p className="text-xs" style={{ color: C.cyan }}>Enregistrement du replay…</p>}
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button onClick={start} data-testid="start-live"
            className="px-6 py-3 rounded-full font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
            style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
            <span className="material-symbols-outlined">videocam</span>
            {isHost ? (status === "ended" ? "Repartir en direct" : "Démarrer le direct") : "Rejoindre"}
          </button>
          {isHost && (
            <button onClick={copyLink} className="px-6 py-3 rounded-full font-bold flex items-center justify-center gap-2" style={{ background: "#171f33", color: C.cyan }}>
              <span className="material-symbols-outlined">link</span>Copier le lien
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Direct plein écran vertical (façon TikTok / Insta) ──
  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ background: "#000", WebkitUserSelect: "none", userSelect: "none" }}>
      {/* Vidéo plein écran : locale (hôte) ou distante (spectateur) */}
      <video ref={isHost ? localRef : remoteRef} autoPlay playsInline muted={isHost}
        className="absolute inset-0 w-full h-full object-cover" style={{ transform: isHost ? "scaleX(-1)" : "none" }} />
      {/* Vidéo cachée pour l'autre rôle (garde les refs valides) */}
      <video ref={isHost ? remoteRef : localRef} autoPlay playsInline muted className="hidden" />

      {/* Dégradés haut/bas pour lisibilité */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.5), transparent 18%, transparent 55%, rgba(0,0,0,0.75))" }} />

      {/* Barre haut : hôte + LIVE + spectateurs + fermer */}
      <div className="absolute top-0 left-0 right-0 flex items-center gap-2 px-3" style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}>
        <div className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1" style={{ background: "rgba(0,0,0,0.35)" }}>
          {user.profile_pic ? <img src={user.profile_pic} alt="" className="w-8 h-8 rounded-full object-cover" /> :
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>{user.username[0].toUpperCase()}</div>}
          <span className="text-white text-sm font-bold">@{user.username}</span>
        </div>
        <span className="text-[10px] font-black px-2 py-1 rounded-full" style={{ background: "#f87171", color: "#fff" }}>● LIVE</span>
        <div className="flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: "rgba(0,0,0,0.35)" }}>
          <span className="material-symbols-outlined text-white text-base">visibility</span>
          <span className="text-white text-xs font-bold">{viewers}</span>
        </div>
        <button onClick={stop} className="ml-auto w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)", color: "#fff" }}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* Filtres (hôte) : bande scrollable */}
      {isHost && (
        <div className="absolute right-3 top-24 flex flex-col gap-2 items-end">
          <div className="flex flex-col gap-1.5 rounded-2xl p-2" style={{ background: "rgba(0,0,0,0.3)" }}>
            {FILTERS.map((f, i) => (
              <button key={f.name} onClick={() => setFilterIdx(i)}
                className="text-[10px] font-bold px-2 py-1 rounded-lg"
                style={{ background: filterIdx === i ? C.cyan : "transparent", color: filterIdx === i ? C.onPrimary : "#fff" }}>
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cœurs flottants */}
      {hearts.map((h) => (
        <span key={h.id} className="material-symbols-outlined absolute pointer-events-none"
          style={{ bottom: 120, right: `${h.x}px`, color: "#f87171", fontSize: 30, fontVariationSettings: "'FILL' 1", animation: "floatUp 2.1s ease-out forwards" }}>favorite</span>
      ))}
      {/* Gifts flottants */}
      {flyGifts.map((g) => (
        <div key={g.id} className="absolute left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center" style={{ bottom: 160, animation: "giftPop 3.1s ease-out forwards" }}>
          <span style={{ fontSize: 56 }}>{g.emoji}</span>
          <span className="text-white text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,0.4)" }}>{g.from} · {g.name}</span>
        </div>
      ))}

      {/* Colonne actions droite : like + gift */}
      <div className="absolute right-3 bottom-40 flex flex-col gap-4 items-center">
        <button onClick={sendLike} className="flex flex-col items-center gap-1">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
            <span className="material-symbols-outlined text-3xl" style={{ color: "#f87171", fontVariationSettings: "'FILL' 1" }}>favorite</span>
          </div>
          <span className="text-white text-xs font-bold">{likes}</span>
        </button>
        <button onClick={() => setShowGifts((v) => !v)} className="flex flex-col items-center gap-1">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
            <span className="material-symbols-outlined text-3xl" style={{ color: "#fbbf24" }}>redeem</span>
          </div>
          <span className="text-white text-xs font-bold">Cadeau</span>
        </button>
      </div>

      {/* Chat + saisie (slide up) */}
      <div className="absolute left-0 right-16 bottom-0 px-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <div className="max-h-[38vh] overflow-y-auto space-y-1.5 mb-2 pr-1" style={{ maskImage: "linear-gradient(to top, black 80%, transparent)" }}>
          {messages.map((m) => (
            <div key={m.id} className="flex items-start gap-2">
              {m.pic ? <img src={m.pic} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" /> :
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>{(m.from || "?")[0].toUpperCase()}</div>}
              <p className="text-xs text-white leading-snug"><span className="font-bold">{m.from}</span> {m.text}</p>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="flex items-center gap-2 rounded-full px-4 h-11" style={{ background: "rgba(0,0,0,0.4)" }}>
          <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
            placeholder="Dis quelque chose…" className="flex-1 bg-transparent outline-none text-sm text-white select-text" />
          <button onClick={sendChat} style={{ color: C.cyan }}><span className="material-symbols-outlined">send</span></button>
        </div>
      </div>

      {/* Sélecteur de cadeaux */}
      {showGifts && (
        <div className="absolute left-0 right-0 bottom-0 rounded-t-3xl p-4" style={{ background: "rgba(11,19,38,0.97)", backdropFilter: "blur(20px)", paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-bold text-sm">Envoyer un cadeau</h3>
            <button onClick={() => setShowGifts(false)} style={{ color: C.outline }}><span className="material-symbols-outlined">close</span></button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {GIFTS.map((g) => (
              <button key={g.name} onClick={() => sendGift(g)} className="flex flex-col items-center gap-1 py-3 rounded-2xl active:scale-95 transition-transform" style={{ background: "#171f33" }}>
                <span style={{ fontSize: 32 }}>{g.emoji}</span>
                <span className="text-white text-[11px] font-semibold">{g.name}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-center mt-3" style={{ color: C.outline }}>Cadeaux visuels · monétisation réelle bientôt</p>
        </div>
      )}

      <style>{`
        @keyframes floatUp { 0% { transform: translateY(0) scale(0.8); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(-260px) scale(1.2) translateX(20px); opacity: 0; } }
        @keyframes giftPop { 0% { transform: translateY(20px) scale(0.5); opacity: 0; } 20% { transform: translateY(0) scale(1.1); opacity: 1; } 80% { opacity: 1; } 100% { transform: translateY(-40px) scale(1); opacity: 0; } }
      `}</style>
    </div>
  );
}
