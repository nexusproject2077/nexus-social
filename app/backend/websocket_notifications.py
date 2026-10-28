# backend/websocket_notifications.py - Notifications temps réel

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from typing import Dict, Set, List
import json
from datetime import datetime, timezone
import asyncio

# ==================== GESTIONNAIRE DE CONNEXIONS ====================

class ConnectionManager:
    def __init__(self):
        # user_id -> Set[WebSocket]
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        
    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        print(f"✓ User {user_id} connected. Total connections: {len(self.active_connections[user_id])}")
        
    def disconnect(self, websocket: WebSocket, user_id: str):
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        print(f"✗ User {user_id} disconnected")
        
    async def send_personal_message(self, message: dict, user_id: str):
        """Envoyer un message à un utilisateur spécifique"""
        if user_id in self.active_connections:
            # Envoyer à toutes les connexions de cet utilisateur (multi-device)
            dead_connections = set()
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except:
                    dead_connections.add(connection)
            
            # Nettoyer les connexions mortes
            for dead in dead_connections:
                self.active_connections[user_id].discard(dead)
                
    async def send_to_multiple(self, message: dict, user_ids: List[str]):
        """Envoyer à plusieurs utilisateurs"""
        for user_id in user_ids:
            await self.send_personal_message(message, user_id)
            
    async def broadcast(self, message: dict):
        """Broadcast à tous les utilisateurs connectés"""
        for user_id in list(self.active_connections.keys()):
            await self.send_personal_message(message, user_id)

manager = ConnectionManager()

# ==================== WEBSOCKET ENDPOINT ====================

websocket_router = APIRouter(tags=["websocket"])

@websocket_router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint pour notifications temps réel
    Client se connecte avec son user_id
    """
    await manager.connect(websocket, user_id)
    
    try:
        while True:
            # Recevoir messages du client (heartbeat, etc.)
            data = await websocket.receive_text()
            
            # Heartbeat pour maintenir la connexion
            if data == "ping":
                await websocket.send_text("pong")
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id)
    except Exception as e:
        print(f"WebSocket error for user {user_id}: {e}")
        manager.disconnect(websocket, user_id)

# ==================== FONCTIONS D'ENVOI DE NOTIFICATIONS ====================

async def notify_new_follower(follower_id: str, followed_id: str, follower_data: dict):
    """Notifier qu'un utilisateur a un nouveau follower"""
    notification = {
        "type": "new_follower",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "follower_id": follower_id,
            "follower_username": follower_data.get("username"),
            "follower_avatar": follower_data.get("avatar_url"),
            "message": f"@{follower_data.get('username')} a commencé à vous suivre"
        }
    }
    await manager.send_personal_message(notification, followed_id)

async def notify_new_like(liker_id: str, post_author_id: str, post_id: str, liker_data: dict):
    """Notifier qu'un post a reçu un like"""
    notification = {
        "type": "new_like",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "liker_id": liker_id,
            "liker_username": liker_data.get("username"),
            "liker_avatar": liker_data.get("avatar_url"),
            "post_id": post_id,
            "message": f"@{liker_data.get('username')} a aimé votre post"
        }
    }
    await manager.send_personal_message(notification, post_author_id)

async def notify_new_comment(commenter_id: str, post_author_id: str, post_id: str, comment_id: str, commenter_data: dict, comment_text: str):
    """Notifier qu'un post a reçu un commentaire"""
    notification = {
        "type": "new_comment",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "commenter_id": commenter_id,
            "commenter_username": commenter_data.get("username"),
            "commenter_avatar": commenter_data.get("avatar_url"),
            "post_id": post_id,
            "comment_id": comment_id,
            "comment_preview": comment_text[:100],
            "message": f"@{commenter_data.get('username')} a commenté votre post"
        }
    }
    await manager.send_personal_message(notification, post_author_id)

async def notify_new_mention(mentioner_id: str, mentioned_id: str, post_id: str, mentioner_data: dict):
    """Notifier qu'un utilisateur a été mentionné"""
    notification = {
        "type": "mention",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "mentioner_id": mentioner_id,
            "mentioner_username": mentioner_data.get("username"),
            "mentioner_avatar": mentioner_data.get("avatar_url"),
            "post_id": post_id,
            "message": f"@{mentioner_data.get('username')} vous a mentionné"
        }
    }
    await manager.send_personal_message(notification, mentioned_id)

async def notify_new_message(sender_id: str, recipient_id: str, message_id: str, sender_data: dict, message_preview: str):
    """Notifier un nouveau message privé"""
    notification = {
        "type": "new_message",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "sender_id": sender_id,
            "sender_username": sender_data.get("username"),
            "sender_avatar": sender_data.get("avatar_url"),
            "message_id": message_id,
            "message_preview": message_preview[:100],
            "message": f"@{sender_data.get('username')} vous a envoyé un message"
        }
    }
    await manager.send_personal_message(notification, recipient_id)

async def notify_follow_request(follower_id: str, followed_id: str, follower_data: dict):
    """Notifier une demande de suivi (compte privé)"""
    notification = {
        "type": "follow_request",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "follower_id": follower_id,
            "follower_username": follower_data.get("username"),
            "follower_avatar": follower_data.get("avatar_url"),
            "message": f"@{follower_data.get('username')} veut vous suivre"
        }
    }
    await manager.send_personal_message(notification, followed_id)

async def notify_group_invitation(inviter_id: str, invited_id: str, group_id: str, inviter_data: dict, group_name: str):
    """Notifier une invitation à rejoindre un groupe"""
    notification = {
        "type": "group_invitation",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "inviter_id": inviter_id,
            "inviter_username": inviter_data.get("username"),
            "group_id": group_id,
            "group_name": group_name,
            "message": f"@{inviter_data.get('username')} vous a invité à rejoindre {group_name}"
        }
    }
    await manager.send_personal_message(notification, invited_id)

async def notify_group_new_post(group_id: str, post_id: str, author_data: dict, group_members: List[str]):
    """Notifier les membres d'un groupe d'un nouveau post"""
    notification = {
        "type": "group_new_post",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "group_id": group_id,
            "post_id": post_id,
            "author_username": author_data.get("username"),
            "message": f"@{author_data.get('username')} a publié dans le groupe"
        }
    }
    await manager.send_to_multiple(notification, group_members)

async def notify_story_view(viewer_id: str, story_author_id: str, story_id: str, viewer_data: dict):
    """Notifier qu'une story a été vue"""
    notification = {
        "type": "story_view",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "viewer_id": viewer_id,
            "viewer_username": viewer_data.get("username"),
            "viewer_avatar": viewer_data.get("avatar_url"),
            "story_id": story_id,
            "message": f"@{viewer_data.get('username')} a vu votre story"
        }
    }
    await manager.send_personal_message(notification, story_author_id)

async def broadcast_trending_hashtag(hashtag: str, post_count: int):
    """Broadcast une tendance à tous les utilisateurs"""
    notification = {
        "type": "trending",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "hashtag": hashtag,
            "post_count": post_count,
            "message": f"#{hashtag} est en tendance avec {post_count} posts"
        }
    }
    await manager.broadcast(notification)

# ==================== INTÉGRATION AVEC LES ENDPOINTS EXISTANTS ====================

"""
Dans server.py, intégrer les notifications dans les endpoints existants :

# Exemple : Endpoint de like
@app.post("/posts/{post_id}/like")
async def like_post(post_id: str, current_user: dict = Depends(get_current_user)):
    # ... logique de like ...
    
    # Envoyer notification WebSocket
    post = await db.posts.find_one({"id": post_id})
    if post and post["author_id"] != current_user["id"]:
        await notify_new_like(
            liker_id=current_user["id"],
            post_author_id=post["author_id"],
            post_id=post_id,
            liker_data={
                "username": current_user["username"],
                "avatar_url": current_user.get("avatar_url")
            }
        )
    
    return {"success": True}

# Exemple : Endpoint de commentaire
@app.post("/posts/{post_id}/comments")
async def create_comment(post_id: str, comment: dict, current_user: dict = Depends(get_current_user)):
    # ... logique de commentaire ...
    
    # Notifier l'auteur du post
    post = await db.posts.find_one({"id": post_id})
    if post and post["author_id"] != current_user["id"]:
        await notify_new_comment(
            commenter_id=current_user["id"],
            post_author_id=post["author_id"],
            post_id=post_id,
            comment_id=new_comment_id,
            commenter_data={
                "username": current_user["username"],
                "avatar_url": current_user.get("avatar_url")
            },
            comment_text=comment["text"]
        )
    
    return {"success": True, "comment_id": new_comment_id}
"""

# Export
# Dans server.py:
# from .websocket_notifications import websocket_router, manager
# app.include_router(websocket_router)
