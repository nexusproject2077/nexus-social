import asyncio
import schedule
import time
from datetime import datetime
from gdpr_compliance_api import auto_delete_scheduled_accounts, auto_delete_old_data

def schedule_gdpr_tasks():
    # Vérifier les suppressions tous les jours à 2h du matin
    schedule.every().day.at("02:00").do(lambda: asyncio.run(auto_delete_scheduled_accounts()))
    
    # Nettoyer les anciennes données tous les lundis à 3h
    schedule.every().monday.at("03:00").do(lambda: asyncio.run(auto_delete_old_data()))
    
    print("✅ Tâches RGPD programmées")

if __name__ == "__main__":
    schedule_gdpr_tasks()
    
    while True:
        schedule.run_pending()
        time.sleep(60)
