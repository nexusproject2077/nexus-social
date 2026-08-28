import { useEffect, useRef, useState } from "react";

/**
 * Pull-to-refresh maison (façon réseau social) : détecte un glissement vers le
 * bas quand le conteneur est tout en haut, et déclenche `onRefresh` au
 * relâchement si le seuil est franchi. Empêche aussi le pull-to-refresh natif
 * de Chrome pendant le geste.
 *
 * @param {Function} onRefresh  callback async appelé au refresh
 * @param {Object}   options
 * @param {Function} options.getScrollTop  () => number : position de scroll du
 *        conteneur (défaut : fenêtre). Le PTR ne s'active qu'à <= 0.
 * @param {number}   options.threshold     distance (px) pour déclencher (défaut 70)
 * @param {boolean}  options.enabled        active/désactive le geste
 * @returns {{ pull: number, refreshing: boolean }} état pour l'indicateur visuel
 */
export default function usePullToRefresh(onRefresh, options = {}) {
  const { getScrollTop, threshold = 70, enabled = true } = options;
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const pullRef = useRef(0);
  const startY = useRef(null);
  const active = useRef(false);
  const refreshingRef = useRef(false);

  const setPullBoth = (v) => {
    pullRef.current = v;
    setPull(v);
  };

  useEffect(() => {
    if (!enabled) return undefined;

    const scrollTop = () =>
      getScrollTop
        ? getScrollTop()
        : window.scrollY || document.documentElement.scrollTop || 0;

    const onStart = (e) => {
      if (refreshingRef.current || e.touches.length !== 1) {
        active.current = false;
        return;
      }
      if (scrollTop() <= 0) {
        startY.current = e.touches[0].clientY;
        active.current = true;
      } else {
        active.current = false;
      }
    };

    const onMove = (e) => {
      if (!active.current || startY.current == null || refreshingRef.current)
        return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0 && scrollTop() <= 0) {
        const damped = Math.min(120, dy * 0.5); // résistance
        setPullBoth(damped);
        if (damped > 5 && e.cancelable) e.preventDefault(); // coupe le PTR natif
      } else if (pullRef.current !== 0) {
        setPullBoth(0);
      }
    };

    const onEnd = async () => {
      if (!active.current) return;
      active.current = false;
      startY.current = null;
      if (pullRef.current >= threshold && onRefresh) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPullBoth(threshold);
        try {
          await onRefresh();
        } catch {
          /* ignore */
        }
        refreshingRef.current = false;
        setRefreshing(false);
        setPullBoth(0);
      } else {
        setPullBoth(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, onRefresh, threshold, getScrollTop]);

  return { pull, refreshing };
}
