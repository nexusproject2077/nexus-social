/** Défis clips hebdomadaires Nexus */

function weekId(d = new Date()) {
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

const ROTATION = [
  { tag: "NexusClip", title_key: "challenge.weekly_clip" },
  { tag: "NexusUCL", title_key: "challenge.ucl" },
  { tag: "NexusSkill", title_key: "challenge.skill" },
  { tag: "NexusLaugh", title_key: "challenge.laugh" },
];

export function getCurrentChallenge() {
  const id = weekId();
  const idx = parseInt(id.replace(/\D/g, ""), 10) % ROTATION.length;
  const base = ROTATION[idx];
  return {
    id,
    tag: base.tag,
    hashtag: `#${base.tag}`,
    title_key: base.title_key,
    endsHint: "challenge.ends_sunday",
  };
}

export function clipMatchesChallenge(clip, challenge = getCurrentChallenge()) {
  const c =
    `${clip?.content || ""} ${clip?.caption || ""} ${clip?.hashtags || ""}`.toLowerCase();
  return (
    c.includes(challenge.tag.toLowerCase()) ||
    c.includes(challenge.hashtag.toLowerCase())
  );
}
