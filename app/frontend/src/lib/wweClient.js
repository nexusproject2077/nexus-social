/**
 * WWE — vraie API gratuite TheSportsDB (league id 4444).
 * https://www.thesportsdb.com/api/v1/json/3/...
 * Clé publique gratuite "3" (test). Aucun compte obligatoire.
 *
 * MMA (UFC) reste sur ESPN — totalement séparé (sport: "mma").
 * WWE utilise sport: "wwe".
 */

const TSDB = "https://www.thesportsdb.com/api/v1/json/3";
const WWE_LEAGUE_ID = "4444";

async function fetchJson(url) {
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      mode: "cors",
      credentials: "omit",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function brandFromName(name = "") {
  const n = name.toUpperCase();
  if (n.includes("SMACKDOWN") || n.includes("SMACK DOWN"))
    return { brand: "SD", color: "#3b82f6" };
  if (n.includes("NXT")) return { brand: "NXT", color: "#fbbf24" };
  if (n.includes("RAW") || n.includes("MONDAY NIGHT"))
    return { brand: "RAW", color: "#e11d48" };
  if (n.includes("EVOLVE")) return { brand: "EVOLVE", color: "#a3e635" };
  // PLE / specials
  if (
    /WRESTLEMANIA|SUMMERSLAM|ROYAL RUMBLE|SURVIVOR|MONEY IN THE BANK|ELIMINATION CHAMBER|CROWN JEWEL|BAD BLOOD|FASTLANE|CLASH|HEATWAVE|HALLOWEEN|SATURDAY NIGHT/i.test(
      name,
    )
  ) {
    return { brand: "PLE", color: "#a855f7" };
  }
  return { brand: "WWE", color: "#e11d48" };
}

function stateFromTimestamp(ts, dateEvent, timeStr) {
  let start;
  if (ts) start = new Date(ts.endsWith("Z") ? ts : ts + "Z");
  else if (dateEvent)
    start = new Date(`${dateEvent}T${(timeStr || "00:00:00").slice(0, 8)}Z`);
  else return "pre";
  if (Number.isNaN(start.getTime())) return "pre";
  const now = Date.now();
  const durationMs = 3.5 * 3600 * 1000; // show ~3h30
  if (now >= start.getTime() && now <= start.getTime() + durationMs)
    return "in";
  if (now > start.getTime() + durationMs) return "post";
  return "pre";
}

function clockLabel(ts, dateEvent, timeStr, state) {
  let start;
  if (ts) start = new Date(ts.endsWith("Z") ? ts : ts + "Z");
  else if (dateEvent)
    start = new Date(`${dateEvent}T${(timeStr || "00:00:00").slice(0, 8)}Z`);
  else return "";
  if (Number.isNaN(start.getTime())) return dateEvent || "";
  if (state === "in") {
    const elapsed = Math.floor((Date.now() - start.getTime()) / 60000);
    const h = Math.floor(elapsed / 60);
    const m = elapsed % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}'`;
  }
  return start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeEvent(ev) {
  const name = ev.strEvent || ev.strFilename || "WWE";
  const { brand, color } = brandFromName(name);
  const state = stateFromTimestamp(ev.strTimestamp, ev.dateEvent, ev.strTime);
  const venue = [ev.strVenue, ev.strCity, ev.strCountry]
    .filter(Boolean)
    .join(" · ");
  const cardHint =
    (ev.strDescriptionEN || "").split("\n").filter(Boolean)[0] || "";
  return {
    id: String(ev.idEvent || name),
    sport: "wwe",
    event: name,
    brand,
    brand_color: color,
    f1: { name: brand, avatar: null, winner: false },
    f2: { name: cardHint.slice(0, 40) || "WWE", avatar: null, winner: false },
    state,
    round: null,
    clock: clockLabel(ev.strTimestamp, ev.dateEvent, ev.strTime, state),
    method: venue,
    winner: null,
    detail: cardHint || venue || name,
    date: ev.strTimestamp || `${ev.dateEvent}T${ev.strTime || "00:00:00"}Z`,
    venue: venue || "",
    is_ple: brand === "PLE",
    poster: ev.strPoster || ev.strThumb || null,
    badge: ev.strLeagueBadge || null,
    description: ev.strDescriptionEN || "",
  };
}

/**
 * Récupère prochains + récents événements WWE via TheSportsDB (gratuit).
 */
export async function fetchWweEvents() {
  const [next, past] = await Promise.all([
    fetchJson(`${TSDB}/eventsnextleague.php?id=${WWE_LEAGUE_ID}`),
    fetchJson(`${TSDB}/eventspastleague.php?id=${WWE_LEAGUE_ID}`),
  ]);

  const raw = [
    ...((next && next.events) || []),
    ...((past && past.events) || []),
  ];

  const seen = new Set();
  const out = [];
  for (const ev of raw) {
    if (!ev || !ev.idEvent || seen.has(ev.idEvent)) continue;
    seen.add(ev.idEvent);
    out.push(normalizeEvent(ev));
  }

  // garder live + à venir + terminés < 48 h
  const now = Date.now();
  const filtered = out.filter((m) => {
    if (m.state === "in") return true;
    const t = new Date(m.date).getTime();
    if (Number.isNaN(t)) return m.state === "pre";
    if (m.state === "pre") return t - now < 60 * 24 * 3600 * 1000; // 60 jours
    return now - t < 48 * 3600 * 1000;
  });

  const order = { in: 0, pre: 1, post: 2 };
  filtered.sort(
    (a, b) =>
      (order[a.state] ?? 3) - (order[b.state] ?? 3) ||
      new Date(a.date) - new Date(b.date),
  );

  return filtered.slice(0, 12);
}

/** @deprecated alias */
export function buildWweSchedule() {
  return [];
}
