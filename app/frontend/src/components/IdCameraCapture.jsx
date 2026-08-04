// Capture EN DIRECT de la pièce d'identité via la caméra (getUserMedia).
// Aucun import de fichier possible → l'image ne peut pas être retouchée à
// l'avance. On prend la photo dans l'app puis on l'envoie telle quelle.
import { useEffect, useRef, useState } from "react";

const ACCENT = (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee";

export default function IdCameraCapture({ onCapture, facingMode = "environment", hint }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState(null); // URL de la photo capturée
  const isSelfie = facingMode === "user";

  const stop = () => {
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    streamRef.current = null;
  };

  const start = async () => {
    setErr("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } }, // arrière (pièce) ou avant (selfie)
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play().catch(() => {});
      }
    } catch (e) {
      setErr("Caméra indisponible. Autorise l'accès à la caméra pour continuer.");
    }
  };

  useEffect(() => {
    start();
    return () => { stop(); if (preview) URL.revokeObjectURL(preview); };
    // eslint-disable-next-line
  }, []);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `id_${Date.now()}.jpg`, { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      setPreview(url);
      onCapture && onCapture(file);
      stop();
    }, "image/jpeg", 0.92);
  };

  const retake = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    onCapture && onCapture(null);
    start();
  };

  if (err) {
    return (
      <div className="rounded-xl p-4 text-center" style={{ background: "#0b1326", border: "1px solid #2a3550" }}>
        <span className="material-symbols-outlined text-3xl mb-1" style={{ color: "#f87171" }}>no_photography</span>
        <p className="text-xs mb-3" style={{ color: "#f87171" }}>{err}</p>
        <button onClick={start} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: ACCENT, color: "#00363e" }}>Réessayer</button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative rounded-xl overflow-hidden" style={{ background: "#000", aspectRatio: "4 / 3" }}>
        {preview ? (
          <img src={preview} alt="Pièce capturée" className="w-full h-full object-contain" />
        ) : (
          <>
            <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover"
              style={isSelfie ? { transform: "scaleX(-1)" } : undefined} />
            {/* Cadre repère */}
            <div className={`absolute inset-4 pointer-events-none ${isSelfie ? "rounded-full" : "rounded-lg"}`}
              style={{ border: "2px dashed rgba(255,255,255,0.5)" }} />
            <div className="absolute bottom-1 inset-x-0 text-center text-[11px]" style={{ color: "rgba(255,255,255,0.8)" }}>
              {hint || (isSelfie ? "Centre ton visage dans le cercle" : "Place ta pièce dans le cadre, bien lisible")}
            </div>
          </>
        )}
      </div>

      {preview ? (
        <div className="flex gap-2 mt-3">
          <button onClick={retake} className="flex-1 py-2.5 rounded-xl text-sm font-bold" style={{ background: "#171f33", color: "#dae2fd" }}>
            Reprendre
          </button>
        </div>
      ) : (
        <button onClick={capture} className="w-full mt-3 py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2"
          style={{ background: ACCENT, color: "#00363e" }}>
          <span className="material-symbols-outlined text-lg">photo_camera</span> Prendre la photo
        </button>
      )}
    </div>
  );
}
