import { useState, useEffect } from "react";

/**
 * Hauteur (px) masquée par le clavier virtuel (iOS / Android), via l'API
 * visualViewport. Sert à faire remonter un panneau collé en bas AU-DESSUS du
 * clavier. Renvoie 0 quand aucun clavier n'est ouvert (ou API absente).
 */
export default function useKeyboardInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return undefined;
    const update = () => {
      // Zone cachée = hauteur de la fenêtre − (hauteur visible + décalage haut).
      const hidden = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop,
      );
      // On ignore les petites variations (barres d'URL) ; un clavier fait > 120 px.
      setInset(hidden > 120 ? Math.round(hidden) : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
