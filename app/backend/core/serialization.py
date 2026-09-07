"""Sérialisation des documents MongoDB → dict JSON-safe (ObjectId → str).

Utilitaire transverse : partagé par l'auth (core.security) et par la quasi-
totalité des routes. Récursif ; ne dépend que de bson.
"""
from bson import ObjectId


def convert_mongo_doc_to_dict(doc: dict) -> dict:
    """Convertit un document MongoDB en dict Python (ObjectId → str).

    Si le document a déjà un champ 'id' (UUID), on le garde et on retire
    seulement '_id' pour éviter les conflits.
    """
    if doc is None:
        return None
    new_doc = doc.copy()

    if "_id" in new_doc:
        if "id" not in new_doc:
            new_doc["id"] = str(new_doc["_id"])
        del new_doc["_id"]

    for key, value in new_doc.items():
        if isinstance(value, ObjectId):
            new_doc[key] = str(value)
        elif isinstance(value, dict):
            new_doc[key] = convert_mongo_doc_to_dict(value)
        elif isinstance(value, list):
            new_doc[key] = [
                convert_mongo_doc_to_dict(item) if isinstance(item, dict)
                else (str(item) if isinstance(item, ObjectId) else item)
                for item in value
            ]
    return new_doc
