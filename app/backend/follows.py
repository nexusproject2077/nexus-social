"""
follows.py - Gestion complète du système de suivi (follow/unfollow)
Inclut : suivi, demandes d'abonnement, listes abonnés/abonnements
"""

from flask import Blueprint, request, jsonify, g
from functools import wraps
import psycopg2
from psycopg2.extras import RealDictCursor
from database import get_db_connection
import jwt
import os

follow_bp = Blueprint('follows', __name__)

# ==================== MIDDLEWARE AUTH ====================

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'error': 'Token manquant'}), 401
        
        try:
            if token.startswith('Bearer '):
                token = token[7:]
            
            data = jwt.decode(token, os.getenv('JWT_SECRET', 'your-secret-key'), algorithms=['HS256'])
            g.current_user_id = data['user_id']
        except:
            return jsonify({'error': 'Token invalide'}), 401
        
        return f(*args, **kwargs)
    
    return decorated


# ==================== HELPER FUNCTIONS ====================

def check_follow_status(follower_id, followed_id, conn):
    """
    Vérifie le statut d'abonnement entre deux utilisateurs
    Returns: 'following', 'pending', 'not_following'
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Vérifier dans follows (abonnements confirmés)
    cursor.execute("""
        SELECT * FROM follows 
        WHERE follower_id = %s AND followed_id = %s AND status = 'following'
    """, (follower_id, followed_id))
    
    if cursor.fetchone():
        return 'following'
    
    # Vérifier dans follow_requests (demandes en attente)
    cursor.execute("""
        SELECT * FROM follow_requests 
        WHERE follower_id = %s AND followed_id = %s AND status = 'pending'
    """, (follower_id, followed_id))
    
    if cursor.fetchone():
        return 'pending'
    
    return 'not_following'


def is_account_private(user_id, conn):
    """Vérifie si le compte est privé"""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("SELECT is_private FROM users WHERE id = %s", (user_id,))
    result = cursor.fetchone()
    return result['is_private'] if result else False


def can_view_profile(viewer_id, profile_id, conn):
    """
    Vérifie si viewer_id peut voir le profil/contenu de profile_id
    Returns: True si autorisé
    """
    # Propre profil
    if viewer_id == profile_id:
        return True
    
    # Compte public
    if not is_account_private(profile_id, conn):
        return True
    
    # Compte privé : vérifier si suit
    status = check_follow_status(viewer_id, profile_id, conn)
    return status == 'following'


# ==================== ENDPOINTS SUIVI ====================

@follow_bp.route('/users/<int:user_id>/follow', methods=['POST'])
@token_required
def follow_user(user_id):
    """
    Suivre un utilisateur (ou envoyer demande si privé)
    POST /api/users/{user_id}/follow
    """
    current_user_id = g.current_user_id
    
    if current_user_id == user_id:
        return jsonify({'error': 'Vous ne pouvez pas vous suivre vous-même'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Vérifier si l'utilisateur existe
        cursor.execute("SELECT id, username, is_private FROM users WHERE id = %s", (user_id,))
        target_user = cursor.fetchone()
        
        if not target_user:
            return jsonify({'error': 'Utilisateur introuvable'}), 404
        
        # Vérifier si déjà abonné ou demande en cours
        existing_status = check_follow_status(current_user_id, user_id, conn)
        
        if existing_status == 'following':
            return jsonify({'error': 'Vous suivez déjà cet utilisateur'}), 400
        
        if existing_status == 'pending':
            return jsonify({'error': 'Demande déjà en attente'}), 400
        
        # Si compte PRIVÉ : créer demande
        if target_user['is_private']:
            cursor.execute("""
                INSERT INTO follow_requests (follower_id, followed_id, status)
                VALUES (%s, %s, 'pending')
                ON CONFLICT (follower_id, followed_id) DO NOTHING
            """, (current_user_id, user_id))
            
            conn.commit()
            
            return jsonify({
                'status': 'pending',
                'message': 'Demande d\'abonnement envoyée'
            }), 201
        
        # Si compte PUBLIC : abonnement direct
        else:
            cursor.execute("""
                INSERT INTO follows (follower_id, followed_id, status)
                VALUES (%s, %s, 'following')
                ON CONFLICT (follower_id, followed_id) DO NOTHING
            """, (current_user_id, user_id))
            
            conn.commit()
            
            return jsonify({
                'status': 'following',
                'message': 'Vous suivez maintenant cet utilisateur'
            }), 201
    
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    
    finally:
        cursor.close()
        conn.close()


@follow_bp.route('/users/<int:user_id>/follow', methods=['DELETE'])
@token_required
def unfollow_user(user_id):
    """
    Se désabonner d'un utilisateur
    DELETE /api/users/{user_id}/follow
    """
    current_user_id = g.current_user_id
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Supprimer de follows
        cursor.execute("""
            DELETE FROM follows 
            WHERE follower_id = %s AND followed_id = %s
        """, (current_user_id, user_id))
        
        # Supprimer demande en attente si existe
        cursor.execute("""
            DELETE FROM follow_requests 
            WHERE follower_id = %s AND followed_id = %s
        """, (current_user_id, user_id))
        
        conn.commit()
        
        return jsonify({'message': 'Désabonnement réussi'}), 200
    
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    
    finally:
        cursor.close()
        conn.close()


@follow_bp.route('/users/<int:user_id>/follow-status', methods=['GET'])
@token_required
def get_follow_status(user_id):
    """
    Vérifier le statut d'abonnement
    GET /api/users/{user_id}/follow-status
    """
    current_user_id = g.current_user_id
    
    conn = get_db_connection()
    
    try:
        status = check_follow_status(current_user_id, user_id, conn)
        is_private = is_account_private(user_id, conn)
        
        return jsonify({
            'status': status,
            'is_private': is_private
        }), 200
    
    finally:
        conn.close()


# ==================== LISTES ABONNÉS/ABONNEMENTS ====================

@follow_bp.route('/users/<int:user_id>/followers', methods=['GET'])
@token_required
def get_followers(user_id):
    """
    Liste des abonnés d'un utilisateur
    GET /api/users/{user_id}/followers
    Accessible seulement si autorisé (compte public ou abonné)
    """
    current_user_id = g.current_user_id
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Vérifier autorisation
        if not can_view_profile(current_user_id, user_id, conn):
            return jsonify({'error': 'Compte privé - abonnement requis'}), 403
        
        # Récupérer les abonnés
        cursor.execute("""
            SELECT 
                u.id,
                u.username,
                u.profile_pic,
                EXISTS(
                    SELECT 1 FROM follows 
                    WHERE follower_id = %s AND followed_id = u.id
                ) as is_following_back
            FROM follows f
            JOIN users u ON f.follower_id = u.id
            WHERE f.followed_id = %s AND f.status = 'following'
            ORDER BY f.created_at DESC
        """, (current_user_id, user_id))
        
        followers = cursor.fetchall()
        
        return jsonify({
            'followers': followers,
            'count': len(followers)
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        cursor.close()
        conn.close()


@follow_bp.route('/users/<int:user_id>/following', methods=['GET'])
@token_required
def get_following(user_id):
    """
    Liste des abonnements d'un utilisateur
    GET /api/users/{user_id}/following
    Accessible seulement si autorisé
    """
    current_user_id = g.current_user_id
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Vérifier autorisation
        if not can_view_profile(current_user_id, user_id, conn):
            return jsonify({'error': 'Compte privé - abonnement requis'}), 403
        
        # Récupérer les abonnements
        cursor.execute("""
            SELECT 
                u.id,
                u.username,
                u.profile_pic,
                EXISTS(
                    SELECT 1 FROM follows 
                    WHERE follower_id = u.id AND followed_id = %s
                ) as follows_back
            FROM follows f
            JOIN users u ON f.followed_id = u.id
            WHERE f.follower_id = %s AND f.status = 'following'
            ORDER BY f.created_at DESC
        """, (current_user_id, user_id))
        
        following = cursor.fetchall()
        
        return jsonify({
            'following': following,
            'count': len(following)
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        cursor.close()
        conn.close()


# ==================== DEMANDES D'ABONNEMENT ====================

@follow_bp.route('/follow-requests', methods=['GET'])
@token_required
def get_follow_requests():
    """
    Liste des demandes d'abonnement reçues
    GET /api/follow-requests
    """
    current_user_id = g.current_user_id
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        cursor.execute("""
            SELECT 
                fr.id,
                fr.created_at,
                json_build_object(
                    'id', u.id,
                    'username', u.username,
                    'profile_pic', u.profile_pic
                ) as user
            FROM follow_requests fr
            JOIN users u ON fr.follower_id = u.id
            WHERE fr.followed_id = %s AND fr.status = 'pending'
            ORDER BY fr.created_at DESC
        """, (current_user_id,))
        
        requests = cursor.fetchall()
        
        return jsonify({
            'requests': requests,
            'count': len(requests)
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        cursor.close()
        conn.close()


@follow_bp.route('/follow-requests/<int:request_id>/accept', methods=['POST'])
@token_required
def accept_follow_request(request_id):
    """
    Accepter une demande d'abonnement
    POST /api/follow-requests/{request_id}/accept
    """
    current_user_id = g.current_user_id
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Vérifier que la demande existe et appartient à l'utilisateur
        cursor.execute("""
            SELECT follower_id, followed_id 
            FROM follow_requests 
            WHERE id = %s AND followed_id = %s AND status = 'pending'
        """, (request_id, current_user_id))
        
        request_data = cursor.fetchone()
        
        if not request_data:
            return jsonify({'error': 'Demande introuvable'}), 404
        
        # Créer l'abonnement
        cursor.execute("""
            INSERT INTO follows (follower_id, followed_id, status)
            VALUES (%s, %s, 'following')
            ON CONFLICT (follower_id, followed_id) DO NOTHING
        """, (request_data['follower_id'], request_data['followed_id']))
        
        # Supprimer la demande
        cursor.execute("""
            DELETE FROM follow_requests WHERE id = %s
        """, (request_id,))
        
        conn.commit()
        
        return jsonify({'message': 'Demande acceptée'}), 200
    
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    
    finally:
        cursor.close()
        conn.close()


@follow_bp.route('/follow-requests/<int:request_id>/reject', methods=['POST'])
@token_required
def reject_follow_request(request_id):
    """
    Refuser une demande d'abonnement
    POST /api/follow-requests/{request_id}/reject
    """
    current_user_id = g.current_user_id
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Vérifier et supprimer la demande
        cursor.execute("""
            DELETE FROM follow_requests 
            WHERE id = %s AND followed_id = %s AND status = 'pending'
        """, (request_id, current_user_id))
        
        if cursor.rowcount == 0:
            return jsonify({'error': 'Demande introuvable'}), 404
        
        conn.commit()
        
        return jsonify({'message': 'Demande refusée'}), 200
    
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    
    finally:
        cursor.close()
        conn.close()


# ==================== STATISTIQUES ====================

@follow_bp.route('/users/<int:user_id>/stats', methods=['GET'])
@token_required
def get_user_stats(user_id):
    """
    Statistiques publiques d'un utilisateur
    GET /api/users/{user_id}/stats
    """
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Nombre d'abonnés
        cursor.execute("""
            SELECT COUNT(*) as count 
            FROM follows 
            WHERE followed_id = %s AND status = 'following'
        """, (user_id,))
        followers_count = cursor.fetchone()['count']
        
        # Nombre d'abonnements
        cursor.execute("""
            SELECT COUNT(*) as count 
            FROM follows 
            WHERE follower_id = %s AND status = 'following'
        """, (user_id,))
        following_count = cursor.fetchone()['count']
        
        # Nombre de posts
        cursor.execute("""
            SELECT COUNT(*) as count 
            FROM posts 
            WHERE user_id = %s AND deleted_at IS NULL
        """, (user_id,))
        posts_count = cursor.fetchone()['count']
        
        return jsonify({
            'followers': followers_count,
            'following': following_count,
            'posts': posts_count
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        cursor.close()
        conn.close()
