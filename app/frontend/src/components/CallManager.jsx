import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import i18n from "@/i18n";

// Serveurs ICE : STUN public + TURN (identifiants injectés au build via des
// variables d'environnement — jamais en dur dans le dépôt).
//   REACT_APP_TURN_URL / REACT_APP_TURN_USERNAME / REACT_APP_TURN_CREDENTIAL
// Sans TURN configuré, on retombe sur STUN seul (peut échouer en NAT strict).
const ICE_SERVERS = (() => {
  const list = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrl = process.env.REACT_APP_TURN_URL;
  if (turnUrl) {
    list.push({
      urls: turnUrl,
      username: process.env.REACT_APP_TURN_USERNAME || "",
      credential: process.env.REACT_APP_TURN_CREDENTIAL || "",
    });
  }
  return list;
})();

// Contraintes micro : l'annulation d'écho évite la résonance (le son distant
// capté par le micro et renvoyé). noiseSuppression/autoGainControl améliorent
// la qualité.
const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

// Message clair selon la raison de l'échec d'accès au micro/caméra.
const mediaErrorMessage = (err) => {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return i18n.t("call.err_denied");
    case "NotFoundError":
    case "OverconstrainedError":
      return i18n.t("call.err_notfound");
    case "NotReadableError":
      return i18n.t("call.err_inuse");
    default:
      return i18n.t("call.err_generic");
  }
};

// getUserMedia avec repli : si la caméra échoue pour un appel vidéo, on retente
// en audio seul (mieux vaut un appel audio qu'aucun appel).
const getMedia = async (video) => {
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video }), video };
  } catch (err) {
    if (video && (err?.name === "NotFoundError" || err?.name === "NotReadableError" || err?.name === "OverconstrainedError")) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
      return { stream, video: false };
    }
    throw err;
  }
};

const fmtDuration = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Renvoie un flux dont la VIDÉO est inversée horizontalement (miroir), pour que
// le correspondant voie l'image comme l'utilisateur se voit dans sa vignette.
// Utilise un <canvas> (le CSS ne peut pas modifier le flux ENVOYÉ en WebRTC).
// Repli sûr : en cas de souci (API non dispo), renvoie le flux d'origine —
// donc jamais pire que le comportement standard actuel.
function makeMirroredStream(camStream) {
  try {
    const vTrack = camStream.getVideoTracks()[0];
    if (!vTrack) return { stream: camStream, cleanup: () => {} };
    const s = vTrack.getSettings ? vTrack.getSettings() : {};
    const w = s.width || 640, h = s.height || 480;
    const srcVideo = document.createElement("video");
    srcVideo.srcObject = new MediaStream([vTrack]);
    srcVideo.muted = true;
    srcVideo.playsInline = true;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.captureStream) return { stream: camStream, cleanup: () => {} };
    let raf = 0;
    const draw = () => {
      try {
        if (srcVideo.readyState >= 2) {
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(srcVideo, -w, 0, w, h);
          ctx.restore();
        }
      } catch { /* frame ignorée */ }
      raf = requestAnimationFrame(draw);
    };
    srcVideo.play().catch(() => {});
    draw();
    const out = canvas.captureStream(30);
    const mTrack = out.getVideoTracks()[0];
    if (!mTrack) { cancelAnimationFrame(raf); return { stream: camStream, cleanup: () => {} }; }
    const stream = new MediaStream([mTrack, ...camStream.getAudioTracks()]);
    const cleanup = () => {
      try { cancelAnimationFrame(raf); } catch { /* ignore */ }
      try { mTrack.stop(); } catch { /* ignore */ }
      try { srcVideo.srcObject = null; } catch { /* ignore */ }
    };
    return { stream, cleanup };
  } catch {
    return { stream: camStream, cleanup: () => {} };
  }
}

const C = {
  bg: "#020617", surface: "#0b1326", high: "#222a3d",
  cyan: (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee",
  onPrimary: "#00363e", onSurface: "#dae2fd", outline: "#859397",
};

function Avatar({ username, pic, size = 96 }) {
  return pic ? (
    <img src={pic} alt={username} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="rounded-full flex items-center justify-center font-black"
      style={{ width: size, height: size, fontSize: size / 2.6, background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
      {username?.[0]?.toUpperCase() || "?"}
    </div>
  );
}

// Gestionnaire global d'appels 1:1 (rendu dans Layout).
// - Appel sortant : déclenché par window CustomEvent "nexus:startcall"
//   detail { userId, username, profilePic, video }.
// - Appel entrant : reçu via l'événement "nexus:realtime" (type "call_signal").
export default function CallManager({ user }) {
  const [phase, setPhase] = useState("idle"); // idle | outgoing | incoming | connected
  const [peer, setPeer] = useState(null);      // { id, username, profile_pic }
  const [withVideo, setWithVideo] = useState(true);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0); // durée depuis la connexion

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const callIdRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null); // sortie audio quand il n'y a pas de vidéo
  const mirrorCleanupRef = useRef(null); // arrêt du canvas miroir (flux envoyé)

  const sendSignal = useCallback((toId, signal) => {
    if (!toId) return;
    axios.post(`${API}/calls/signal`, { to_user_id: toId, signal }).catch(() => {});
  }, []);

  const cleanup = useCallback(() => {
    try { pcRef.current?.close(); } catch { /* déjà fermé */ }
    pcRef.current = null;
    try { mirrorCleanupRef.current?.(); } catch { /* ignore */ }
    mirrorCleanupRef.current = null;
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); }
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    callIdRef.current = null;
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];
    setPhase("idle"); setPeer(null); setMuted(false); setCameraOff(false); setRemoteReady(false);
  }, []);

  const createPC = useCallback((toId) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal(toId, { kind: "candidate", call_id: callIdRef.current, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      remoteStreamRef.current = e.streams[0];
      setRemoteReady(true);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = e.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        toast.error(i18n.t("call.conn_lost"));
        cleanup();
      }
    };
    pcRef.current = pc;
    return pc;
  }, [sendSignal, cleanup]);

  // ── Appel sortant ─────────────────────────────────────────────────────────
  const startCall = useCallback(async ({ userId, username, profilePic, video }) => {
    if (!userId) return;
    if (phase !== "idle") { toast.error(i18n.t("call.already_in_call")); return; }
    try {
      const { stream, video: gotVideo } = await getMedia(!!video);
      localStreamRef.current = stream;
      callIdRef.current = `${user.id}-${Date.now()}`;
      setPeer({ id: userId, username, profile_pic: profilePic });
      setWithVideo(gotVideo);
      setPhase("outgoing");
      const pc = createPC(userId);
      // On ENVOIE une version miroir de la vidéo (le correspondant nous voit
      // comme dans notre vignette). L'aperçu local garde le flux caméra brut +
      // miroir CSS. Audio inchangé.
      let sendStream = stream;
      if (gotVideo) {
        const m = makeMirroredStream(stream);
        sendStream = m.stream;
        mirrorCleanupRef.current = m.cleanup;
      }
      sendStream.getTracks().forEach((t) => pc.addTrack(t, sendStream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(userId, { kind: "offer", call_id: callIdRef.current, sdp: pc.localDescription, video: gotVideo });
    } catch (err) {
      toast.error(mediaErrorMessage(err));
      cleanup();
    }
  }, [phase, user.id, createPC, sendSignal, cleanup]);

  // ── Accepter / refuser / raccrocher ───────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const offer = pendingOfferRef.current;
    if (!offer || !peer) return;
    try {
      const { stream, video: gotVideo } = await getMedia(withVideo);
      localStreamRef.current = stream;
      const pc = createPC(peer.id);
      // Idem appel sortant : on envoie la vidéo en miroir.
      let sendStream = stream;
      if (gotVideo) {
        const m = makeMirroredStream(stream);
        sendStream = m.stream;
        mirrorCleanupRef.current = m.cleanup;
      }
      sendStream.getTracks().forEach((t) => pc.addTrack(t, sendStream));
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      for (const c of pendingCandidatesRef.current) { try { await pc.addIceCandidate(c); } catch { /* ignore */ } }
      pendingCandidatesRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(peer.id, { kind: "answer", call_id: callIdRef.current, sdp: pc.localDescription });
      setPhase("connected");
    } catch (err) {
      toast.error(mediaErrorMessage(err));
      sendSignal(peer.id, { kind: "hangup", call_id: callIdRef.current });
      cleanup();
    }
  }, [peer, withVideo, createPC, sendSignal, cleanup]);

  const rejectCall = useCallback(() => {
    if (peer) sendSignal(peer.id, { kind: "reject", call_id: callIdRef.current });
    cleanup();
  }, [peer, sendSignal, cleanup]);

  const hangup = useCallback(() => {
    if (peer) sendSignal(peer.id, { kind: "hangup", call_id: callIdRef.current });
    cleanup();
  }, [peer, sendSignal, cleanup]);

  // ── Réception des signaux ─────────────────────────────────────────────────
  useEffect(() => {
    const onRealtime = async (e) => {
      const data = e.detail;
      if (!data || data.type !== "call_signal") return;
      const { from_id, from_username, from_profile_pic, signal } = data.data || {};
      if (!signal) return;
      const pc = pcRef.current;

      if (signal.kind === "offer") {
        if (phase !== "idle") { sendSignal(from_id, { kind: "reject", call_id: signal.call_id }); return; }
        callIdRef.current = signal.call_id;
        pendingOfferRef.current = signal.sdp;
        pendingCandidatesRef.current = [];
        setPeer({ id: from_id, username: from_username, profile_pic: from_profile_pic });
        setWithVideo(!!signal.video);
        setPhase("incoming");
      } else if (signal.kind === "answer") {
        if (pc && signal.call_id === callIdRef.current) {
          try { await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)); setPhase("connected"); } catch { /* ignore */ }
        }
      } else if (signal.kind === "candidate") {
        if (signal.call_id !== callIdRef.current) return;
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try { await pc.addIceCandidate(signal.candidate); } catch { /* ignore */ }
        } else {
          pendingCandidatesRef.current.push(signal.candidate);
        }
      } else if (signal.kind === "hangup" || signal.kind === "reject") {
        if (signal.call_id === callIdRef.current) {
          toast(signal.kind === "reject" ? i18n.t("call.call_rejected") : i18n.t("call.call_ended"));
          cleanup();
        }
      }
    };
    window.addEventListener("nexus:realtime", onRealtime);
    return () => window.removeEventListener("nexus:realtime", onRealtime);
  }, [phase, sendSignal, cleanup]);

  // Déclencheur d'appel sortant (émis par la page Messages).
  useEffect(() => {
    const onStart = (e) => startCall(e.detail || {});
    window.addEventListener("nexus:startcall", onStart);
    return () => window.removeEventListener("nexus:startcall", onStart);
  }, [startCall]);

  // Rattache les flux aux éléments média au (re)montage. L'élément <audio>
  // distant garantit qu'on ENTEND l'autre même en appel audio (sans vidéo).
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    if (remoteVideoRef.current && remoteStreamRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
    if (remoteAudioRef.current && remoteStreamRef.current) remoteAudioRef.current.srcObject = remoteStreamRef.current;
  }, [phase, remoteReady, cameraOff]);

  // Chronomètre d'appel : démarre à la connexion, se remet à zéro / s'arrête
  // automatiquement dès que l'appel se termine (phase ≠ "connected").
  useEffect(() => {
    if (phase !== "connected") { setCallSeconds(0); return; }
    const t = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const toggleMute = () => {
    const s = localStreamRef.current; if (!s) return;
    const next = !muted; setMuted(next);
    s.getAudioTracks().forEach((t) => { t.enabled = !next; });
  };
  const toggleCamera = () => {
    const s = localStreamRef.current; if (!s) return;
    const next = !cameraOff; setCameraOff(next);
    s.getVideoTracks().forEach((t) => { t.enabled = !next; });
  };

  if (phase === "idle") return null;

  const showVideo = withVideo && phase === "connected";

  return (
    <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center"
      style={{ background: "rgba(2,6,23,0.97)", backdropFilter: "blur(8px)" }}>

      {/* Vidéo distante plein écran (si appel vidéo connecté) */}
      {showVideo && (
        <video ref={remoteVideoRef} autoPlay playsInline
          className="absolute inset-0 w-full h-full object-cover" style={{ background: "#000" }} />
      )}

      {/* Sortie audio distante (appel audio, ou avant l'affichage vidéo) —
          indispensable pour entendre l'autre quand il n'y a pas de vidéo. */}
      {phase === "connected" && !showVideo && (
        <audio ref={remoteAudioRef} autoPlay />
      )}

      {/* Vignette locale (effet miroir forcé — className + inline + webkit — pour
          un rendu identique sur mobile ET desktop) */}
      {withVideo && (phase === "connected" || phase === "outgoing") && (
        <video ref={localVideoRef} autoPlay playsInline muted
          className="absolute rounded-2xl object-cover shadow-2xl -scale-x-100"
          style={{ width: 108, height: 148, right: 16, top: 16, background: "#000", border: `1px solid ${C.cyan}44`, transform: "scaleX(-1)", WebkitTransform: "scaleX(-1)" }} />
      )}

      {/* En-tête : avatar + nom + état (masqué en plein écran vidéo connecté) */}
      {!showVideo && (
        <div className="relative flex flex-col items-center gap-4 px-6 text-center">
          <Avatar username={peer?.username} pic={peer?.profile_pic} size={110} />
          <div>
            <p className="text-2xl font-black" style={{ color: C.onSurface, fontFamily: "Space Grotesk, sans-serif" }}>
              {peer?.username ? `@${peer.username}` : ""}
            </p>
            <p className="text-sm mt-1" style={{ color: C.cyan }}>
              {phase === "incoming"
                ? (withVideo ? i18n.t("call.incoming_video") : i18n.t("call.incoming"))
                : phase === "outgoing"
                  ? i18n.t("call.calling")
                  : fmtDuration(callSeconds)}
            </p>
          </div>
        </div>
      )}

      {/* Bandeau nom + durée en overlay quand vidéo plein écran */}
      {showVideo && (
        <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full flex items-center gap-2"
          style={{ background: "rgba(0,0,0,0.4)" }}>
          <Avatar username={peer?.username} pic={peer?.profile_pic} size={26} />
          <span className="text-sm font-bold text-white">@{peer?.username}</span>
          <span className="text-xs font-mono" style={{ color: C.cyan }}>{fmtDuration(callSeconds)}</span>
        </div>
      )}

      {/* Contrôles */}
      <div className="absolute bottom-10 flex items-center justify-center gap-5">
        {phase === "incoming" ? (
          <>
            <button onClick={rejectCall} title={i18n.t("call.reject")}
              className="w-16 h-16 rounded-full flex items-center justify-center active:scale-90 transition"
              style={{ background: "#ef4444", color: "#fff" }}>
              <span className="material-symbols-outlined text-2xl">call_end</span>
            </button>
            <button onClick={acceptCall} title={i18n.t("call.answer")}
              className="w-16 h-16 rounded-full flex items-center justify-center active:scale-90 transition"
              style={{ background: "#22c55e", color: "#fff" }}>
              <span className="material-symbols-outlined text-2xl">{withVideo ? "videocam" : "call"}</span>
            </button>
          </>
        ) : (
          <>
            <button onClick={toggleMute} title={muted ? i18n.t("call.mic_on") : i18n.t("call.mic_off")}
              className="w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition"
              style={{ background: muted ? C.cyan : C.high, color: muted ? C.onPrimary : C.onSurface }}>
              <span className="material-symbols-outlined">{muted ? "mic_off" : "mic"}</span>
            </button>
            {withVideo && (
              <button onClick={toggleCamera} title={cameraOff ? i18n.t("call.cam_on") : i18n.t("call.cam_off")}
                className="w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition"
                style={{ background: cameraOff ? C.cyan : C.high, color: cameraOff ? C.onPrimary : C.onSurface }}>
                <span className="material-symbols-outlined">{cameraOff ? "videocam_off" : "videocam"}</span>
              </button>
            )}
            <button onClick={hangup} title={i18n.t("call.hangup")}
              className="w-16 h-16 rounded-full flex items-center justify-center active:scale-90 transition"
              style={{ background: "#ef4444", color: "#fff" }}>
              <span className="material-symbols-outlined text-2xl">call_end</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
