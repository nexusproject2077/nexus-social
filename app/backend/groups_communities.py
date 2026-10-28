# backend/groups_communities.py - Système de groupes et communautés

from fastapi import APIRouter, Depends, HTTPException, Body, UploadFile, File
from datetime import datetime, timezone
from typing import List, Optional
import uuid

groups_router = APIRouter(prefix="/api/groups", tags=["groups"])

# ==================== MODÈLES DE DONNÉES ====================

# Collection: groups
"""
{
    "id": "uuid",
    "name": "Développeurs Python",
    "slug": "developpeurs-python",
    "description": "Communauté de devs Python",
    "avatar_url": "https://...",
    "cover_url": "https://...",
    "creator_id": "uuid",
    "category": "tech",  # tech, gaming, art, fitness, music, education, etc.
    "visibility": "public",  # public, private, secret
    "join_mode": "open",  # open, approval, invite_only
    "member_count": 156,
    "post_count": 423,
    "rules": [
        "Soyez respectueux",
        "Pas de spam",
        "Restez dans le sujet"
    ],
    "tags": ["python", "programming", "dev"],
    "settings": {
        "allow_posts": "members",  # members, admins
        "allow_comments": true,
        "require_post_approval": false,
        "allow_invites": true
    },
    "created_at": "ISO datetime",
    "updated_at": "ISO datetime"
}
"""

# Collection: group_members
"""
{
    "id": "uuid",
    "group_id": "uuid",
    "user_id": "uuid",
    "role": "member",  # member, moderator, admin, creator
    "status": "active",  # active, banned, left
    "permissions": {
        "can_post": true,
        "can_comment": true,
        "can_invite": true,
        "can_moderate": false
    },
    "joined_at": "ISO datetime",
    "last_active": "ISO datetime"
}
"""

# Collection: group_posts
"""
{
    "id": "uuid",
    "group_id": "uuid",
    "post_id": "uuid",
    "author_id": "uuid",
    "status": "published",  # published, pending, removed
    "pinned": false,
    "created_at": "ISO datetime"
}
"""

# Collection: group_invitations
"""
{
    "id": "uuid",
    "group_id": "uuid",
    "inviter_id": "uuid",
    "invited_id": "uuid",
    "status": "pending",  # pending, accepted, declined, expired
    "created_at": "ISO datetime",
    "expires_at": "ISO datetime"
}
"""

# Collection: group_join_requests
"""
{
    "id": "uuid",
    "group_id": "uuid",
    "user_id": "uuid",
    "status": "pending",  # pending, approved, rejected
    "message": "Je souhaite rejoindre ce groupe car...",
    "created_at": "ISO datetime"
}
"""

# ==================== CRÉATION ET GESTION ====================

@groups_router.post("")
async def create_group(
    group_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Créer un nouveau groupe"""
    try:
        now = datetime.now(timezone.utc).isoformat()
        
        # Générer slug
        slug = group_data["name"].lower().replace(" ", "-")
        slug = re.sub(r'[^a-z0-9-]', '', slug)
        
        # Vérifier unicité du slug
        existing = await db.groups.find_one({"slug": slug})
        if existing:
            slug = f"{slug}-{str(uuid.uuid4())[:8]}"
        
        group = {
            "id": str(uuid.uuid4()),
            "name": group_data["name"],
            "slug": slug,
            "description": group_data.get("description", ""),
            "avatar_url": group_data.get("avatar_url"),
            "cover_url": group_data.get("cover_url"),
            "creator_id": current_user["id"],
            "category": group_data.get("category", "general"),
            "visibility": group_data.get("visibility", "public"),
            "join_mode": group_data.get("join_mode", "open"),
            "member_count": 1,
            "post_count": 0,
            "rules": group_data.get("rules", []),
            "tags": group_data.get("tags", []),
            "settings": {
                "allow_posts": "members",
                "allow_comments": True,
                "require_post_approval": False,
                "allow_invites": True
            },
            "created_at": now,
            "updated_at": now
        }
        
        await db.groups.insert_one(group)
        
        # Ajouter le créateur comme admin
        member = {
            "id": str(uuid.uuid4()),
            "group_id": group["id"],
            "user_id": current_user["id"],
            "role": "creator",
            "status": "active",
            "permissions": {
                "can_post": True,
                "can_comment": True,
                "can_invite": True,
                "can_moderate": True
            },
            "joined_at": now,
            "last_active": now
        }
        
        await db.group_members.insert_one(member)
        
        return {
            "success": True,
            "group": group
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@groups_router.get("")
async def list_groups(
    category: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 20,
    skip: int = 0
):
    """Lister les groupes"""
    try:
        query = {"visibility": "public"}
        
        if category:
            query["category"] = category
        
        if search:
            query["$or"] = [
                {"name": {"$regex": search, "$options": "i"}},
                {"description": {"$regex": search, "$options": "i"}},
                {"tags": {"$regex": search, "$options": "i"}}
            ]
        
        groups = await db.groups.find(query).sort("member_count", -1).skip(skip).limit(limit).to_list(length=limit)
        
        return {
            "success": True,
            "groups": groups
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@groups_router.get("/{group_id}")
async def get_group(group_id: str):
    """Détails d'un groupe"""
    try:
        group = await db.groups.find_one({"id": group_id})
        
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        return {
            "success": True,
            "group": group
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@groups_router.put("/{group_id}")
async def update_group(
    group_id: str,
    updates: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Mettre à jour un groupe (admin/créateur only)"""
    try:
        # Vérifier permissions
        member = await db.group_members.find_one({
            "group_id": group_id,
            "user_id": current_user["id"],
            "role": {"$in": ["creator", "admin"]}
        })
        
        if not member:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        # Mettre à jour
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        await db.groups.update_one(
            {"id": group_id},
            {"$set": updates}
        )
        
        return {"success": True, "message": "Group updated"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== MEMBRES ====================

@groups_router.post("/{group_id}/join")
async def join_group(
    group_id: str,
    message: Optional[str] = Body(None),
    current_user: dict = Depends(get_current_user)
):
    """Rejoindre un groupe"""
    try:
        group = await db.groups.find_one({"id": group_id})
        
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        # Vérifier si déjà membre
        existing = await db.group_members.find_one({
            "group_id": group_id,
            "user_id": current_user["id"]
        })
        
        if existing:
            raise HTTPException(status_code=400, detail="Already a member")
        
        now = datetime.now(timezone.utc).isoformat()
        
        # Mode de join
        if group["join_mode"] == "open":
            # Rejoindre directement
            member = {
                "id": str(uuid.uuid4()),
                "group_id": group_id,
                "user_id": current_user["id"],
                "role": "member",
                "status": "active",
                "permissions": {
                    "can_post": True,
                    "can_comment": True,
                    "can_invite": group["settings"]["allow_invites"],
                    "can_moderate": False
                },
                "joined_at": now,
                "last_active": now
            }
            
            await db.group_members.insert_one(member)
            
            # Incrémenter compteur
            await db.groups.update_one(
                {"id": group_id},
                {"$inc": {"member_count": 1}}
            )
            
            return {"success": True, "message": "Joined group", "status": "active"}
            
        elif group["join_mode"] == "approval":
            # Créer demande
            request = {
                "id": str(uuid.uuid4()),
                "group_id": group_id,
                "user_id": current_user["id"],
                "status": "pending",
                "message": message or "",
                "created_at": now
            }
            
            await db.group_join_requests.insert_one(request)
            
            return {"success": True, "message": "Join request sent", "status": "pending"}
            
        else:  # invite_only
            raise HTTPException(status_code=403, detail="Group is invite-only")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@groups_router.post("/{group_id}/leave")
async def leave_group(
    group_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Quitter un groupe"""
    try:
        member = await db.group_members.find_one({
            "group_id": group_id,
            "user_id": current_user["id"]
        })
        
        if not member:
            raise HTTPException(status_code=404, detail="Not a member")
        
        if member["role"] == "creator":
            raise HTTPException(status_code=400, detail="Creator cannot leave. Transfer ownership first.")
        
        # Marquer comme left
        await db.group_members.update_one(
            {"id": member["id"]},
            {"$set": {"status": "left"}}
        )
        
        # Décrémenter compteur
        await db.groups.update_one(
            {"id": group_id},
            {"$inc": {"member_count": -1}}
        )
        
        return {"success": True, "message": "Left group"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@groups_router.get("/{group_id}/members")
async def get_group_members(
    group_id: str,
    role: Optional[str] = None,
    limit: int = 50,
    skip: int = 0
):
    """Lister les membres d'un groupe"""
    try:
        query = {"group_id": group_id, "status": "active"}
        
        if role:
            query["role"] = role
        
        members = await db.group_members.find(query).skip(skip).limit(limit).to_list(length=limit)
        
        # Récupérer infos utilisateurs
        user_ids = [m["user_id"] for m in members]
        users = await db.users.find({"id": {"$in": user_ids}}).to_list(length=len(user_ids))
        users_dict = {u["id"]: u for u in users}
        
        # Enrichir
        for member in members:
            member["user"] = users_dict.get(member["user_id"], {})
        
        return {
            "success": True,
            "members": members
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== POSTS ====================

@groups_router.post("/{group_id}/posts")
async def create_group_post(
    group_id: str,
    post_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Créer un post dans un groupe"""
    try:
        # Vérifier membership
        member = await db.group_members.find_one({
            "group_id": group_id,
            "user_id": current_user["id"],
            "status": "active"
        })
        
        if not member or not member["permissions"]["can_post"]:
            raise HTTPException(status_code=403, detail="Not authorized to post")
        
        group = await db.groups.find_one({"id": group_id})
        
        # Créer le post normal
        now = datetime.now(timezone.utc).isoformat()
        post_id = str(uuid.uuid4())
        
        post = {
            "id": post_id,
            "author_id": current_user["id"],
            "content": post_data["content"],
            "media_urls": post_data.get("media_urls", []),
            "group_id": group_id,  # Marquer comme post de groupe
            "created_at": now,
            "updated_at": now
        }
        
        await db.posts.insert_one(post)
        
        # Lier au groupe
        status = "pending" if group["settings"]["require_post_approval"] else "published"
        
        group_post = {
            "id": str(uuid.uuid4()),
            "group_id": group_id,
            "post_id": post_id,
            "author_id": current_user["id"],
            "status": status,
            "pinned": False,
            "created_at": now
        }
        
        await db.group_posts.insert_one(group_post)
        
        # Incrémenter compteur si publié
        if status == "published":
            await db.groups.update_one(
                {"id": group_id},
                {"$inc": {"post_count": 1}}
            )
        
        return {
            "success": True,
            "post": post,
            "status": status
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@groups_router.get("/{group_id}/posts")
async def get_group_posts(
    group_id: str,
    limit: int = 20,
    skip: int = 0
):
    """Récupérer les posts d'un groupe"""
    try:
        # Récupérer les group_posts
        group_posts = await db.group_posts.find({
            "group_id": group_id,
            "status": "published"
        }).sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)
        
        post_ids = [gp["post_id"] for gp in group_posts]
        
        # Récupérer les posts
        posts = await db.posts.find({"id": {"$in": post_ids}}).to_list(length=len(post_ids))
        
        return {
            "success": True,
            "posts": posts
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Export
# Dans server.py:
# from .groups_communities import groups_router
# app.include_router(groups_router)
