// Lecture audio SANS session « Now Playing » iOS.
//
// Problème : sur iOS/iPadOS, tout élément <audio> — ou <video> non muet — qui
// joue réclame la session multimédia système. Résultat : un indicateur sonore
// (ondes) apparaît dans la Dynamic Island / la barre d'état / le centre de
// contrôle, et il PERSISTE même quand on change de page (aperçus musique des
// stories/clips, etc.). C'est ce que voit l'utilisateur sur la page Recherche.
//
// Parade fiable : faire passer le son par la Web Audio API (AudioContext). Le
// son décodé/routé par Web Audio n'alimente PAS « Now Playing » → aucun
// indicateur. On garde un repli natif sûr si le CORS empêche le routage (le son
// marchera quand même, la session pourra réapparaître, mais rien ne casse).

let _ctx = null;
function getCtx() {
  if (_ctx) return _ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    _ctx = new AC();
  } catch { return null; }
  return _ctx;
}

// L'AudioContext démarre « suspended » sur iOS : il faut le réveiller au premier
// geste de l'utilisateur (touch/clic). On lie l'écouteur une seule fois.
let _unlockBound = false;
function bindUnlock() {
  if (_unlockBound || typeof window === "undefined") return;
  _unlockBound = true;
  const resume = () => { const c = getCtx(); if (c && c.state === "suspended") c.resume().catch(() => {}); };
  ["touchend", "pointerdown", "mousedown", "keydown"].forEach((ev) =>
    window.addEventListener(ev, resume, { passive: true }));
}
if (typeof window !== "undefined") bindUnlock();

const _routed = new WeakSet();

// Fait passer le son d'un élément média (<audio>/<video>) par la Web Audio API.
// À n'appeler QUE lorsque l'élément a chargé sa source avec succès (sinon, pour
// une source cross-origin sans CORS, le son serait « teinté » = muet). Idempotent.
// Renvoie true si le routage est en place.
export function routeThroughWebAudio(el) {
  if (!el || _routed.has(el)) return _routed.has(el);
  const c = getCtx();
  if (!c || typeof c.createMediaElementSource !== "function") return false;
  try {
    const source = c.createMediaElementSource(el);
    source.connect(c.destination);
    _routed.add(el);
    if (c.state === "suspended") c.resume().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// Efface la session « Now Playing » pour faire disparaître l'indicateur résiduel
// quand plus rien ne joue (ex. en quittant un clip / une story).
export function clearNowPlaying() {
  try {
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  } catch { /* noop */ }
}

// Branche la neutralisation « Now Playing » sur un élément média rendu par React
// (ex. la <video> d'un clip). L'élément DOIT avoir crossOrigin="anonymous" pour
// permettre le routage. On route au premier `canplay` (chargement CORS réussi) ;
// si le chargement échoue (`error`, souvent CORS), on appelle `onFallback` pour
// que l'appelant repasse en lecture native. Renvoie un nettoyeur.
export function attachSilent(el, { onFallback } = {}) {
  if (!el) return () => {};
  let done = false;
  const onCanPlay = () => { if (!done && routeThroughWebAudio(el)) done = true; };
  const onError = () => {
    if (done) return;
    if (el.crossOrigin) { done = true; onFallback && onFallback(); }
  };
  el.addEventListener("canplay", onCanPlay);
  el.addEventListener("error", onError);
  if (el.readyState >= 3) onCanPlay();
  return () => {
    el.removeEventListener("canplay", onCanPlay);
    el.removeEventListener("error", onError);
  };
}

// Lecteur d'aperçu audio (musique) 100 % détaché du DOM : l'élément <audio> est
// créé en mémoire (jamais dans le JSX), routé par Web Audio, avec repli natif
// automatique si le CORS bloque. Idéal pour les aperçus musique des stories.
export class PreviewAudio {
  constructor() {
    this.el = typeof document !== "undefined" ? document.createElement("audio") : null;
    this._routed = false;
    this._fellBack = false;
    if (this.el) {
      this.el.loop = true;
      this.el.preload = "auto";
      this.el.crossOrigin = "anonymous"; // requis pour router le son par Web Audio
      this.el.addEventListener("canplay", () => {
        if (!this._routed && !this._fellBack) this._routed = routeThroughWebAudio(this.el);
      });
      this.el.addEventListener("error", () => {
        // Échec de chargement (souvent CORS) → repli natif sans crossOrigin.
        if (this._fellBack || this._routed || !this.el.crossOrigin) return;
        this._fellBack = true;
        const src = this._src;
        try {
          this.el.removeAttribute("crossorigin");
          this.el.crossOrigin = null;
          if (src) { this.el.src = src; this.el.play().catch(() => {}); }
        } catch { /* noop */ }
      });
    }
  }
  play(url, offset = 0) {
    const el = this.el;
    if (!el || !url) return;
    this._src = url;
    if (el.src !== url) el.src = url;
    const start = () => { try { if (offset) el.currentTime = offset; } catch { /* noop */ } el.play().catch(() => {}); };
    if (el.readyState >= 1) start();
    else el.addEventListener("loadedmetadata", start, { once: true });
  }
  seek(t) { try { if (this.el) this.el.currentTime = t; } catch { /* noop */ } }
  pause() { try { this.el && this.el.pause(); } catch { /* noop */ } }
  destroy() {
    try { if (this.el) { this.el.pause(); this.el.removeAttribute("src"); this.el.load(); } } catch { /* noop */ }
    clearNowPlaying();
  }
}
