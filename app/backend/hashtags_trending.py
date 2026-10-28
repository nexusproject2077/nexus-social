# backend/hashtags_trending.py - Système de hashtags et tendances

from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import re
from collections import Counter
import uuid

hashtags_router = APIRouter(prefix="/api/hashtags", tags=["hashtags"])

# ==================== MODÈLES DE DONNÉES ====================

# Collection: hashtags
"""
{
    "id": "uuid",
    "tag": "python",  # Sans le #
    "normalized": "python",  # Minuscules pour recherche
    "post_count": 156,
    "total_likes": 4523,
    "total_views": 12456,
    "trending_score": 87.5,  # Calculé
    "posts_last_24h": 23,
    "posts_last_7d": 156,
    "created_at": "ISO datetime",
    "last_used": "ISO datetime"
}
"""

# Collection: post_hashtags
"""
{
    "id": "uuid",
    "post_id": "uuid",
    "hashtag": "python",
    "created_at": "ISO datetime"
}
"""

# Collection: trending_history
"""
{
    "id": "uuid",
    "date": "2025-01-10",
    "hour": 14,
    "hashtag": "python",
    "post_count": 23,
    "score": 87.5,
    "rank": 1
}
"""

# ==================== EXTRACTION DE HASHTAGS ====================

def extract_hashtags(text: str) -> List[str]:
    """
    Extraire tous les hashtags d'un texte
    Supporte: #Python #élection2025 #COVID19
    """
    # Pattern: # suivi de lettres, chiffres, underscores (pas d'espaces ni ponctuation)
    pattern = r'#(\w+)'
    hashtags = re.findall(pattern, text)
    
    # Normaliser (minuscules)
    normalized = [tag.lower() for tag in hashtags]
    
    # Dédupliquer tout en préservant l'ordre
    seen = set()
    unique = []
    for tag in normalized:
        if tag not in seen:
            seen.add(tag)
            unique.append(tag)
    
    return unique

# ==================== GESTION DES HASHTAGS ====================

async def process_post_hashtags(post_id: str, text: str):
    """
    Extraire et enregistrer les hashtags d'un post
    Appelé lors de la création/édition d'un post
    """
    try:
        hashtags = extract_hashtags(text)
        
        if not hashtags:
            return []
        
        now = datetime.now(timezone.utc).isoformat()
        
        for tag in hashtags:
            # 1. Créer/Mettre à jour le hashtag global
            existing = await db.hashtags.find_one({"normalized": tag})
            
            if existing:
                # Incrémenter le compteur
                await db.hashtags.update_one(
                    {"normalized": tag},
                    {
                        "$inc": {"post_count": 1},
                        "$set": {"last_used": now}
                    }
                )
            else:
                # Créer nouveau hashtag
                new_hashtag = {
                    "id": str(uuid.uuid4()),
                    "tag": tag,
                    "normalized": tag,
                    "post_count": 1,
                    "total_likes": 0,
                    "total_views": 0,
                    "trending_score": 0,
                    "posts_last_24h": 1,
                    "posts_last_7d": 1,
                    "created_at": now,
                    "last_used": now
                }
                await db.hashtags.insert_one(new_hashtag)
            
            # 2. Créer lien post <-> hashtag
            post_hashtag = {
                "id": str(uuid.uuid4()),
                "post_id": post_id,
                "hashtag": tag,
                "created_at": now
            }
            await db.post_hashtags.insert_one(post_hashtag)
        
        return hashtags
        
    except Exception as e:
        print(f"Error processing hashtags: {e}")
        return []

async def update_hashtag_stats(hashtag: str, likes_delta: int = 0, views_delta: int = 0):
    """
    Mettre à jour les stats d'un hashtag (likes, vues)
    Appelé lors d'un like ou vue d'un post avec ce hashtag
    """
    try:
        updates = {}
        if likes_delta != 0:
            updates["total_likes"] = likes_delta
        if views_delta != 0:
            updates["total_views"] = views_delta
        
        if updates:
            await db.hashtags.update_one(
                {"normalized": hashtag},
                {"$inc": updates}
            )
    except Exception as e:
        print(f"Error updating hashtag stats: {e}")

async def remove_post_hashtags(post_id: str):
    """
    Supprimer les hashtags d'un post (lors de la suppression du post)
    """
    try:
        # Récupérer les hashtags du post
        post_hashtags = await db.post_hashtags.find({"post_id": post_id}).to_list(length=100)
        
        for ph in post_hashtags:
            # Décrémenter le compteur
            await db.hashtags.update_one(
                {"normalized": ph["hashtag"]},
                {"$inc": {"post_count": -1}}
            )
        
        # Supprimer les liens
        await db.post_hashtags.delete_many({"post_id": post_id})
        
        # Nettoyer les hashtags sans posts
        await db.hashtags.delete_many({"post_count": {"$lte": 0}})
        
    except Exception as e:
        print(f"Error removing post hashtags: {e}")

# ==================== CALCUL DES TENDANCES ====================

async def calculate_trending_score(hashtag: str) -> float:
    """
    Calculer le score de tendance d'un hashtag
    Formule: (posts_24h * 3) + (posts_7d * 0.5) + (likes / 100) + (views / 1000)
    """
    try:
        tag_data = await db.hashtags.find_one({"normalized": hashtag})
        if not tag_data:
            return 0.0
        
        # Compter posts des dernières 24h
        now = datetime.now(timezone.utc)
        yesterday = now - timedelta(hours=24)
        
        posts_24h = await db.post_hashtags.count_documents({
            "hashtag": hashtag,
            "created_at": {"$gte": yesterday.isoformat()}
        })
        
        # Compter posts des 7 derniers jours
        week_ago = now - timedelta(days=7)
        posts_7d = await db.post_hashtags.count_documents({
            "hashtag": hashtag,
            "created_at": {"$gte": week_ago.isoformat()}
        })
        
        # Calculer le score
        score = (
            (posts_24h * 3.0) +
            (posts_7d * 0.5) +
            (tag_data.get("total_likes", 0) / 100.0) +
            (tag_data.get("total_views", 0) / 1000.0)
        )
        
        # Mettre à jour
        await db.hashtags.update_one(
            {"normalized": hashtag},
            {
                "$set": {
                    "trending_score": round(score, 2),
                    "posts_last_24h": posts_24h,
                    "posts_last_7d": posts_7d
                }
            }
        )
        
        return score
        
    except Exception as e:
        print(f"Error calculating trending score: {e}")
        return 0.0

async def update_trending_rankings():
    """
    Cron job à exécuter toutes les heures
    Met à jour les rankings de tendances
    """
    try:
        now = datetime.now(timezone.utc)
        
        # Récupérer tous les hashtags actifs (utilisés dans les 7 derniers jours)
        week_ago = now - timedelta(days=7)
        active_hashtags = await db.hashtags.find({
            "last_used": {"$gte": week_ago.isoformat()}
        }).to_list(length=1000)
        
        # Calculer les scores
        scores = []
        for tag in active_hashtags:
            score = await calculate_trending_score(tag["normalized"])
            scores.append((tag["normalized"], score))
        
        # Trier par score décroissant
        scores.sort(key=lambda x: x[1], reverse=True)
        
        # Sauvegarder l'historique (top 50)
        for rank, (hashtag, score) in enumerate(scores[:50], start=1):
            history_entry = {
                "id": str(uuid.uuid4()),
                "date": now.strftime("%Y-%m-%d"),
                "hour": now.hour,
                "hashtag": hashtag,
                "post_count": active_hashtags[[t["normalized"] for t in active_hashtags].index(hashtag)]["posts_last_24h"],
                "score": score,
                "rank": rank
            }
            await db.trending_history.insert_one(history_entry)
        
        print(f"✓ Trending updated: {len(scores)} hashtags processed")
        
    except Exception as e:
        print(f"Error updating trending: {e}")

# ==================== ENDPOINTS ====================

@hashtags_router.get("/trending")
async def get_trending_hashtags(
    limit: int = Query(20, ge=1, le=50),
    country: Optional[str] = None
):
    """
    Récupérer les hashtags tendance
    """
    try:
        # Récupérer les top hashtags par score
        trending = await db.hashtags.find().sort("trending_score", -1).limit(limit).to_list(length=limit)
        
        return {
            "success": True,
            "trending": [
                {
                    "hashtag": f"#{tag['tag']}",
                    "post_count": tag.get("post_count", 0),
                    "posts_24h": tag.get("posts_last_24h", 0),
                    "trending_score": tag.get("trending_score", 0)
                }
                for tag in trending
            ]
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@hashtags_router.get("/search")
async def search_hashtags(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=50)
):
    """
    Rechercher des hashtags
    """
    try:
        # Recherche avec regex (insensible à la casse)
        query = q.lower().replace("#", "")
        
        results = await db.hashtags.find({
            "normalized": {"$regex": f"^{query}", "$options": "i"}
        }).sort("post_count", -1).limit(limit).to_list(length=limit)
        
        return {
            "success": True,
            "hashtags": [
                {
                    "hashtag": f"#{tag['tag']}",
                    "post_count": tag.get("post_count", 0)
                }
                for tag in results
            ]
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@hashtags_router.get("/{hashtag}/posts")
async def get_posts_by_hashtag(
    hashtag: str,
    limit: int = Query(20, ge=1, le=50),
    skip: int = Query(0, ge=0)
):
    """
    Récupérer les posts d'un hashtag
    """
    try:
        # Normaliser
        tag = hashtag.lower().replace("#", "")
        
        # Récupérer les IDs des posts
        post_links = await db.post_hashtags.find(
            {"hashtag": tag}
        ).sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)
        
        post_ids = [link["post_id"] for link in post_links]
        
        # Récupérer les posts
        posts = await db.posts.find({"id": {"$in": post_ids}}).to_list(length=limit)
        
        # Trier par date
        posts.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        
        return {
            "success": True,
            "hashtag": f"#{tag}",
            "posts": posts
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@hashtags_router.get("/{hashtag}/stats")
async def get_hashtag_stats(hashtag: str):
    """
    Statistiques d'un hashtag
    """
    try:
        tag = hashtag.lower().replace("#", "")
        
        tag_data = await db.hashtags.find_one({"normalized": tag})
        
        if not tag_data:
            raise HTTPException(status_code=404, detail="Hashtag not found")
        
        return {
            "success": True,
            "hashtag": f"#{tag}",
            "stats": {
                "post_count": tag_data.get("post_count", 0),
                "posts_24h": tag_data.get("posts_last_24h", 0),
                "posts_7d": tag_data.get("posts_last_7d", 0),
                "total_likes": tag_data.get("total_likes", 0),
                "total_views": tag_data.get("total_views", 0),
                "trending_score": tag_data.get("trending_score", 0),
                "created_at": tag_data.get("created_at"),
                "last_used": tag_data.get("last_used")
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Export
# Dans server.py:
# from .hashtags_trending import hashtags_router
# app.include_router(hashtags_router)
