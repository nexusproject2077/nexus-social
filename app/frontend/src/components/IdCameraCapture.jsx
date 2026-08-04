// Capture EN DIRECT de la pièce / du selfie via la CAMÉRA NATIVE du téléphone
// (input capture). Plus fiable que getUserMedia+canvas (qui donnait des images
// noires sur iOS) et toujours en direct : l'attribut `capture` ouvre l'appareil
// photo, pas la galerie → impossible d'envoyer une image retouchée à l'avance.
import { useEffect, useRef, useState } from "react";

const ACCENT = (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee";

export default function IdCameraCapture({ onCapture, facingMode = "environment", hint }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const isSelfie = facingMode === "user";

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const openCamera = () => { if (inputRef.current) { inputRef.current.value = ""; inputRef.current.click(); } };

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    onCapture && onCapture(f);
  };

  const retake = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    onCapture && onCapture(null);
    openCamera();
  };

  return (
    <div>
      {/* La caméra native. `capture` = appareil photo direct (arrière ou avant). */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture={isSelfie ? "user" : "environment"}
        className="hidden"
        onChange={onFile}
      />

      <div className="relative rounded-xl overflow-hidden" style={{ background: "#0b1326", aspectRatio: "4 / 3", border: "1px solid #2a3550" }}>
        {preview ? (
          <img src={preview} alt="Capture" className="w-full h-full object-contain" />
        ) : (
          <>
            <div className={`absolute inset-4 pointer-events-none ${isSelfie ? "rounded-full" : "rounded-lg"}`}
              style={{ border: "2px dashed rgba(255,255,255,0.3)" }} />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5" style={{ color: "#5b6b8c" }}>
              <span className="material-symbols-outlined text-4xl">{isSelfie ? "face" : "id_card"}</span>
              <span className="text-[11px] px-4 text-center">
                {hint || (isSelfie ? "Prends ton selfie en direct" : "Prends ta pièce en photo en direct")}
              </span>
            </div>
          </>
        )}
      </div>

      {preview ? (
        <button onClick={retake} className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold" style={{ background: "#171f33", color: "#dae2fd" }}>
          Reprendre la photo
        </button>
      ) : (
        <button onClick={openCamera} className="w-full mt-3 py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2"
          style={{ background: ACCENT, color: "#00363e" }}>
          <span className="material-symbols-outlined text-lg">photo_camera</span> Prendre la photo
        </button>
      )}
    </div>
  );
}
