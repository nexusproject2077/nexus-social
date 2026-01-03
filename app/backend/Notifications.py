# app/backend/notifications.py
"""
Système de notifications en temps réel avec WebSocket
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from datetime import datetime, timezone
from typing import Dict, Set
import json
from .server import get_current_user, db
import uuid

notification_router = APIRouter(prefix="/notifications", tags=["notifications"])

# Gestionnaire de connexions WebSocket
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)

    def disconnect(self, websocket: WebSocket, user_id: str):
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def send_notification(self, user_id: str, notification: dict):
        """Envoyer une notification à un utilisateur spécifique"""
        if user_id in self.active_connections:
            dead_connections = set()
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(notification)
                except:
                    dead_connections.add(connection)
            
            # Nettoyer les connexions mortes
            for dead in dead_connections:
                self.disconnect(dead, user_id)

manager = ConnectionManager()


@notification_router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """Endpoint WebSocket pour les notifications en temps réel"""
    await manager.connect(websocket, user_id)
    try:
        while True:
            # Garder la connexion ouverte
            data = await websocket.receive_text()
            # Optionnel: traiter les messages du client
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id)


@notification_router.get("/")
async def get_notifications(
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    """Récupérer les notifications de l'utilisateur"""
    try:
        notifications = await db.notifications.find(
            {"recipient_id": current_user["id"]}
        ).sort("created_at", -1).limit(limit).to_list(length=limit)
        
        # Convertir ObjectId en string
        for notif in notifications:
            notif["_id"] = str(notif["_id"])
        
        return notifications
    except Exception as e:
        return []


@notification_router.put("/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Marquer une notification comme lue"""
    try:
        result = await db.notifications.update_one(
            {
                "id": notification_id,
                "recipient_id": current_user["id"]
            },
            {"$set": {"read": True}}
        )
        
        if result.modified_count > 0:
            return {"success": True}
        return {"success": False, "error": "Notification not found"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@notification_router.put("/read-all")
async def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
    """Marquer toutes les notifications comme lues"""
    try:
        result = await db.notifications.update_many(
            {"recipient_id": current_user["id"], "read": False},
            {"$set": {"read": True}}
        )
        
        return {"success": True, "count": result.modified_count}
    except Exception as e:
        return {"success": False, "error": str(e)}


@notification_router.get("/unread-count")
async def get_unread_count(current_user: dict = Depends(get_current_user)):
    """Compter les notifications non lues"""
    try:
        count = await db.notifications.count_documents({
            "recipient_id": current_user["id"],
            "read": False
        })
        return {"count": count}
    except Exception as e:
        return {"count": 0}


# Fonctions utilitaires pour créer des notifications
async def create_notification(
    recipient_id: str,
    sender_id: str,
    notification_type: str,
    content: str,
    link: str = None,
    metadata: dict = None
):
    """Créer et envoyer une notification"""
    notification = {
        "id": str(uuid.uuid4()),
        "recipient_id": recipient_id,
        "sender_id": sender_id,
        "type": notification_type,  # 'like', 'comment', 'follow', 'story'
        "content": content,
        "link": link,
        "metadata": metadata or {},
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Sauvegarder dans la DB
    await db.notifications.insert_one(notification)
    
    # Envoyer en temps réel via WebSocket
    await manager.send_notification(recipient_id, notification)
    
    return notification


# Exemples d'utilisation dans les autres endpoints

async def notify_like(post_author_id: str, liker_id: str, liker_username: str, post_id: str):
    """Notifier l'auteur du post qu'il a reçu un like"""
    if post_author_id != liker_id:  # Ne pas notifier soi-même
        await create_notification(
            recipient_id=post_author_id,
            sender_id=liker_id,
            notification_type="like",
            content=f"{liker_username} a aimé votre publication",
            link=f"/posts/{post_id}",
            metadata={"post_id": post_id}
        )


async def notify_comment(post_author_id: str, commenter_id: str, commenter_username: str, post_id: str):
    """Notifier l'auteur du post d'un nouveau commentaire"""
    if post_author_id != commenter_id:
        await create_notification(
            recipient_id=post_author_id,
            sender_id=commenter_id,
            notification_type="comment",
            content=f"{commenter_username} a commenté votre publication",
            link=f"/posts/{post_id}",
            metadata={"post_id": post_id}
        )


async def notify_follow(followed_id: str, follower_id: str, follower_username: str):
    """Notifier qu'un utilisateur a commencé à suivre"""
    await create_notification(
        recipient_id=followed_id,
        sender_id=follower_id,
        notification_type="follow",
        content=f"{follower_username} a commencé à vous suivre",
        link=f"/profile/{follower_id}",
        metadata={"user_id": follower_id}
    )


async def notify_story(follower_id: str, author_id: str, author_username: str):
    """Notifier les abonnés d'une nouvelle story"""
    await create_notification(
        recipient_id=follower_id,
        sender_id=author_id,
        notification_type="story",
        content=f"{author_username} a publié une nouvelle story",
        link=f"/stories/{author_id}",
        metadata={"author_id": author_id}
    )
