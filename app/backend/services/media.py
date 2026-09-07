"""Service média — décharge les médias base64 vers Cloudinary (hors base).

Premier service extrait de server.py (Phase 5 du refactor). Partagé par les
posts, les stories et les messages. Ne dépend que de la stdlib + Cloudinary.

Config par variables d'environnement :
  - soit CLOUDINARY_URL = cloudinary://<api_key>:<api_secret>@<cloud_name>
  - soit CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
Si Cloudinary n'est pas configuré, store_media() renvoie le média inchangé
(base64 conservé) → aucune régression, juste pas d'allègement.
"""
import asyncio
import logging
import os

logger = logging.getLogger(__name__)

# Toujours définis (même si le paquet cloudinary est absent) → imports sûrs
# côté server.py. L'usage réel reste protégé par `CLOUDINARY_READY`.
cloudinary = None
cloudinary_uploader = None
CLOUDINARY_READY = False

try:
    import cloudinary as _c
    import cloudinary.uploader as _cu

    cloudinary = _c
    cloudinary_uploader = _cu
    if os.environ.get("CLOUDINARY_URL"):
        cloudinary.config(secure=True)  # lit CLOUDINARY_URL
        CLOUDINARY_READY = True
    elif os.environ.get("CLOUDINARY_CLOUD_NAME"):
        cloudinary.config(
            cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
            api_key=os.environ.get("CLOUDINARY_API_KEY"),
            api_secret=os.environ.get("CLOUDINARY_API_SECRET"),
            secure=True,
        )
        CLOUDINARY_READY = True
    if CLOUDINARY_READY:
        print("✅ Cloudinary configuré (médias hors base)")
    else:
        print("ℹ️ Cloudinary non configuré — médias conservés en base (base64)")
except Exception as _e:
    print(f"ℹ️ Cloudinary indisponible ({_e}) — médias en base64")


async def store_media(media, folder="nexus"):
    """Décharge un média base64 vers Cloudinary et renvoie son URL (légère).

    - Si `media` est None/vide → renvoyé tel quel.
    - Si c'est déjà une URL http(s) (média externe déjà hébergé) → inchangé.
    - Si c'est une data URL base64 ET Cloudinary configuré → upload puis URL.
    - Sinon (pas de Cloudinary, ou échec upload) → renvoyé tel quel (base64
      conservé) : best-effort, jamais bloquant, aucune régression.
    """
    if not media or not isinstance(media, str):
        return media
    if not media.startswith("data:"):
        return media  # déjà une URL externe → rien à faire
    if not CLOUDINARY_READY:
        return media  # pas de Cloudinary → on garde le base64
    resource_type = "video" if media.startswith("data:video") else "image"

    def _upload():
        return cloudinary_uploader.upload(
            media, folder=folder, resource_type=resource_type,
            unique_filename=True, overwrite=False,
        )
    try:
        res = await asyncio.to_thread(_upload)
        return res.get("secure_url") or media
    except Exception as e:
        logger.warning(f"Upload Cloudinary échoué (média conservé en base64): {e}")
        return media


async def store_media_list(items, folder="nexus"):
    """store_media appliqué à une liste (messages de groupe : media_urls)."""
    if not items:
        return items
    out = []
    for it in items:
        out.append(await store_media(it, folder=folder))
    return out
