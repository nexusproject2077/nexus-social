"""
Modération automatique gratuite (open source, aucun service payant).

- Texte  : toxicité / haine via `unitary/toxic-bert` (transformers pipeline).
- Images : NSFW via NudeNet.
- Vidéos : NSFW en échantillonnant quelques images (OpenCV) puis NudeNet.

Tout est OPTIONNEL et *fail-open* : si les bibliothèques (transformers/torch,
nudenet, opencv) ou les modèles ne sont pas installés, les fonctions renvoient un
verdict « autorisé » et l'application continue de fonctionner normalement. Cela
évite de casser les déploiements légers (Render free / Vercel) où ces modèles
(lourds) ne tiennent pas. Pour activer :

    pip install -r requirements-moderation.txt
    export MODERATION_ENABLED=true

Politique « flag + review humain ». Deux seuils par catégorie :
- score >= *_BLOCK_THRESHOLD -> action "block" (contenu refusé, HTTP 400 côté API)
- score >= *_FLAG_THRESHOLD  -> action "flag"  (publié mais mis en file de
                                modération pour revue humaine)
- sinon                      -> action "allow"

Les modèles sont chargés paresseusement (au premier appel) et mis en cache. Un
échec de chargement est mémorisé pour ne pas retenter à chaque requête.
"""
import os
import base64
import threading

# --- Configuration (surchargée par variables d'environnement) ---------------
MODERATION_ENABLED = os.environ.get("MODERATION_ENABLED", "true").lower() == "true"

TOXIC_MODEL = os.environ.get("TOXIC_MODEL", "unitary/toxic-bert")
TOXIC_BLOCK_THRESHOLD = float(os.environ.get("TOXIC_BLOCK_THRESHOLD", "0.90"))
TOXIC_FLAG_THRESHOLD = float(os.environ.get("TOXIC_FLAG_THRESHOLD", "0.60"))

NSFW_BLOCK_THRESHOLD = float(os.environ.get("NSFW_BLOCK_THRESHOLD", "0.75"))
NSFW_FLAG_THRESHOLD = float(os.environ.get("NSFW_FLAG_THRESHOLD", "0.45"))

# Mode DISTANT (recommandé sur un hébergeur léger comme Render) : au lieu de
# charger les modèles ici, on délègue à un micro-service de modération qui tourne
# sur une machine avec assez de RAM (ex : un VPS). Si MODERATION_SERVICE_URL est
# défini, moderate_text / moderate_media appellent ce service en HTTP.
# Voir moderation_service.py pour le service à déployer sur le VPS.
MODERATION_SERVICE_URL = os.environ.get("MODERATION_SERVICE_URL", "").rstrip("/")
MODERATION_SERVICE_TOKEN = os.environ.get("MODERATION_SERVICE_TOKEN", "")
MODERATION_TIMEOUT = float(os.environ.get("MODERATION_TIMEOUT", "20"))

# Nombre d'images échantillonnées dans une vidéo (début / milieu / fin).
VIDEO_SAMPLE_POSITIONS = (0.1, 0.5, 0.9)

# Classes NudeNet considérées comme NSFW (parties intimes exposées).
_NUDE_UNSAFE = {
    "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED",
    "BUTTOCKS_EXPOSED", "ANUS_EXPOSED", "MALE_BREAST_EXPOSED", "FEMALE_GENITALIA_COVERED",
}

# --- Chargement paresseux des modèles ---------------------------------------
_text_pipe = None
_text_lock = threading.Lock()
_text_failed = False

_nude_detector = None
_nude_lock = threading.Lock()
_nude_failed = False


def _get_text_pipe():
    """Pipeline de classification de toxicité (chargé une seule fois)."""
    global _text_pipe, _text_failed
    if _text_pipe is not None or _text_failed:
        return _text_pipe
    with _text_lock:
        if _text_pipe is None and not _text_failed:
            try:
                from transformers import pipeline
                _text_pipe = pipeline("text-classification", model=TOXIC_MODEL, top_k=None)
                print(f"✅ Modération texte active ({TOXIC_MODEL})")
            except Exception as e:  # torch/transformers absents, pas de réseau, etc.
                _text_failed = True
                print(f"ℹ️ Modération texte indisponible ({e}) — texte non filtré")
    return _text_pipe


def _get_nude_detector():
    """Détecteur NudeNet (chargé une seule fois)."""
    global _nude_detector, _nude_failed
    if _nude_detector is not None or _nude_failed:
        return _nude_detector
    with _nude_lock:
        if _nude_detector is None and not _nude_failed:
            try:
                from nudenet import NudeDetector
                _nude_detector = NudeDetector()
                print("✅ Modération images active (NudeNet)")
            except Exception as e:
                _nude_failed = True
                print(f"ℹ️ Modération images indisponible ({e}) — images non filtrées")
    return _nude_detector


# --- Verdict ----------------------------------------------------------------
def _verdict(score, block_th, flag_th, label, category):
    if score >= block_th:
        action = "block"
    elif score >= flag_th:
        action = "flag"
    else:
        action = "allow"
    return {
        "flagged": action != "allow",
        "action": action,
        "category": category,   # "toxicity" | "nsfw"
        "label": label,
        "score": round(float(score), 4),
    }


def _allow(category="toxicity", label="clean"):
    """Verdict « autorisé » (seuils à 1.0 => jamais déclenché)."""
    return _verdict(0.0, 1.0, 1.0, label, category)


def _normalize_verdict(data, category="toxicity"):
    """Sécurise un verdict reçu du service distant (dict JSON) -> format interne."""
    if not isinstance(data, dict):
        return _allow(category)
    action = data.get("action") if data.get("action") in ("allow", "flag", "block") else "allow"
    return {
        "flagged": action != "allow",
        "action": action,
        "category": data.get("category", category),
        "label": data.get("label", "clean"),
        "score": float(data.get("score", 0.0) or 0.0),
    }


# --- Mode distant (micro-service sur VPS) ------------------------------------
def _remote_call(path, payload):
    """Appelle le service de modération distant. Lève en cas d'échec (géré par l'appelant)."""
    import requests
    headers = {"Content-Type": "application/json"}
    if MODERATION_SERVICE_TOKEN:
        headers["Authorization"] = f"Bearer {MODERATION_SERVICE_TOKEN}"
    resp = requests.post(f"{MODERATION_SERVICE_URL}{path}", json=payload,
                         headers=headers, timeout=MODERATION_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


# --- Texte ------------------------------------------------------------------
def moderate_text(text):
    """Analyse un texte -> {flagged, action, category, label, score}.

    Fail-open : renvoie 'allow' si la modération est désactivée ou indisponible.
    """
    clean = (text or "").strip()
    if not MODERATION_ENABLED or not clean:
        return _allow("toxicity")
    if MODERATION_SERVICE_URL:
        try:
            return _normalize_verdict(_remote_call("/moderate/text", {"text": clean[:5000]}), "toxicity")
        except Exception as e:
            print(f"⚠️ service modération (texte) indisponible ({e}) — non filtré")
            return _allow("toxicity")
    pipe = _get_text_pipe()
    if pipe is None:
        return _allow("toxicity")
    try:
        raw = pipe(clean[:2000])  # toxic-bert : ~512 tokens, on tronque par sécurité
        scores = raw[0] if raw and isinstance(raw[0], list) else raw
        if not scores:
            return _allow("toxicity")
        best = max(scores, key=lambda s: s.get("score", 0.0))
        return _verdict(best.get("score", 0.0), TOXIC_BLOCK_THRESHOLD,
                        TOXIC_FLAG_THRESHOLD, best.get("label", "toxic"), "toxicity")
    except Exception as e:
        print(f"⚠️ moderate_text: {e}")
        return _allow("toxicity")


# --- Images -----------------------------------------------------------------
def moderate_image_bytes(data, suffix=".jpg"):
    """Analyse une image (bytes) -> verdict NSFW. Fail-open."""
    if not MODERATION_ENABLED or not data:
        return _allow("nsfw", "safe")
    detector = _get_nude_detector()
    if detector is None:
        return _allow("nsfw", "safe")
    import tempfile
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            f.write(data)
            tmp = f.name
        detections = detector.detect(tmp) or []
        unsafe = [d for d in detections if d.get("class") in _NUDE_UNSAFE]
        if not unsafe:
            return _allow("nsfw", "safe")
        top = max(unsafe, key=lambda d: d.get("score", 0.0))
        return _verdict(top.get("score", 0.0), NSFW_BLOCK_THRESHOLD,
                        NSFW_FLAG_THRESHOLD, top.get("class", "nsfw"), "nsfw")
    except Exception as e:
        print(f"⚠️ moderate_image: {e}")
        return _allow("nsfw", "safe")
    finally:
        if tmp:
            try:
                os.remove(tmp)
            except Exception:
                pass


def moderate_video_bytes(data, suffix=".mp4"):
    """Analyse une vidéo (bytes) en échantillonnant quelques images -> verdict NSFW.

    Nécessite OpenCV pour décoder la vidéo ; fail-open s'il est absent.
    Renvoie le pire verdict parmi les images échantillonnées.
    """
    if not MODERATION_ENABLED or not data:
        return _allow("nsfw", "safe")
    if _get_nude_detector() is None:
        return _allow("nsfw", "safe")
    try:
        import cv2
    except Exception:
        # Pas d'OpenCV -> impossible d'échantillonner la vidéo (on laisse passer).
        return _allow("nsfw", "safe")
    import tempfile
    tmp = None
    worst = _allow("nsfw", "safe")
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            f.write(data)
            tmp = f.name
        cap = cv2.VideoCapture(tmp)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        idxs = [max(0, int(total * r)) for r in VIDEO_SAMPLE_POSITIONS] if total > 0 else [0]
        for i in idxs:
            cap.set(cv2.CAP_PROP_POS_FRAMES, i)
            ok, frame = cap.read()
            if not ok:
                continue
            ok2, buf = cv2.imencode(".jpg", frame)
            if not ok2:
                continue
            v = moderate_image_bytes(buf.tobytes(), ".jpg")
            if v["score"] > worst["score"]:
                worst = v
                if worst["action"] == "block":
                    break  # inutile de continuer, déjà bloquant
        cap.release()
        return worst
    except Exception as e:
        print(f"⚠️ moderate_video: {e}")
        return _allow("nsfw", "safe")
    finally:
        if tmp:
            try:
                os.remove(tmp)
            except Exception:
                pass


# --- Data URLs ("data:<mime>;base64,....") ----------------------------------
def parse_data_url(data_url):
    """('data:image/png;base64,...') -> (bytes, suffix, mime) ou (None, None, None)."""
    if not data_url or not isinstance(data_url, str) or not data_url.startswith("data:"):
        return None, None, None
    try:
        header, b64 = data_url.split(",", 1)
        raw = base64.b64decode(b64)
        mime = header[5:].split(";")[0] or "application/octet-stream"
        subtype = mime.split("/")[1] if "/" in mime else "bin"
        return raw, "." + subtype, mime
    except Exception:
        return None, None, None


def moderate_media(data_url):
    """Analyse un média encodé en data URL (image ou vidéo) -> verdict NSFW."""
    if not MODERATION_ENABLED or not data_url:
        return _allow("nsfw", "safe")
    if MODERATION_SERVICE_URL:
        try:
            return _normalize_verdict(_remote_call("/moderate/media", {"data_url": data_url}), "nsfw")
        except Exception as e:
            print(f"⚠️ service modération (média) indisponible ({e}) — non filtré")
            return _allow("nsfw", "safe")
    raw, suffix, mime = parse_data_url(data_url)
    if raw is None:
        return _allow("nsfw", "safe")
    if mime.startswith("video/"):
        return moderate_video_bytes(raw, suffix)
    if mime.startswith("image/"):
        return moderate_image_bytes(raw, suffix)
    return _allow("nsfw", "safe")


# Ordre de sévérité pour comparer/combiner des verdicts.
_SEVERITY = {"allow": 0, "flag": 1, "block": 2}


def worst_verdict(*verdicts):
    """Renvoie le verdict le plus sévère (block > flag > allow) parmi ceux fournis."""
    worst = None
    for v in verdicts:
        if v is None:
            continue
        if worst is None or _SEVERITY.get(v["action"], 0) > _SEVERITY.get(worst["action"], 0):
            worst = v
    return worst or _allow()
