import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { toast } from "sonner";

// STUN public gratuit (Google). Pas de TURN => peut échouer derrière NAT symétrique.
const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const C = { cyan: "#22d3ee", onPrimary: "#00363e", surface: "#0b1326", outline: "#859397", onSurface: "#dae2fd" };

export default function LiveStream({ user, setUser }) {
  const { roomId: paramRoom } = useParams();
  const isHost = !paramRoom;
  const [roomId] = useState(paramRoom || `live_${user.id}_${Date.now()}`);
  const [status, setStatus] = useState("idle"); // idle | connecting | live | ended

  const localRef  = useRef(null);
  const remoteRef = useRef(null);
  const pcRef     = useRef(null);
  const wsRef     = useRef(null);
  const streamRef = useRef(null);
  const offeredRef = useRef(false);

  const cleanup = useCallback(() => {
    try { wsRef.current?.close(); } catch { /* déjà fermé */ }
    try { pcRef.current?.close(); } catch { /* déjà fermé */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current = null;
    wsRef.current = null;
    streamRef.current = null;
    offeredRef.current = false;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const send = (obj) => {
    try { wsRef.current?.send(JSON.stringify(obj)); } catch { /* socket non prêt */ }
  };

  const start = async () => {
    setStatus("connecting");
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    pc.onicecandidate = (e) => { if (e.candidate) send({ type: "ice", candidate: e.candidate }); };
    pc.ontrack = (e) => {
      if (remoteRef.current) remoteRef.current.srcObject = e.streams[0];
      setStatus("live");
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) setStatus("ended");
    };

    // L'hôte publie sa caméra/micro ; le spectateur reçoit uniquement.
    if (isHost) {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        toast.error("Caméra/micro indisponible");
        setStatus("idle");
        return;
      }
      streamRef.current = stream;
      if (localRef.current) localRef.current.srcObject = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    }

    const token = localStorage.getItem("token");
    const wsBase = API.replace(/^http/, "ws").replace(/\/api\/?$/, "");
    const ws = new WebSocket(`${wsBase}/ws/live/${roomId}?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => send(isHost ? { type: "hello-host" } : { type: "ready" });

    ws.onmessage = async (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      try {
        if (msg.type === "hello-host" && !isHost) {
          // L'hôte est arrivé après nous : on se re-signale
          send({ type: "ready" });
        } else if (msg.type === "ready" && isHost && !offeredRef.current) {
          offeredRef.current = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send({ type: "offer", sdp: pc.localDescription });
        } else if (msg.type === "offer" && !isHost) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: "answer", sdp: pc.localDescription });
        } else if (msg.type === "answer" && isHost) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        } else if (msg.type === "ice") {
          try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch { /* candidat tardif */ }
        }
      } catch (err) {
        console.error("Live signaling:", err);
      }
    };

    ws.onerror = () => toast.error("Connexion live échouée");
  };

  const stop = () => { cleanup(); setStatus("ended"); };

  const shareLink = `${window.location.origin}/live/${roomId}`;
  const copyLink = () => {
    navigator.clipboard?.writeText(shareLink).then(
      () => toast.success("Lien copié"),
      () => toast.error("Copie impossible")
    );
  };

  return (
    <Layout user={user} setUser={setUser} compact>
      <div className="max-w-3xl mx-auto px-4 py-6" style={{ color: C.onSurface }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined" style={{ color: "#f87171" }}>sensors</span>
          <h1 className="text-2xl font-black" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
            {isHost ? "Direct" : "Rejoindre le direct"}
          </h1>
          {status === "live" && (
            <span className="ml-2 text-[10px] font-black px-2 py-0.5 rounded-full uppercase" style={{ background: "#f87171", color: "#fff" }}>
              ● LIVE
            </span>
          )}
        </div>
        <p className="text-sm mb-4" style={{ color: C.outline }}>
          {isHost
            ? "Direct 1:1 gratuit (WebRTC + STUN). Partagez le lien pour qu'une personne vous rejoigne."
            : "Vous allez rejoindre le direct de cet utilisateur."}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {isHost && (
            <div className="rounded-2xl overflow-hidden bg-black aspect-video flex items-center justify-center">
              <video ref={localRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>
          )}
          <div className={`rounded-2xl overflow-hidden bg-black aspect-video flex items-center justify-center ${isHost ? "" : "sm:col-span-2"}`}>
            <video ref={remoteRef} autoPlay playsInline className="w-full h-full object-cover" />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {status === "idle" && (
            <button
              onClick={start}
              data-testid="start-live"
              className="px-6 py-3 rounded-xl font-bold flex items-center gap-2 active:scale-95 transition-all"
              style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}
            >
              <span className="material-symbols-outlined">videocam</span>
              {isHost ? "Démarrer le direct" : "Rejoindre"}
            </button>
          )}
          {(status === "connecting" || status === "live") && (
            <button
              onClick={stop}
              className="px-6 py-3 rounded-xl font-bold flex items-center gap-2 active:scale-95 transition-all"
              style={{ background: "#f87171", color: "#3a0d0d" }}
            >
              <span className="material-symbols-outlined">stop_circle</span>
              Arrêter
            </button>
          )}
          {isHost && (
            <button
              onClick={copyLink}
              className="px-6 py-3 rounded-xl font-bold flex items-center gap-2 active:scale-95 transition-all"
              style={{ background: "#171f33", color: C.cyan, border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <span className="material-symbols-outlined">link</span>
              Copier le lien
            </button>
          )}
        </div>

        {status === "connecting" && (
          <p className="text-xs mt-4" style={{ color: C.outline }}>Connexion en cours…</p>
        )}
        {status === "ended" && (
          <p className="text-xs mt-4" style={{ color: C.outline }}>Direct terminé.</p>
        )}
        <p className="text-[11px] mt-6" style={{ color: C.outline }}>
          Astuce : le direct gratuit (sans serveur TURN) peut échouer sur certains réseaux mobiles/entreprise.
        </p>
      </div>
    </Layout>
  );
}
