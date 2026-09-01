import { useState, useRef, useEffect, useCallback } from "react";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Gestion d'un panneau glissable (bottom-sheet) par sa poignée.
 *
 * Comportement :
 *  - glisser vers le HAUT  → agrandit (jusqu'au plus haut point de calage, ~92 %)
 *  - glisser vers le BAS   → réduit ; si trop bas → ferme le panneau
 *  - relâcher              → calage automatique : fermé / demi (~45 %) / plein (~92 %)
 *
 * @param {boolean}  open     panneau ouvert (réinitialise la hauteur à l'ouverture)
 * @param {function} onClose  appelé quand le geste doit fermer le panneau
 * @param {number[]} snaps    fractions de hauteur d'écran (ex : [0.45, 0.92])
 * @param {number}   initial  fraction d'ouverture par défaut
 *
 * Retourne { sheetStyle, handleProps, dragging, snapTo } :
 *  - sheetStyle  : à poser sur le panneau (hauteur + transition)
 *  - handleProps : à étaler sur la poignée (pointer events + touch-action)
 *  - dragging    : true pendant le glissement (désactive les transitions)
 *  - snapTo(f)   : force un point de calage par programme
 */
export default function useDraggableSheet({
  open,
  onClose,
  snaps = [0.45, 0.92],
  initial = 0.45,
} = {}) {
  const sorted = [...snaps].sort((a, b) => a - b);
  const [frac, setFrac] = useState(initial); // hauteur calée (au repos)
  const [live, setLive] = useState(initial); // hauteur suivie pendant le drag
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);

  useEffect(() => {
    if (open) {
      setFrac(initial);
      setLive(initial);
    }
  }, [open, initial]);

  const vh = () => window.innerHeight || 800;

  const onPointerDown = useCallback(
    (e) => {
      drag.current = { startY: e.clientY, startFrac: frac };
      setDragging(true);
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture non supportée — sans gravité */
      }
    },
    [frac],
  );

  const onPointerMove = useCallback((e) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY; // vers le bas = positif
    // Glisser vers le bas (dy > 0) réduit la hauteur ; vers le haut l'agrandit.
    setLive(clamp(drag.current.startFrac - dy / vh(), 0, 0.97));
  }, []);

  const end = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    // Cibles de calage = fermé (0) + points fournis. On prend la plus proche.
    const targets = [0, ...sorted];
    let best = targets[0];
    for (const tg of targets) {
      if (Math.abs(tg - live) < Math.abs(best - live)) best = tg;
    }
    if (best <= 0) {
      onClose?.();
    } else {
      setFrac(best);
      setLive(best);
    }
  }, [live, onClose, sorted]);

  const handleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    style: { touchAction: "none", cursor: dragging ? "grabbing" : "grab" },
  };

  const cur = dragging ? live : frac;
  const sheetStyle = {
    height: `${(cur * 100).toFixed(2)}vh`,
    transition: dragging ? "none" : "height 0.28s cubic-bezier(0.22,1,0.36,1)",
    willChange: "height",
  };

  const snapTo = (f) => {
    setFrac(f);
    setLive(f);
  };

  return { dragging, sheetStyle, handleProps, snapTo, frac };
}

/**
 * Variante légère pour les panneaux à hauteur de contenu (modales bottom-sheet
 * qui défilent d'elles-mêmes) : la poignée permet de GLISSER VERS LE BAS pour
 * ranger. Relâché au-delà du seuil → ferme ; sinon → revient en place (snap).
 * On ne modifie ni la hauteur ni le défilement du panneau : simple translation,
 * donc sûr à greffer sur des sheets existants.
 *
 * @param {function} onClose    appelé quand le panneau doit se fermer
 * @param {number}   threshold  distance (px) au-delà de laquelle on ferme
 */
export function useSheetDismiss({ onClose, threshold = 120 } = {}) {
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);

  const onPointerDown = useCallback((e) => {
    drag.current = { startY: e.clientY };
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture non supportée */
    }
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!drag.current) return;
    setDy(Math.max(0, e.clientY - drag.current.startY)); // uniquement vers le bas
  }, []);

  const end = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    const limit = Math.min(threshold, (window.innerHeight || 800) * 0.25);
    setDy((cur) => {
      if (cur > limit) onClose?.();
      return 0;
    });
  }, [onClose, threshold]);

  const handleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    style: { touchAction: "none", cursor: dragging ? "grabbing" : "grab" },
  };

  const sheetStyle = {
    transform: dy ? `translateY(${dy}px)` : undefined,
    transition: dragging
      ? "none"
      : "transform 0.28s cubic-bezier(0.22,1,0.36,1)",
  };

  return { dragging, sheetStyle, handleProps, dy };
}
