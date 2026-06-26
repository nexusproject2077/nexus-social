"""
nexus_mail.py - Nexus Mail : une messagerie e-mail complète (type Gmail)
pour les utilisateurs Nexus.

Chaque utilisateur dispose automatiquement d'une adresse `username@nexus.mail`.
Fonctionnalités : boîte de réception, envoyés, brouillons, favoris, archives,
corbeille, composition (à / cc), réponse, transfert, recherche, lu/non-lu,
étoiles, et carnet de contacts.

Le module est autonome (pattern follows.py) : la base de données est injectée
depuis server.py via set_database().
"""

from fastapi import APIRouter, HTTPException, Depends, Query, Body
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel
import uuid
import os
import re
import jwt

# Router Nexus Mail
mail_router = APIRouter(prefix="/api/mail", tags=["nexus-mail"])

# Security
security = HTTPBearer()
SECRET_KEY = os.environ.get("SECRET_KEY", "76f267dbc69c6b4e639a50a7ccdd3783")
ALGORITHM = "HS256"

MAIL_DOMAIN = "nexus.mail"

# MongoDB (injecté depuis server.py)
db = None


def set_database(database):
    """Injecte la base de données depuis server.py"""
    global db
    db = database


# ==================== AUTH ====================

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Récupère l'utilisateur actuel depuis le token JWT"""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub") or payload.get("user_id")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Token invalide")
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if user is None:
            raise HTTPException(status_code=401, detail="Utilisateur introuvable")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expiré")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token invalide")


# ==================== MODELS ====================

class SendMailRequest(BaseModel):
    to: List[str] = []
    cc: List[str] = []
    subject: str = ""
    body: str = ""
    draft_id: Optional[str] = None
    reply_to: Optional[str] = None


class DraftRequest(BaseModel):
    draft_id: Optional[str] = None
    to: List[str] = []
    cc: List[str] = []
    subject: str = ""
    body: str = ""


class ReadRequest(BaseModel):
    read: bool = True


# ==================== HELPERS ====================

def nexus_address(username: str) -> str:
    """Construit l'adresse Nexus Mail d'un utilisateur"""
    return f"{(username or '').lower()}@{MAIL_DOMAIN}"


def make_snippet(body: str, length: int = 140) -> str:
    """Extrait un aperçu du corps de l'e-mail"""
    text = re.sub(r"\s+", " ", (body or "")).strip()
    return text[:length]


async def resolve_recipient(address: str) -> Optional[dict]:
    """Résout une adresse (alice@nexus.mail, alice, ou un e-mail réel) -> user doc"""
    if not address:
        return None
    addr = address.strip().lower()

    # Adresse Nexus (username@nexus.mail) -> on extrait le username
    if addr.endswith(f"@{MAIL_DOMAIN}"):
        username = addr.split("@")[0]
        user = await db.users.find_one(
            {"username": {"$regex": f"^{re.escape(username)}$", "$options": "i"}},
            {"_id": 0},
        )
        if user:
            return user

    # E-mail réel enregistré
    if "@" in addr:
        user = await db.users.find_one(
            {"email": {"$regex": f"^{re.escape(addr)}$", "$options": "i"}},
            {"_id": 0},
        )
        if user:
            return user

    # Username brut sans domaine
    user = await db.users.find_one(
        {"username": {"$regex": f"^{re.escape(addr)}$", "$options": "i"}},
        {"_id": 0},
    )
    return user


def format_mail(mail: dict, uid: str) -> dict:
    """Formate un e-mail pour l'utilisateur courant avec les champs calculés"""
    to_ids = mail.get("to_ids", [])
    direction = "received" if uid in to_ids else "sent"
    return {
        "id": mail["id"],
        "thread_id": mail.get("thread_id", mail["id"]),
        "sender_id": mail.get("sender_id"),
        "sender_username": mail.get("sender_username"),
        "sender_email": mail.get("sender_email"),
        "sender_profile_pic": mail.get("sender_profile_pic"),
        "to": mail.get("to", []),
        "cc": mail.get("cc", []),
        "to_names": mail.get("to_names", []),
        "subject": mail.get("subject", ""),
        "body": mail.get("body", ""),
        "snippet": mail.get("snippet", ""),
        "created_at": mail.get("created_at"),
        "is_draft": mail.get("is_draft", False),
        "is_read": uid in mail.get("read_by", []),
        "is_starred": uid in mail.get("starred_by", []),
        "in_trash": uid in mail.get("trashed_by", []),
        "in_archive": uid in mail.get("archived_by", []),
        "direction": direction,
        "has_attachments": bool(mail.get("attachments")),
    }


async def fetch_user_mails(uid: str) -> List[dict]:
    """Récupère tous les e-mails où l'utilisateur est expéditeur ou destinataire,
    en excluant ceux qu'il a définitivement supprimés."""
    cursor = db.mails.find(
        {
            "$or": [{"sender_id": uid}, {"to_ids": uid}],
            "deleted_by": {"$ne": uid},
        },
        {"_id": 0},
    ).sort("created_at", -1)
    return await cursor.to_list(length=500)


def belongs_to_folder(mail: dict, uid: str, folder: str) -> bool:
    """Détermine si un e-mail appartient au dossier demandé pour l'utilisateur"""
    is_draft = mail.get("is_draft", False)
    sender_id = mail.get("sender_id")
    to_ids = mail.get("to_ids", [])
    trashed = uid in mail.get("trashed_by", [])
    archived = uid in mail.get("archived_by", [])
    starred = uid in mail.get("starred_by", [])

    if folder == "trash":
        return trashed
    if trashed:
        return False  # les e-mails en corbeille n'apparaissent pas ailleurs

    if folder == "drafts":
        return is_draft and sender_id == uid
    if is_draft:
        return False  # un brouillon n'apparaît que dans Brouillons

    if folder == "starred":
        return starred and not archived
    if folder == "archive":
        return archived and uid in to_ids
    if folder == "sent":
        return sender_id == uid and not archived
    if folder == "inbox":
        return uid in to_ids and not archived
    return False


# ==================== ENDPOINTS ====================

@mail_router.get("/me")
async def get_my_mailbox(current_user: dict = Depends(get_current_user)):
    """Retourne l'adresse Nexus Mail de l'utilisateur et le nombre de non-lus"""
    uid = current_user["id"]
    unread = await db.mails.count_documents(
        {
            "to_ids": uid,
            "is_draft": {"$ne": True},
            "read_by": {"$ne": uid},
            "trashed_by": {"$ne": uid},
            "archived_by": {"$ne": uid},
            "deleted_by": {"$ne": uid},
        }
    )
    return {
        "user_id": uid,
        "username": current_user["username"],
        "email": nexus_address(current_user["username"]),
        "real_email": current_user.get("email"),
        "profile_pic": current_user.get("profile_pic"),
        "unread": unread,
    }


@mail_router.get("/counts")
async def get_folder_counts(current_user: dict = Depends(get_current_user)):
    """Compteurs par dossier (non-lus pour inbox, total pour les autres)"""
    uid = current_user["id"]
    mails = await fetch_user_mails(uid)
    counts = {"inbox": 0, "sent": 0, "drafts": 0, "starred": 0, "archive": 0, "trash": 0}
    inbox_unread = 0
    for m in mails:
        for folder in counts:
            if belongs_to_folder(m, uid, folder):
                counts[folder] += 1
        if belongs_to_folder(m, uid, "inbox") and uid not in m.get("read_by", []):
            inbox_unread += 1
    counts["inbox_unread"] = inbox_unread
    return counts


@mail_router.get("/contacts")
async def get_contacts(
    q: str = Query("", description="Recherche par nom d'utilisateur"),
    current_user: dict = Depends(get_current_user),
):
    """Carnet de contacts : autres utilisateurs Nexus avec leur adresse mail"""
    query = {"id": {"$ne": current_user["id"]}}
    if q:
        query["username"] = {"$regex": re.escape(q), "$options": "i"}
    users = await db.users.find(
        query,
        {"_id": 0, "id": 1, "username": 1, "profile_pic": 1, "first_name": 1},
    ).limit(20).to_list(length=20)
    return [
        {
            "id": u["id"],
            "username": u["username"],
            "name": u.get("first_name") or u["username"],
            "email": nexus_address(u["username"]),
            "profile_pic": u.get("profile_pic"),
        }
        for u in users
    ]


@mail_router.get("/folder/{folder}")
async def get_folder(folder: str, current_user: dict = Depends(get_current_user)):
    """Liste les e-mails d'un dossier"""
    valid = {"inbox", "sent", "drafts", "starred", "archive", "trash"}
    if folder not in valid:
        raise HTTPException(status_code=400, detail="Dossier invalide")
    uid = current_user["id"]
    mails = await fetch_user_mails(uid)
    result = [format_mail(m, uid) for m in mails if belongs_to_folder(m, uid, folder)]
    return result


@mail_router.get("/search")
async def search_mail(
    q: str = Query(..., min_length=1),
    current_user: dict = Depends(get_current_user),
):
    """Recherche dans les e-mails (sujet, corps, expéditeur, destinataires)"""
    uid = current_user["id"]
    mails = await fetch_user_mails(uid)
    needle = q.lower()
    matches = []
    for m in mails:
        if uid in m.get("trashed_by", []):
            continue
        haystack = " ".join(
            [
                m.get("subject", ""),
                m.get("body", ""),
                m.get("sender_username", ""),
                m.get("sender_email", ""),
                " ".join(m.get("to", [])),
                " ".join(m.get("to_names", [])),
            ]
        ).lower()
        if needle in haystack:
            matches.append(format_mail(m, uid))
    return matches


@mail_router.get("/{mail_id}")
async def get_mail(mail_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère un e-mail complet et le marque comme lu si destinataire"""
    uid = current_user["id"]
    mail = await db.mails.find_one({"id": mail_id}, {"_id": 0})
    if not mail:
        raise HTTPException(status_code=404, detail="E-mail introuvable")
    if uid != mail.get("sender_id") and uid not in mail.get("to_ids", []):
        raise HTTPException(status_code=403, detail="Accès refusé")
    if uid in mail.get("deleted_by", []):
        raise HTTPException(status_code=404, detail="E-mail introuvable")

    # Marquer comme lu pour le destinataire
    if uid in mail.get("to_ids", []) and uid not in mail.get("read_by", []):
        await db.mails.update_one({"id": mail_id}, {"$addToSet": {"read_by": uid}})
        mail.setdefault("read_by", []).append(uid)

    return format_mail(mail, uid)


@mail_router.post("/send")
async def send_mail(payload: SendMailRequest, current_user: dict = Depends(get_current_user)):
    """Envoie un e-mail. Supprime le brouillon associé si fourni."""
    uid = current_user["id"]

    recipients = [a for a in (payload.to or []) if a and a.strip()]
    cc = [a for a in (payload.cc or []) if a and a.strip()]
    if not recipients:
        raise HTTPException(status_code=400, detail="Au moins un destinataire est requis")

    to_ids, to_emails, to_names, unknown = [], [], [], []
    for addr in recipients + cc:
        user = await resolve_recipient(addr)
        if user:
            if user["id"] not in to_ids:
                to_ids.append(user["id"])
                to_emails.append(nexus_address(user["username"]))
                to_names.append(user["username"])
        else:
            unknown.append(addr)

    if not to_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Aucun destinataire Nexus trouvé : {', '.join(unknown)}",
        )

    now = datetime.now(timezone.utc).isoformat()
    mail_id = str(uuid.uuid4())

    # Fil de discussion : conserver le thread si réponse
    thread_id = mail_id
    if payload.reply_to:
        parent = await db.mails.find_one({"id": payload.reply_to}, {"_id": 0})
        if parent:
            thread_id = parent.get("thread_id", parent["id"])

    mail = {
        "id": mail_id,
        "thread_id": thread_id,
        "sender_id": uid,
        "sender_username": current_user["username"],
        "sender_email": nexus_address(current_user["username"]),
        "sender_profile_pic": current_user.get("profile_pic"),
        "to": to_emails,
        "to_ids": to_ids,
        "to_names": to_names,
        "cc": cc,
        "subject": (payload.subject or "").strip() or "(sans objet)",
        "body": payload.body or "",
        "snippet": make_snippet(payload.body),
        "attachments": [],
        "is_draft": False,
        "reply_to": payload.reply_to,
        "read_by": [uid],  # l'expéditeur a déjà "lu" son propre message
        "starred_by": [],
        "trashed_by": [],
        "archived_by": [],
        "deleted_by": [],
        "created_at": now,
        "updated_at": now,
    }
    await db.mails.insert_one(mail)

    # Supprimer le brouillon associé
    if payload.draft_id:
        await db.mails.delete_one({"id": payload.draft_id, "sender_id": uid, "is_draft": True})

    return {
        "success": True,
        "mail": format_mail(mail, uid),
        "warning": (f"Destinataires inconnus ignorés : {', '.join(unknown)}" if unknown else None),
    }


@mail_router.post("/draft")
async def save_draft(payload: DraftRequest, current_user: dict = Depends(get_current_user)):
    """Crée ou met à jour un brouillon"""
    uid = current_user["id"]
    now = datetime.now(timezone.utc).isoformat()

    # Résoudre les noms des destinataires pour l'affichage
    to_names = []
    for addr in payload.to or []:
        user = await resolve_recipient(addr)
        to_names.append(user["username"] if user else addr)

    fields = {
        "to": payload.to or [],
        "to_names": to_names,
        "cc": payload.cc or [],
        "subject": (payload.subject or "").strip(),
        "body": payload.body or "",
        "snippet": make_snippet(payload.body),
        "updated_at": now,
    }

    if payload.draft_id:
        existing = await db.mails.find_one(
            {"id": payload.draft_id, "sender_id": uid, "is_draft": True}
        )
        if existing:
            await db.mails.update_one({"id": payload.draft_id}, {"$set": fields})
            updated = await db.mails.find_one({"id": payload.draft_id}, {"_id": 0})
            return {"success": True, "draft": format_mail(updated, uid)}

    draft_id = str(uuid.uuid4())
    draft = {
        "id": draft_id,
        "thread_id": draft_id,
        "sender_id": uid,
        "sender_username": current_user["username"],
        "sender_email": nexus_address(current_user["username"]),
        "sender_profile_pic": current_user.get("profile_pic"),
        "to_ids": [],
        "attachments": [],
        "is_draft": True,
        "read_by": [uid],
        "starred_by": [],
        "trashed_by": [],
        "archived_by": [],
        "deleted_by": [],
        "created_at": now,
        **fields,
    }
    await db.mails.insert_one(draft)
    return {"success": True, "draft": format_mail(draft, uid)}


async def _require_participant(mail_id: str, uid: str) -> dict:
    mail = await db.mails.find_one({"id": mail_id}, {"_id": 0})
    if not mail:
        raise HTTPException(status_code=404, detail="E-mail introuvable")
    if uid != mail.get("sender_id") and uid not in mail.get("to_ids", []):
        raise HTTPException(status_code=403, detail="Accès refusé")
    return mail


@mail_router.put("/{mail_id}/read")
async def set_read(
    mail_id: str,
    payload: ReadRequest,
    current_user: dict = Depends(get_current_user),
):
    """Marque un e-mail comme lu / non-lu"""
    uid = current_user["id"]
    await _require_participant(mail_id, uid)
    op = "$addToSet" if payload.read else "$pull"
    await db.mails.update_one({"id": mail_id}, {op: {"read_by": uid}})
    return {"success": True, "read": payload.read}


@mail_router.put("/{mail_id}/star")
async def toggle_star(mail_id: str, current_user: dict = Depends(get_current_user)):
    """Ajoute / retire l'étoile (favori)"""
    uid = current_user["id"]
    mail = await _require_participant(mail_id, uid)
    if uid in mail.get("starred_by", []):
        await db.mails.update_one({"id": mail_id}, {"$pull": {"starred_by": uid}})
        starred = False
    else:
        await db.mails.update_one({"id": mail_id}, {"$addToSet": {"starred_by": uid}})
        starred = True
    return {"success": True, "starred": starred}


@mail_router.put("/{mail_id}/trash")
async def move_to_trash(mail_id: str, current_user: dict = Depends(get_current_user)):
    """Déplace un e-mail vers la corbeille"""
    uid = current_user["id"]
    await _require_participant(mail_id, uid)
    await db.mails.update_one(
        {"id": mail_id},
        {"$addToSet": {"trashed_by": uid}, "$pull": {"archived_by": uid}},
    )
    return {"success": True}


@mail_router.put("/{mail_id}/archive")
async def archive_mail(mail_id: str, current_user: dict = Depends(get_current_user)):
    """Archive un e-mail"""
    uid = current_user["id"]
    await _require_participant(mail_id, uid)
    await db.mails.update_one({"id": mail_id}, {"$addToSet": {"archived_by": uid}})
    return {"success": True}


@mail_router.put("/{mail_id}/restore")
async def restore_mail(mail_id: str, current_user: dict = Depends(get_current_user)):
    """Restaure un e-mail depuis la corbeille / les archives"""
    uid = current_user["id"]
    await _require_participant(mail_id, uid)
    await db.mails.update_one(
        {"id": mail_id}, {"$pull": {"trashed_by": uid, "archived_by": uid}}
    )
    return {"success": True}


@mail_router.delete("/{mail_id}")
async def delete_forever(mail_id: str, current_user: dict = Depends(get_current_user)):
    """Supprime définitivement un e-mail (pour l'utilisateur courant uniquement).
    Les brouillons sont supprimés physiquement."""
    uid = current_user["id"]
    mail = await _require_participant(mail_id, uid)
    if mail.get("is_draft") and mail.get("sender_id") == uid:
        await db.mails.delete_one({"id": mail_id})
        return {"success": True, "deleted": True}
    await db.mails.update_one({"id": mail_id}, {"$addToSet": {"deleted_by": uid}})

    # Si plus aucun participant ne voit l'e-mail, le supprimer physiquement
    fresh = await db.mails.find_one({"id": mail_id}, {"_id": 0})
    participants = set([fresh.get("sender_id")] + fresh.get("to_ids", []))
    if participants and participants.issubset(set(fresh.get("deleted_by", []))):
        await db.mails.delete_one({"id": mail_id})
    return {"success": True, "deleted": True}
