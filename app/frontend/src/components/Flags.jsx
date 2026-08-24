// Drapeaux SVG « premium » (coins arrondis, fin liseré, aucune emoji).
// Ratio 3:2 (viewBox 24×16). Utilisés dans l'accordéon de personnalisation Foot.

// Étoile à 5 branches centrée (cx,cy), rayon externe R.
function starPath(cx, cy, R) {
  const r = R * 0.5;
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? R : r;
    d += (i === 0 ? "M" : "L") + (cx + rr * Math.cos(a)).toFixed(2) + "," + (cy + rr * Math.sin(a)).toFixed(2);
  }
  return d + "Z";
}

export default function Flag({ code, size = 20 }) {
  const w = size;
  const h = Math.round((size * 2) / 3);
  const clip = `fl_${code}`;
  const frame = (children) => (
    <svg width={w} height={h} viewBox="0 0 24 16" aria-hidden
      style={{ display: "block", borderRadius: 3, boxShadow: "0 0 0 0.5px rgba(255,255,255,0.22)", flexShrink: 0 }}>
      <defs>
        <clipPath id={clip}><rect width="24" height="16" rx="3" /></clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>{children}</g>
    </svg>
  );

  switch (code) {
    case "fr":
      return frame(<>
        <rect width="8" height="16" fill="#0055A4" />
        <rect x="8" width="8" height="16" fill="#F5F5F5" />
        <rect x="16" width="8" height="16" fill="#EF4135" />
      </>);
    case "en": // Angleterre (croix de Saint-Georges)
      return frame(<>
        <rect width="24" height="16" fill="#F7F7F7" />
        <rect x="9.5" width="5" height="16" fill="#CE1124" />
        <rect y="5.5" width="24" height="5" fill="#CE1124" />
      </>);
    case "es": // Espagne (rouge-or-rouge)
      return frame(<>
        <rect width="24" height="16" fill="#AA151B" />
        <rect y="4" width="24" height="8" fill="#F1BF00" />
      </>);
    case "it":
      return frame(<>
        <rect width="8" height="16" fill="#008C45" />
        <rect x="8" width="8" height="16" fill="#F5F5F5" />
        <rect x="16" width="8" height="16" fill="#CD212A" />
      </>);
    case "de":
      return frame(<>
        <rect width="24" height="16" fill="#FFCE00" />
        <rect width="24" height="10.67" fill="#DD0000" />
        <rect width="24" height="5.33" fill="#161616" />
      </>);
    case "tr": // Turquie (croissant + étoile)
      return frame(<>
        <rect width="24" height="16" fill="#E30A17" />
        <circle cx="9" cy="8" r="4.1" fill="#fff" />
        <circle cx="10.4" cy="8" r="3.3" fill="#E30A17" />
        <path d={starPath(14.6, 8, 1.9)} fill="#fff" />
      </>);
    case "eu": { // Europe : cercle de 12 étoiles or sur fond bleu
      const stars = Array.from({ length: 12 }).map((_, i) => {
        const a = (Math.PI / 6) * i - Math.PI / 2;
        return <path key={i} d={starPath(12 + 5 * Math.cos(a), 8 + 5 * Math.sin(a), 1.05)} fill="#FFCC00" />;
      });
      return frame(<>
        <rect width="24" height="16" fill="#003399" />
        {stars}
      </>);
    }
    case "globe": // International (globe stylisé)
    default:
      return frame(<>
        <rect width="24" height="16" fill="#0B2A6B" />
        <circle cx="12" cy="8" r="6" fill="rgba(125,169,255,0.12)" stroke="#7DA9FF" strokeWidth="0.8" />
        <line x1="6" y1="8" x2="18" y2="8" stroke="#7DA9FF" strokeWidth="0.7" />
        <ellipse cx="12" cy="8" rx="2.7" ry="6" fill="none" stroke="#7DA9FF" strokeWidth="0.7" />
        <path d="M6.6 5.6 H17.4 M6.6 10.4 H17.4" stroke="#7DA9FF" strokeWidth="0.6" />
      </>);
  }
}
