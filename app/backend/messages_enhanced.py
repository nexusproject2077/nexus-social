# backend/messages_enhanced.py - Système de messages amélioré

from fastapi import APIRouter, Depends, HTTPException, Body
from datetime import datetime, timezone
from typing import Optional, List
import uuid

messages_router = APIRouter(prefix="/api/messages", tags=["messages"])

# ==================== MODÈLES DE DONNÉES ====================

# Collection: messages (mise à jour)
"""
{
    "id": "uuid",
    "sender_id": "uuid",
    "recipient_id": "uuid",
    "content": "Hello!",
    "media_urls": [],
    "reply_to_id": null,  # NOUVEAU : ID du message auquel on répond
    "status": "sent",  # NOUVEAU : sent, delivered, read
    "delivered_at": null,  # NOUVEAU
    "read_at": null,  # NOUVEAU
    "reactions": [  # NOUVEAU
        {
            "user_id": "uuid",
            "emoji": "❤️",
            "created_at": "ISO datetime"
        }
    ],
    "deleted_by": [],  # NOUVEAU : ["sender_id"] ou ["recipient_id"] ou both
    "created_at": "ISO datetime",
    "updated_at": "ISO datetime"
}
"""

# Collection: group_chats (NOUVEAU)
"""
{
    "id": "uuid",
    "name": "Groupe Python",
    "avatar_url": "https://...",
    "creator_id": "uuid",
    "admin_ids": ["uuid1", "uuid2"],
    "member_ids": ["uuid1", "uuid2", "uuid3"],
    "settings": {
        "allow_members_to_add": true,
        "allow_members_to_send_media": true
    },
    "created_at": "ISO datetime",
    "updated_at": "ISO datetime"
}
"""

# Collection: group_messages
"""
{
    "id": "uuid",
    "group_id": "uuid",
    "sender_id": "uuid",
    "content": "Hello group!",
    "media_urls": [],
    "reply_to_id": null,
    "reactions": [...],
    "read_by": ["uuid1", "uuid2"],  # Liste des membres qui ont lu
    "deleted_for": [],  # Liste des user_ids pour qui c'est supprimé
    "created_at": "ISO datetime"
}
"""

# ==================== ENVOI DE MESSAGE ====================

@messages_router.post("")
async def send_message(
    message_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Envoyer un message (mis à jour avec statut)"""
    try:
        now = datetime.now(timezone.utc).isoformat()
        
        message = {
            "id": str(uuid.uuid4()),
            "sender_id": current_user["id"],
            "recipient_id": message_data["recipient_id"],
            "content": message_data["content"],
            "media_urls": message_data.get("media_urls", []),
            "reply_to_id": message_data.get("reply_to_id"),
            "status": "sent",
            "delivered_at": None,
            "read_at": None,
            "reactions": [],
            "deleted_by": [],
            "created_at": now,
            "updated_at": now
        }
        
        await db.messages.insert_one(message)
        
        # Notifier via WebSocket si l'utilisateur est connecté
        from .websocket_notifications import notify_new_message
        await notify_new_message(
            sender_id=current_user["id"],
            recipient_id=message_data["recipient_id"],
            message_id=message["id"],
            sender_data=current_user,
            message_preview=message_data["content"]
        )
        
        return {
            "success": True,
            "message": message
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== STATUT DES MESSAGES ====================

@messages_router.put("/{message_id}/status")
async def update_message_status(
    message_id: str,
    status: str = Body(...),  # "delivered" ou "read"
    current_user: dict = Depends(get_current_user)
):
    """Mettre à jour le statut d'un message (delivered/read)"""
    try:
        message = await db.messages.find_one({"id": message_id})
        
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
        
        # Seul le destinataire peut mettre à jour le statut
        if message["recipient_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        now = datetime.now(timezone.utc).isoformat()
        updates = {"status": status, "updated_at": now}
        
        if status == "delivered" and not message.get("delivered_at"):
            updates["delivered_at"] = now
        elif status == "read" and not message.get("read_at"):
            updates["read_at"] = now
            if not message.get("delivered_at"):
                updates["delivered_at"] = now
        
        await db.messages.update_one(
            {"id": message_id},
            {"$set": updates}
        )
        
        # Notifier l'expéditeur via WebSocket
        # TODO: Envoyer notification de lecture
        
        return {"success": True, "status": status}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@messages_router.put("/mark-as-read/{user_id}")
async def mark_conversation_as_read(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Marquer tous les messages d'une conversation comme lus"""
    try:
        now = datetime.now(timezone.utc).isoformat()
        
        # Marquer tous les messages non lus de cet utilisateur
        result = await db.messages.update_many(
            {
                "sender_id": user_id,
                "recipient_id": current_user["id"],
                "status": {"$ne": "read"}
            },
            {
                "$set": {
                    "status": "read",
                    "read_at": now,
                    "updated_at": now
                }
            }
        )
        
        return {
            "success": True,
            "marked_count": result.modified_count
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== RÉACTIONS ====================

@messages_router.post("/{message_id}/react")
async def add_reaction(
    message_id: str,
    emoji: str = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Ajouter une réaction à un message"""
    try:
        message = await db.messages.find_one({"id": message_id})
        
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
        
        # Vérifier que l'utilisateur fait partie de la conversation
        if current_user["id"] not in [message["sender_id"], message["recipient_id"]]:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        # Vérifier si l'utilisateur a déjà réagi
        reactions = message.get("reactions", [])
        existing = next((r for r in reactions if r["user_id"] == current_user["id"]), None)
        
        if existing:
            # Remplacer la réaction existante
            reactions = [r for r in reactions if r["user_id"] != current_user["id"]]
        
        # Ajouter nouvelle réaction
        reactions.append({
            "user_id": current_user["id"],
            "emoji": emoji,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        await db.messages.update_one(
            {"id": message_id},
            {"$set": {"reactions": reactions}}
        )
        
        return {"success": True, "reactions": reactions}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@messages_router.delete("/{message_id}/react")
async def remove_reaction(
    message_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Retirer sa réaction d'un message"""
    try:
        message = await db.messages.find_one({"id": message_id})
        
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
        
        reactions = message.get("reactions", [])
        reactions = [r for r in reactions if r["user_id"] != current_user["id"]]
        
        await db.messages.update_one(
            {"id": message_id},
            {"$set": {"reactions": reactions}}
        )
        
        return {"success": True, "reactions": reactions}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== SUPPRESSION ====================

@messages_router.delete("/{message_id}")
async def delete_message(
    message_id: str,
    delete_for: str = Body("me"),  # "me" ou "everyone"
    current_user: dict = Depends(get_current_user)
):
    """Supprimer un message"""
    try:
        message = await db.messages.find_one({"id": message_id})
        
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
        
        deleted_by = message.get("deleted_by", [])
        
        if delete_for == "everyone":
            # Seul l'expéditeur peut supprimer pour tout le monde
            if message["sender_id"] != current_user["id"]:
                raise HTTPException(status_code=403, detail="Not authorized")
            
            # Supprimer complètement
            await db.messages.delete_one({"id": message_id})
            return {"success": True, "message": "Message deleted for everyone"}
        
        else:  # delete_for == "me"
            # Supprimer pour soi seulement
            if current_user["id"] not in deleted_by:
                deleted_by.append(current_user["id"])
            
            await db.messages.update_one(
                {"id": message_id},
                {"$set": {"deleted_by": deleted_by}}
            )
            
            return {"success": True, "message": "Message deleted for you"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== GROUPES ====================

@messages_router.post("/groups")
async def create_group(
    group_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Créer un groupe de discussion"""
    try:
        now = datetime.now(timezone.utc).isoformat()
        
        group = {
            "id": str(uuid.uuid4()),
            "name": group_data["name"],
            "avatar_url": group_data.get("avatar_url"),
            "creator_id": current_user["id"],
            "admin_ids": [current_user["id"]],
            "member_ids": [current_user["id"]] + group_data.get("member_ids", []),
            "settings": {
                "allow_members_to_add": group_data.get("allow_members_to_add", True),
                "allow_members_to_send_media": group_data.get("allow_members_to_send_media", True)
            },
            "created_at": now,
            "updated_at": now
        }
        
        await db.group_chats.insert_one(group)
        
        return {
            "success": True,
            "group": group
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@messages_router.get("/groups")
async def list_groups(current_user: dict = Depends(get_current_user)):
    """Lister les groupes de l'utilisateur"""
    try:
        groups = await db.group_chats.find({
            "member_ids": current_user["id"]
        }).to_list(length=100)
        
        return {
            "success": True,
            "groups": groups
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@messages_router.post("/groups/{group_id}/messages")
async def send_group_message(
    group_id: str,
    message_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Envoyer un message dans un groupe"""
    try:
        # Vérifier membership
        group = await db.group_chats.find_one({"id": group_id})
        
        if not group or current_user["id"] not in group["member_ids"]:
            raise HTTPException(status_code=403, detail="Not a member")
        
        now = datetime.now(timezone.utc).isoformat()
        
        message = {
            "id": str(uuid.uuid4()),
            "group_id": group_id,
            "sender_id": current_user["id"],
            "content": message_data["content"],
            "media_urls": message_data.get("media_urls", []),
            "reply_to_id": message_data.get("reply_to_id"),
            "reactions": [],
            "read_by": [current_user["id"]],
            "deleted_for": [],
            "created_at": now
        }
        
        await db.group_messages.insert_one(message)
        
        # Notifier tous les membres sauf soi-même
        from .websocket_notifications import notify_group_new_post
        members_to_notify = [m for m in group["member_ids"] if m != current_user["id"]]
        await notify_group_new_post(
            group_id=group_id,
            post_id=message["id"],
            author_data=current_user,
            group_members=members_to_notify
        )
        
        return {
            "success": True,
            "message": message
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@messages_router.get("/groups/{group_id}/messages")
async def get_group_messages(
    group_id: str,
    limit: int = 50,
    skip: int = 0,
    current_user: dict = Depends(get_current_user)
):
    """Récupérer les messages d'un groupe"""
    try:
        # Vérifier membership
        group = await db.group_chats.find_one({"id": group_id})
        
        if not group or current_user["id"] not in group["member_ids"]:
            raise HTTPException(status_code=403, detail="Not a member")
        
        # Récupérer messages non supprimés pour cet utilisateur
        messages = await db.group_messages.find({
            "group_id": group_id,
            "deleted_for": {"$ne": current_user["id"]}
        }).sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)
        
        return {
            "success": True,
            "messages": list(reversed(messages))
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Export
# Dans server.py:
# from .messages_enhanced import messages_router
# app.include_router(messages_router)
