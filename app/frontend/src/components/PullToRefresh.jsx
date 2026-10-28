import usePullToRefresh from "@/hooks/usePullToRefresh";

/**
 * Indicateur visuel de pull-to-refresh (spinner en haut de l'écran). À poser
 * une fois par page ; il gère lui-même l'écoute du geste via le hook.
 */
export default function PullToRefresh({ onRefresh, getScrollTop, enabled = true, threshold = 70 }) {
  const { pull, refreshing } = usePullToRefresh(onRefresh, { getScrollTop, enabled, threshold });
  const visible = pull > 0 || refreshing;
  if (!visible) return null;

  const progress = Math.min(1, pull / threshold);
  const offset = Math.max(6, (refreshing ? threshold : pull) - 14);

  return (
    <div className="fixed left-0 right-0 top-0 z-[70] flex justify-center pointer-events-none">
      <div
        className="flex items-center justify-center rounded-full shadow-lg"
        style={{
          width: 38,
          height: 38,
          marginTop: 6,
          transform: `translateY(${offset}px)`,
          background: "rgba(11,19,38,0.92)",
          border: "1px solid rgba(255,255,255,0.08)",
          transition: refreshing ? "none" : "transform 0.05s linear",
        }}
      >
        <span
          className={`material-symbols-outlined ${refreshing ? "animate-spin" : ""}`}
          style={{
            color: "var(--nexus-accent, #22d3ee)",
            fontSize: 22,
            transform: refreshing ? "none" : `rotate(${progress * 180}deg)`,
          }}
        >
          {refreshing ? "progress_activity" : "arrow_downward"}
        </span>
      </div>
    </div>
  );
}
