import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";

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

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const callIdRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const sendSignal = useCallback((toId, signal) => {
    if (!toId) return;
    axios.post(`${API}/calls/signal`, { to_user_id: toId, signal }).catch(() => {});
  }, []);

  const cleanup = useCallback(() => {
    try { pcRef.current?.close(); } catch { /* déjà fermé */ }
    pcRef.current = null;
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
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        toast.error("Connexion perdue");
        cleanup();
      }
    };
    pcRef.current = pc;
    return pc;
  }, [sendSignal, cleanup]);

  // ── Appel sortant ─────────────────────────────────────────────────────────
  const startCall = useCallback(async ({ userId, username, profilePic, video }) => {
    if (!userId) return;
    if (phase !== "idle") { toast.error("Un appel est déjà en cours"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!video });
      localStreamRef.current = stream;
      callIdRef.current = `${user.id}-${Date.now()}`;
      setPeer({ id: userId, username, profile_pic: profilePic });
      setWithVideo(!!video);
      setPhase("outgoing");
      const pc = createPC(userId);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(userId, { kind: "offer", call_id: callIdRef.current, sdp: pc.localDescription, video: !!video });
    } catch {
      toast.error("Caméra/micro indisponible — autorisez l'accès");
      cleanup();
    }
  }, [phase, user.id, createPC, sendSignal, cleanup]);

  // ── Accepter / refuser / raccrocher ───────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const offer = pendingOfferRef.current;
    if (!offer || !peer) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
      localStreamRef.current = stream;
      const pc = createPC(peer.id);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      for (const c of pendingCandidatesRef.current) { try { await pc.addIceCandidate(c); } catch { /* ignore */ } }
      pendingCandidatesRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(peer.id, { kind: "answer", call_id: callIdRef.current, sdp: pc.localDescription });
      setPhase("connected");
    } catch {
      toast.error("Caméra/micro indisponible");
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
          toast(signal.kind === "reject" ? "Appel refusé" : "Appel terminé");
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

  // Rattache les flux aux éléments vidéo au (re)montage.
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    if (remoteVideoRef.current && remoteStreamRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
  }, [phase, remoteReady, cameraOff]);

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

      {/* Vignette locale */}
      {withVideo && (phase === "connected" || phase === "outgoing") && (
        <video ref={localVideoRef} autoPlay playsInline muted
          className="absolute rounded-2xl object-cover shadow-2xl"
          style={{ width: 108, height: 148, right: 16, top: 16, background: "#000", border: `1px solid ${C.cyan}44`, transform: "scaleX(-1)" }} />
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
                ? (withVideo ? "Appel vidéo entrant…" : "Appel entrant…")
                : phase === "outgoing"
                  ? "Appel en cours…"
                  : "Connecté"}
            </p>
          </div>
        </div>
      )}

      {/* Bandeau nom en overlay quand vidéo plein écran */}
      {showVideo && (
        <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full flex items-center gap-2"
          style={{ background: "rgba(0,0,0,0.4)" }}>
          <Avatar username={peer?.username} pic={peer?.profile_pic} size={26} />
          <span className="text-sm font-bold text-white">@{peer?.username}</span>
        </div>
      )}

      {/* Contrôles */}
      <div className="absolute bottom-10 flex items-center justify-center gap-5">
        {phase === "incoming" ? (
          <>
            <button onClick={rejectCall} title="Refuser"
              className="w-16 h-16 rounded-full flex items-center justify-center active:scale-90 transition"
              style={{ background: "#ef4444", color: "#fff" }}>
              <span className="material-symbols-outlined text-2xl">call_end</span>
            </button>
            <button onClick={acceptCall} title="Répondre"
              className="w-16 h-16 rounded-full flex items-center justify-center active:scale-90 transition"
              style={{ background: "#22c55e", color: "#fff" }}>
              <span className="material-symbols-outlined text-2xl">{withVideo ? "videocam" : "call"}</span>
            </button>
          </>
        ) : (
          <>
            <button onClick={toggleMute} title={muted ? "Activer le micro" : "Couper le micro"}
              className="w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition"
              style={{ background: muted ? C.cyan : C.high, color: muted ? C.onPrimary : C.onSurface }}>
              <span className="material-symbols-outlined">{muted ? "mic_off" : "mic"}</span>
            </button>
            {withVideo && (
              <button onClick={toggleCamera} title={cameraOff ? "Activer la caméra" : "Couper la caméra"}
                className="w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition"
                style={{ background: cameraOff ? C.cyan : C.high, color: cameraOff ? C.onPrimary : C.onSurface }}>
                <span className="material-symbols-outlined">{cameraOff ? "videocam_off" : "videocam"}</span>
              </button>
            )}
            <button onClick={hangup} title="Raccrocher"
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
