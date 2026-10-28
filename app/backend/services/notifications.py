"""Service notifications — temps réel (WebSocket) + Web Push + persistance.

Extrait de server.py à l'identique (Phase 6 du refactor). Regroupe tout ce qui
concerne les notifications : envoi temps réel, push navigateur (VAPID), et
création/persistance des notifications. Réutilisé par posts, comments,
messages, stories, follows…

Dépendances : core.database (db), le ConnectionManager WebSocket
(websocket_notifications) et pywebpush (optionnel).
"""
import asyncio
import json
import os
import uuid
from datetime import datetime, timezone

try:
    from backend.core.database import db
except ImportError:
    from core.database import db

# Gestionnaire de connexions WebSocket temps réel (module existant).
try:
    from backend.websocket_notifications import manager as ws_manager
except ImportError:
    try:
        from websocket_notifications import manager as ws_manager
    except ImportError:
        ws_manager = None


async def push_realtime(user_id: str, payload: dict):
    """Envoi temps réel best-effort : n'interrompt jamais la requête REST."""
    if ws_manager is None:
        return
    try:
        await ws_manager.send_personal_message(payload, user_id)
    except Exception:
        pass


# ==================== WEB PUSH (notifications app fermée) ====================
# Clés VAPID lues dans l'environnement (à définir sur Render pour la prod).
# En leur absence, l'envoi push est un no-op propre : l'in-app + le temps réel
# WebSocket continuent de fonctionner normalement.
VAPID_PUBLIC_KEY  = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT     = os.environ.get("VAPID_SUBJECT", "mailto:contact@nexus-social.app").strip()

try:
    from pywebpush import webpush, WebPushException  # type: ignore
    _WEBPUSH_LIB = True
except Exception:
    _WEBPUSH_LIB = False

def _web_push_enabled() -> bool:
    return _WEBPUSH_LIB and bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


def _push_content_for(notif_type, from_user, post_id=None, comment_content=None):
    """Titre / corps / URL cliquable d'une notification push, par type."""
    u = from_user.get("username", "Quelqu'un")
    uid = from_user.get("id", "")
    body = {
        "follow":          f"@{u} vous suit maintenant",
        "follow_request":  f"@{u} souhaite vous suivre",
        "follow_accepted": f"@{u} a accepté votre demande d'abonnement",
        "like":            f"@{u} a aimé votre publication",
        "like_clip":       f"@{u} a aimé votre clip",
        "like_story":      f"@{u} a aimé votre story",
        "comment":         f"@{u} a commenté" + (f" : {comment_content}" if comment_content else ""),
        "comment_reply":   f"@{u} a répondu à votre commentaire",
        "mention":         f"@{u} vous a mentionné",
        "tag":             f"@{u} vous a identifié",
        "live":            f"@{u} est en direct 🔴",
        "clip":            f"@{u} a publié un nouveau clip",
        "story":           f"@{u} a publié une nouvelle story",
        "story_reply":     f"@{u} a répondu à votre story",
        "story_reaction":  f"@{u} a réagi à votre story",
        "message":         f"Nouveau message de @{u}",
        "group_message":   f"@{u} a écrit dans un groupe",
        "message_request": f"@{u} veut vous envoyer un message",
        "trending":        "Votre publication est dans les tendances 🔥",
        "security":        "Connexion inhabituelle détectée sur votre compte",
    }.get(notif_type, f"@{u}")

    if notif_type in ("like", "like_clip", "like_story", "comment", "comment_reply",
                      "mention", "tag", "trending") and post_id:
        url = f"/post/{post_id}"
    elif notif_type == "clip":
        url = f"/nexus-clips/{post_id}" if post_id else "/nexus-clips"
    elif notif_type == "live":
        url = f"/live/{post_id}" if post_id else "/live"
    elif notif_type == "group_message":
        url = f"/messages/group/{post_id}" if post_id else "/messages"
    elif notif_type in ("message", "message_request"):
        url = f"/messages/{uid}" if uid else "/messages"
    elif notif_type in ("story", "story_reply", "story_reaction"):
        url = "/notifications"
    elif notif_type in ("follow", "follow_request", "follow_accepted"):
        url = f"/profil/{uid}" if uid else "/notifications"
    elif notif_type == "security":
        url = "/settings"
    else:
        url = "/notifications"
    return ("Nexus Social", body, url)


async def send_web_push(user_id: str, title: str, body: str, url: str = "/", tag: str = "nexus"):
    """Envoie une notification push (même app fermée) à tous les abonnements de
    l'utilisateur. Best-effort ; no-op si VAPID non configuré. Supprime les
    abonnements expirés (404/410)."""
    if not _web_push_enabled() or not user_id:
        return
    try:
        subs = await db.push_subscriptions.find({"user_id": user_id}).to_list(length=50)
    except Exception:
        return
    if not subs:
        return
    payload = json.dumps({"title": title, "body": (body or "")[:180], "url": url, "tag": tag})
    for s in subs:
        sub_info = s.get("subscription")
        if not sub_info:
            continue
        try:
            # pywebpush est synchrone : on l'exécute hors de la boucle asyncio.
            await asyncio.to_thread(
                webpush,
                subscription_info=sub_info,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUBJECT},
            )
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):
                try:
                    await db.push_subscriptions.delete_one({"_id": s["_id"]})
                except Exception:
                    pass
        except Exception:
            pass


# Types de notification connus (pour l'UI des réglages).
NOTIF_TYPES = [
    "like", "comment", "comment_reply", "mention", "tag",
    "follow", "follow_request", "follow_accepted", "live",
    "message", "group_message", "story_reply", "story_reaction",
    "instant", "instant_reaction", "trending", "security",
]


async def _notif_allowed(user_id, notif_type, from_user_id=None):
    """False si l'utilisateur a désactivé ce type de notification, ou coupé les
    notifications de cet expéditeur. Best-effort (autorise en cas d'erreur)."""
    if not user_id:
        return False
    try:
        pref = await db.notification_prefs.find_one({"user_id": user_id})
    except Exception:
        return True
    if not pref:
        return True
    if notif_type in (pref.get("disabled_types") or []):
        return False
    if from_user_id and from_user_id in (pref.get("muted_accounts") or []):
        return False
    return True


async def create_notification(user_id, notif_type, from_user, post_id=None,
                              comment_content=None):
    """Crée une notification (et la pousse en temps réel). Best-effort.

    N'auto-notifie jamais : si l'émetteur est le destinataire, on ignore.
    Respecte les préférences de l'utilisateur (type désactivé / compte coupé).
    """
    if not user_id or user_id == from_user.get("id"):
        return
    # Préférences par type (activé par défaut). On respecte les DEUX systèmes
    # (rétro-compat) : le profil par-type (users.notif_prefs, modale
    # NotificationSettings) ET la collection notification_prefs (page Réglages).
    try:
        _u = await db.users.find_one({"id": user_id}, {"notif_prefs": 1})
        if ((_u or {}).get("notif_prefs") or {}).get(notif_type) is False:
            return
    except Exception:
        pass
    if not await _notif_allowed(user_id, notif_type, from_user.get("id")):
        return
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": notif_type,
        "from_user_id": from_user.get("id"),
        "from_username": from_user.get("username", ""),
        "from_profile_pic": from_user.get("profile_pic"),
        "post_id": post_id,
        "comment_content": comment_content,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.notifications.insert_one(dict(doc))
        await push_realtime(user_id, {"type": "notification", "data": doc})
        # Push navigateur (app fermée) — best-effort, no-op si VAPID absent.
        title, body, url = _push_content_for(notif_type, from_user, post_id, comment_content)
        await send_web_push(user_id, title, body, url, tag=notif_type)
    except Exception:
        pass
