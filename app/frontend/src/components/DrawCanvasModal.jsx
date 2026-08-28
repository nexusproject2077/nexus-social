// Mini-canevas de dessin pour la messagerie (façon Instagram « Dessiner »).
// Fond sombre, pinceau NÉON à la couleur d'accentuation. Valider → envoie
// le dessin sous forme d'image PNG dans le fil.
import { useRef, useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

function accentColor() {
  try {
    const s = getComputedStyle(document.documentElement);
    return (s.getPropertyValue("--nexus-accent-solid") || s.getPropertyValue("--nexus-accent") || "").trim() || "#22d3ee";
  } catch {
    return "#22d3ee";
  }
}

export default function DrawCanvasModal({ open, onClose, onSubmit }) {
  const { t } = useTranslation();
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [dirty, setDirty] = useState(false);
  const [color, setColor] = useState("#22d3ee");

  // (Ré)initialise le canevas quand la modale s'ouvre (taille réelle × DPR).
  const setup = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(rect.width * dpr);
    cv.height = Math.round(rect.height * dpr);
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctxRef.current = ctx;
    setDirty(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const c = accentColor();
    setColor(c);
    // Laisse le layout se poser avant de mesurer le canevas.
    const id = requestAnimationFrame(setup);
    return () => cancelAnimationFrame(id);
  }, [open, setup]);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!dirty) setDirty(true);
  };
  const end = () => { drawing.current = false; };

  const clear = () => setup();
  const validate = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    onSubmit?.(cv.toDataURL("image/png"));
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex flex-col" style={{ background: "rgba(2,6,20,0.92)" }}>
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.08)" }} aria-label={t("dm.cancel")}}>
          <span className="material-symbols-outlined" style={{ color: "#dae2fd" }}>close</span>
        </button>
        <span className="text-sm font-bold" style={{ color: "#dae2fd" }}>{t("dm.draw")}</span>
        <button onClick={clear} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.08)" }} aria-label={t("dm.erase")}}>
          <span className="material-symbols-outlined" style={{ color: "#dae2fd" }}>ink_eraser</span>
        </button>
      </div>
      <div className="flex-1 px-4 pb-2 min-h-0">
        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-2xl touch-none"
          style={{ background: "#0b1220", border: "1px solid rgba(255,255,255,0.1)", display: "block" }}
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        />
      </div>
      <div className="px-4 pb-6 pt-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 1.25rem)" }}>
        <button onClick={validate} disabled={!dirty}
          className="w-full py-3 rounded-2xl font-black text-sm disabled:opacity-40 active:scale-[0.98] transition-transform"
          style={{ background: dirty ? "linear-gradient(135deg,var(--nexus-accent),#3b82f6)" : "#1a2234", color: dirty ? "#04121a" : "#64748b" }}>
          {t("dm.send_drawing")}
        </button>
      </div>
    </div>
  );
}
