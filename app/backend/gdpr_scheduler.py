# app/backend/gdpr_scheduler.py - Tâches automatiques RGPD

import asyncio
import schedule
import time
from datetime import datetime, timedelta, timezone
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv

# Charger les variables d'environnement
load_dotenv()

# Configuration MongoDB
MONGODB_URL = os.environ.get('MONGODB_URI') or os.environ.get('MONGO_URL') or os.environ.get('DATABASE_URL')
DATABASE_NAME = os.environ.get('DB_NAME', 'nexus_social')

# Client MongoDB
client = AsyncIOMotorClient(MONGODB_URL)
db = client[DATABASE_NAME]

# Collections
users_collection = db["users"]
posts_collection = db["posts"]
comments_collection = db["comments"]
likes_collection = db["likes"]
follows_collection = db["follows"]
messages_collection = db["messages"]
consent_logs_collection = db["consent_logs"]
deletion_requests_collection = db["deletion_requests"]
privacy_settings_collection = db["privacy_settings"]

# ==================== TÂCHES AUTOMATIQUES ====================

async def auto_delete_scheduled_accounts():
    """Supprime automatiquement les comptes dont le délai de 30 jours est expiré"""
    
    print(f"\n[{datetime.now()}] 🗑️ Vérification des comptes à supprimer...")
    
    try:
        now = datetime.now(timezone.utc).isoformat()
        
        # Trouver les demandes de suppression expirées
        expired_requests = await deletion_requests_collection.find({
            "status": "pending",
            "scheduled_deletion_at": {"$lte": now}
        }).to_list(length=None)
        
        deleted_count = 0
        
        for request in expired_requests:
            user_id = request["user_id"]
            
            try:
                # Marquer comme en cours
                await deletion_requests_collection.update_one(
                    {"id": request["id"]},
                    {"$set": {"status": "processing"}}
                )
                
                print(f"   🔄 Suppression du compte {user_id}...")
                
                # Supprimer toutes les données utilisateur
                await posts_collection.delete_many({"author_id": user_id})
                await comments_collection.delete_many({"author_id": user_id})
                await likes_collection.delete_many({"user_id": user_id})
                await follows_collection.delete_many({"$or": [{"follower_id": user_id}, {"following_id": user_id}]})
                
                if "messages" in await db.list_collection_names():
                    await messages_collection.delete_many({"$or": [{"sender_id": user_id}, {"recipient_id": user_id}]})
                
                # Anonymiser les logs (garder pour conformité légale)
                await consent_logs_collection.update_many(
                    {"user_id": user_id},
                    {"$set": {"user_id": "DELETED_USER", "anonymized": True}}
                )
                
                # Supprimer l'utilisateur
                await users_collection.delete_one({"id": user_id})
                
                # Marquer la demande comme complétée
                await deletion_requests_collection.update_one(
                    {"id": request["id"]},
                    {"$set": {"status": "completed", "completed_at": datetime.now(timezone.utc).isoformat()}}
                )
                
                deleted_count += 1
                print(f"   ✅ Compte {user_id} supprimé avec succès")
                
            except Exception as e:
                print(f"   ❌ Erreur suppression compte {user_id}: {str(e)}")
                await deletion_requests_collection.update_one(
                    {"id": request["id"]},
                    {"$set": {"status": "failed", "error": str(e)}}
                )
        
        if deleted_count > 0:
            print(f"✅ {deleted_count} compte(s) supprimé(s) automatiquement (RGPD)")
        else:
            print(f"✅ Aucun compte à supprimer")
        
        return deleted_count
        
    except Exception as e:
        print(f"❌ Erreur suppression automatique: {str(e)}")
        return 0

async def auto_delete_old_data():
    """Supprime automatiquement les anciennes données selon les paramètres utilisateur"""
    
    print(f"\n[{datetime.now()}] 🧹 Nettoyage des anciennes données...")
    
    try:
        # Trouver les utilisateurs avec paramètres de rétention
        settings = await privacy_settings_collection.find({
            "data_retention_days": {"$exists": True, "$ne": None}
        }).to_list(length=None)
        
        if not settings:
            print(f"✅ Aucun paramètre de rétention configuré")
            return 0
        
        total_deleted = 0
        
        for setting in settings:
            try:
                retention_days = setting["data_retention_days"]
                cutoff_date = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
                user_id = setting["user_id"]
                
                # Supprimer les anciennes publications
                posts_result = await posts_collection.delete_many({
                    "author_id": user_id,
                    "created_at": {"$lt": cutoff_date}
                })
                
                # Supprimer les anciens commentaires
                comments_result = await comments_collection.delete_many({
                    "author_id": user_id,
                    "created_at": {"$lt": cutoff_date}
                })
                
                deleted = posts_result.deleted_count + comments_result.deleted_count
                total_deleted += deleted
                
                if deleted > 0:
                    print(f"   🗑️ User {user_id}: {deleted} élément(s) supprimé(s) (> {retention_days} jours)")
                
            except Exception as e:
                print(f"   ❌ Erreur nettoyage user {setting.get('user_id')}: {str(e)}")
        
        print(f"✅ {total_deleted} ancien(s) élément(s) supprimé(s) au total")
        return total_deleted
        
    except Exception as e:
        print(f"❌ Erreur nettoyage données anciennes: {str(e)}")
        return 0

async def clean_expired_stories():
    """Supprime les stories expirées (bonus)"""
    
    print(f"\n[{datetime.now()}] 📸 Nettoyage des stories expirées...")
    
    try:
        if "stories" not in await db.list_collection_names():
            print(f"✅ Pas de collection stories")
            return 0
        
        now = datetime.now(timezone.utc).isoformat()
        
        # Supprimer les stories expirées
        result = await db.stories.delete_many({
            "expires_at": {"$lt": now}
        })
        
        if result.deleted_count > 0:
            print(f"✅ {result.deleted_count} story/stories expirée(s) supprimée(s)")
        else:
            print(f"✅ Aucune story expirée")
        
        return result.deleted_count
        
    except Exception as e:
        print(f"❌ Erreur nettoyage stories: {str(e)}")
        return 0

async def clean_old_consent_logs():
    """Nettoie les logs de consentement de plus de 3 ans (conformité légale)"""
    
    print(f"\n[{datetime.now()}] 📋 Nettoyage des anciens logs de consentement...")
    
    try:
        three_years_ago = (datetime.now(timezone.utc) - timedelta(days=3*365)).isoformat()
        
        result = await consent_logs_collection.delete_many({
            "timestamp": {"$lt": three_years_ago}
        })
        
        if result.deleted_count > 0:
            print(f"✅ {result.deleted_count} ancien(s) log(s) supprimé(s) (> 3 ans)")
        else:
            print(f"✅ Aucun ancien log à supprimer")
        
        return result.deleted_count
        
    except Exception as e:
        print(f"❌ Erreur nettoyage logs: {str(e)}")
        return 0

# ==================== SCHEDULER ====================

def schedule_gdpr_tasks():
    """Configure le planning des tâches RGPD"""
    
    print("\n" + "="*60)
    print("🤖 GDPR SCHEDULER - Système de tâches automatiques RGPD")
    print("="*60)
    print(f"📅 Démarrage : {datetime.now()}")
    print(f"🗄️  Database : {DATABASE_NAME}")
    print("="*60)
    
    # Tous les jours à 2h du matin : suppression des comptes
    schedule.every().day.at("02:00").do(
        lambda: asyncio.run(auto_delete_scheduled_accounts())
    )
    print("⏰ Suppression comptes programmée : Tous les jours à 2h00")
    
    # Tous les lundis à 3h du matin : nettoyage anciennes données
    schedule.every().monday.at("03:00").do(
        lambda: asyncio.run(auto_delete_old_data())
    )
    print("⏰ Nettoyage données programmé : Tous les lundis à 3h00")
    
    # Toutes les 6 heures : nettoyage stories expirées
    schedule.every(6).hours.do(
        lambda: asyncio.run(clean_expired_stories())
    )
    print("⏰ Nettoyage stories programmé : Toutes les 6h")
    
    # Tous les premiers du mois à 4h : nettoyage logs anciens
    schedule.every().day.at("04:00").do(
        lambda: asyncio.run(clean_old_consent_logs())
    )
    print("⏰ Nettoyage logs programmé : Tous les jours à 4h00")
    
    print("="*60)
    print("✅ Scheduler configuré avec succès !")
    print("="*60 + "\n")

async def run_initial_checks():
    """Exécute les tâches une fois au démarrage"""
    print("\n🚀 Exécution des tâches initiales...\n")
    
    await auto_delete_scheduled_accounts()
    await clean_expired_stories()
    
    print("\n✅ Tâches initiales terminées\n")

# ==================== MAIN ====================

if __name__ == "__main__":
    try:
        # Configuration du scheduler
        schedule_gdpr_tasks()
        
        # Exécution immédiate au démarrage
        asyncio.run(run_initial_checks())
        
        # Boucle principale
        print("⏰ Scheduler actif, en attente des prochaines tâches...\n")
        print("💡 Conseil : Laissez ce processus tourner en arrière-plan")
        print("   (utilisez 'screen' ou 'tmux' ou déployez sur Render Cron Job)\n")
        
        while True:
            schedule.run_pending()
            time.sleep(60)  # Vérifier chaque minute
            
    except KeyboardInterrupt:
        print("\n\n👋 Arrêt du scheduler RGPD...")
        print("✅ Scheduler arrêté proprement")
    except Exception as e:
        print(f"\n❌ Erreur fatale: {str(e)}")
        raise
