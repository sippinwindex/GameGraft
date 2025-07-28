# src/api/steam.py - ENHANCED with SSE broadcasting and Steam + Live Voting integration

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from api.models import db, User, SteamGame, GameSession, GamingGroup
from api.steam_service import steam_service
from api.utils import APIException, utc_now
from sqlalchemy import text

steam = Blueprint('steam', __name__)

def get_limiter():
    """Get the limiter instance from the main app"""
    return getattr(current_app, 'limiter', None)

def get_live_voting_manager():
    """Get the live voting manager for SSE broadcasting"""
    try:
        from .live_voting_system import live_voting_manager
        return live_voting_manager
    except ImportError:
        current_app.logger.warning("Live voting manager not available for Steam SSE broadcasting")
        return None

# ============================================================================
# 🔧 ENHANCED STEAM SYNC WITH SSE BROADCASTING
# ============================================================================

@steam.route('/sync-games', methods=['POST'])
@jwt_required()
def sync_games():
    """🔧 ENHANCED: Sync user's Steam library with SSE broadcasting to active voting sessions"""
    limiter = get_limiter()
    if limiter:
        # Rate limit sync to prevent spam - 2 syncs per minute
        limiter.limit("5 per minute")(lambda: None)()
    
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        current_app.logger.info(f"Starting manual sync for user {user.username}")
        
        # Check sync permissions using User model helper methods
        can_sync, message = user.can_sync_steam()
        
        if not can_sync:
            if "not connected" in message:
                return jsonify({
                    'error': 'Steam not connected',
                    'message': message
                }), 400
            else:
                # Rate limiting message with exact countdown
                cooldown_remaining = user.steam_sync_cooldown_remaining()
                return jsonify({
                    'success': False,
                    'error': 'Recently synced',
                    'message': message,
                    'retry_after': cooldown_remaining,
                    'last_synced': user.steam_library_synced_at.isoformat() if user.steam_library_synced_at else None
                }), 429
        
        # 🔧 NEW: Find active sessions for user's groups BEFORE sync
        live_voting_manager = get_live_voting_manager()
        active_sessions = []
        
        if live_voting_manager:
            try:
                active_sessions = db.session.query(GameSession).join(GamingGroup).filter(
                    GamingGroup.members.any(id=user_id),
                    GameSession.status.in_(['planning', 'voting'])
                ).all()
                
                current_app.logger.info(f"Found {len(active_sessions)} active sessions for user {user.username}")
            except Exception as e:
                current_app.logger.warning(f"Could not find active sessions: {e}")
        
        # Use steam_service to sync
        try:
            new_games, updated_games = steam_service.sync_user_library(user_id)
            
            # Update sync timestamp using User model method
            user.update_steam_sync_time()
            
            # Update user's total games count
            user.total_games = len(user.owned_games)
            
            # Commit the changes
            db.session.commit()
            
            current_app.logger.info(f"Steam sync completed for {user.username}: {new_games} new, {updated_games} updated")
            
            # 🔧 NEW: Broadcast sync update to active voting sessions via SSE
            if live_voting_manager and active_sessions:
                sync_data = {
                    'user_id': user_id,
                    'username': user.username,
                    'total_games': len(user.owned_games),
                    'sync_time': user.steam_library_synced_at.isoformat() if user.steam_library_synced_at else None,
                    'steam_username': user.steam_username,
                    'new_games': new_games,
                    'updated_games': updated_games
                }
                
                for session in active_sessions:
                    try:
                        live_voting_manager.broadcast_steam_sync_update(session.id, sync_data)
                        current_app.logger.info(f"Broadcasted Steam sync to session {session.id}")
                    except Exception as e:
                        current_app.logger.warning(f"Failed to broadcast to session {session.id}: {e}")
            
            return jsonify({
                'success': True,
                'message': f'Library synced successfully! Added {new_games} new games, updated {updated_games} games.',
                'new_games': new_games,
                'updated_games': updated_games,
                'total_games': len(user.owned_games),
                'sync_time': user.steam_library_synced_at.isoformat() if user.steam_library_synced_at else None,
                'active_sessions_notified': len(active_sessions) if active_sessions else 0
            }), 200
            
        except Exception as sync_error:
            db.session.rollback()
            current_app.logger.error(f"Steam service sync failed for {user.username}: {str(sync_error)}")
            return jsonify({
                'success': False,
                'error': 'Sync failed',
                'message': 'Failed to sync Steam library. Please try again later.'
            }), 500
        
    except APIException as e:
        current_app.logger.error(f"API Exception in sync_games: {e.message}")
        return jsonify({'success': False, 'error': e.message}), e.status_code
    except Exception as e:
        current_app.logger.error(f"Error in sync_games: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'message': 'Failed to sync Steam library. Please try again later.'
        }), 500

# ============================================================================
# EXISTING ENDPOINTS (unchanged but with potential for future SSE integration)
# ============================================================================

@steam.route('/owned-games', methods=['GET'])
@jwt_required()
def get_owned_games():
    """Get user's owned Steam games with enhanced error handling"""
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
            
        if not user.steam_id:
            return jsonify({
                'error': 'Steam not connected',
                'message': 'Please connect your Steam account first to view your games',
                'games': [],
                'total': 0
            }), 400
        
        current_app.logger.info(f"Loading games for user {user.username}")
        
        # Get games using raw SQL for reliability
        result = db.session.execute(
            text("""
                SELECT sg.*, ug.hours_played, ug.last_played, ug.added_at
                FROM steam_game sg
                JOIN user_games ug ON sg.id = ug.game_id
                WHERE ug.user_id = :user_id
                ORDER BY sg.name
            """),
            {'user_id': user_id}
        )
        
        games = []
        for row in result:
            game_data = {
                'id': row.id,
                'steam_appid': row.steam_appid,
                'name': row.name,
                'short_description': row.short_description,
                'header_image': row.header_image,
                'website': row.website,
                'genres': row.genres,
                'categories': row.categories,
                'multiplayer': row.multiplayer,
                'co_op': row.co_op,
                'max_players': row.max_players,
                'min_players': row.min_players,
                'price': row.price,
                'release_date': row.release_date.isoformat() if row.release_date else None,
                'hours_played': row.hours_played or 0,
                'playtime_forever': row.hours_played or 0,  # Steam API compatibility
                'last_played': row.last_played.isoformat() if row.last_played else None,
                'added_at': row.added_at.isoformat() if row.added_at else None
            }
            
            # Parse JSON fields safely
            try:
                import json
                game_data['genres'] = json.loads(row.genres) if row.genres else []
                game_data['categories'] = json.loads(row.categories) if row.categories else []
            except (json.JSONDecodeError, TypeError):
                game_data['genres'] = []
                game_data['categories'] = []
            
            games.append(game_data)
        
        current_app.logger.info(f"Loaded {len(games)} games for user {user.username}")
        
        return jsonify({
            'success': True,
            'games': games,
            'total': len(games),
            'steam_connected': user.is_steam_connected,
            'steam_username': user.steam_username,
            'last_synced': user.steam_library_synced_at.isoformat() if user.steam_library_synced_at else None
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error in get_owned_games: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'message': 'Failed to load game library. Please try again later.'
        }), 500

@steam.route('/sync-status', methods=['GET'])
@jwt_required()
def get_sync_status():
    """Get user's Steam sync status using User model helper methods"""
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Use User model helper method
        status = user.get_steam_sync_status()
        
        # 🔧 NEW: Add active sessions info for context
        live_voting_manager = get_live_voting_manager()
        active_sessions_count = 0
        
        if live_voting_manager:
            try:
                active_sessions = db.session.query(GameSession).join(GamingGroup).filter(
                    GamingGroup.members.any(id=user_id),
                    GameSession.status.in_(['planning', 'voting'])
                ).count()
                active_sessions_count = active_sessions
            except Exception:
                pass
        
        status['active_sessions_count'] = active_sessions_count
        status['will_notify_sessions'] = active_sessions_count > 0
        
        return jsonify({
            'success': True,
            'status': status
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting sync status: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

@steam.route('/can-sync', methods=['GET'])
@jwt_required()
def can_sync():
    """Check if user can sync Steam library with detailed status"""
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Use User model helper methods
        can_sync, message = user.can_sync_steam()
        cooldown_remaining = user.steam_sync_cooldown_remaining()
        
        return jsonify({
            'success': True,
            'can_sync': can_sync,
            'message': message,
            'cooldown_remaining': cooldown_remaining,
            'last_synced': user.steam_library_synced_at.isoformat() if user.steam_library_synced_at else None,
            'steam_connected': user.is_steam_connected,
            'total_games': user.total_games or 0
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error checking sync permission: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

@steam.route('/common-games', methods=['POST'])
@jwt_required()
def common_games():
    """Get common games for user IDs with enhanced validation"""
    try:
        data = request.json
        user_ids = data.get('user_ids', [])
        
        # Enhanced validation
        if not isinstance(user_ids, list):
            return jsonify({'error': 'user_ids must be a list'}), 400
        
        if len(user_ids) < 2:
            return jsonify({'error': 'At least two user IDs required'}), 400
        
        if len(user_ids) > 50:  # Prevent excessive queries
            return jsonify({'error': 'Too many user IDs (maximum 50)'}), 400
        
        # Validate that all user IDs are integers
        try:
            user_ids = [int(uid) for uid in user_ids]
        except (ValueError, TypeError):
            return jsonify({'error': 'All user IDs must be valid integers'}), 400
        
        # Validate that all users exist and have Steam connected
        users = User.query.filter(User.id.in_(user_ids)).all()
        if len(users) != len(user_ids):
            return jsonify({'error': 'One or more users not found'}), 404
        
        steam_connected_users = [u for u in users if u.is_steam_connected]
        if len(steam_connected_users) < 2:
            return jsonify({
                'error': 'At least two users must have Steam connected',
                'steam_connected_count': len(steam_connected_users),
                'total_users': len(users)
            }), 400
        
        current_app.logger.info(f"Finding common games for {len(steam_connected_users)} Steam-connected users")
        
        # Use steam_service to find common games
        games = steam_service.find_common_games(user_ids)
        
        return jsonify({
            'success': True,
            'games': games,
            'total_users': len(user_ids),
            'steam_connected_users': len(steam_connected_users),
            'common_games_count': len([g for g in games if g.get('is_common', False)]),
            'metadata': {
                'generated_at': utc_now().isoformat(),
                'user_list': [{'id': u.id, 'username': u.username, 'steam_connected': u.is_steam_connected} for u in users]
            }
        }), 200
        
    except APIException as e:
        return jsonify({'success': False, 'error': e.message}), e.status_code
    except Exception as e:
        current_app.logger.error(f"Error in common_games: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'message': 'Failed to find common games. Please try again later.'
        }), 500

@steam.route('/game-details/<int:app_id>', methods=['GET'])
@jwt_required()
def get_game_details(app_id):
    """Get detailed information about a specific game with caching"""
    limiter = get_limiter()
    if limiter:
        # Rate limit game details to prevent Steam API abuse
        limiter.limit("60 per minute")(lambda: None)()
    
    try:
        if not steam_service:
            return jsonify({
                'error': 'Steam service not available',
                'message': 'Steam integration is currently unavailable'
            }), 503
        
        # Validate app_id
        if app_id <= 0:
            return jsonify({'error': 'Invalid Steam app ID'}), 400
        
        current_app.logger.info(f"Fetching details for Steam app {app_id}")
        
        # Check if we already have this game in our database
        existing_game = SteamGame.query.filter_by(steam_appid=app_id).first()
        if existing_game:
            return jsonify({
                'success': True,
                'game': existing_game.serialize(),
                'source': 'database'
            }), 200
        
        # Fetch from Steam API
        details = steam_service.get_game_details(app_id)
        
        if not details:
            return jsonify({
                'error': 'Game not found',
                'message': f'No game found with Steam app ID {app_id}'
            }), 404
        
        return jsonify({
            'success': True,
            'game': details,
            'source': 'steam_api'
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting game details for {app_id}: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'message': 'Failed to fetch game details. Please try again later.'
        }), 500

@steam.route('/user-profile', methods=['GET'])
@jwt_required()
def get_steam_profile():
    """Get user's Steam profile information with enhanced error handling"""
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
            
        if not user.steam_id:
            return jsonify({
                'error': 'Steam not connected',
                'message': 'Please connect your Steam account first',
                'cached_data': None
            }), 400
        
        # Get fresh profile data from Steam API
        if steam_service:
            try:
                profile = steam_service.get_user_profile(user.steam_id)
                
                # Update user data if we got fresh info
                if profile:
                    user.steam_username = profile.get('personaname', user.steam_username)
                    user.steam_avatar_url = profile.get('avatarfull', user.steam_avatar_url)
                    user.steam_profile_url = profile.get('profileurl', user.steam_profile_url)
                    db.session.commit()
                
                return jsonify({
                    'success': True,
                    'steam_profile': profile,
                    'cached_data': {
                        'steam_username': user.steam_username,
                        'steam_avatar_url': user.steam_avatar_url,
                        'steam_profile_url': user.steam_profile_url,
                        'last_synced': user.steam_library_synced_at.isoformat() if user.steam_library_synced_at else None
                    }
                }), 200
            except Exception as e:
                current_app.logger.warning(f"Steam API call failed for profile, using cached data: {str(e)}")
                # Fall back to cached data if API fails
                return jsonify({
                    'success': True,
                    'steam_profile': None,
                    'cached_data': {
                        'steam_username': user.steam_username,
                        'steam_avatar_url': user.steam_avatar_url,
                        'steam_profile_url': user.steam_profile_url,
                        'last_synced': user.steam_library_synced_at.isoformat() if user.steam_library_synced_at else None
                    },
                    'api_error': 'Steam API temporarily unavailable'
                }), 200
        else:
            return jsonify({
                'error': 'Steam service not available',
                'message': 'Steam integration is currently unavailable'
            }), 503
        
    except Exception as e:
        current_app.logger.error(f"Error getting Steam profile: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'message': 'Failed to fetch Steam profile. Please try again later.'
        }), 500

@steam.route('/status', methods=['GET'])
@jwt_required()
def steam_status():
    """Get Steam service status and user's connection info using User model helper methods"""
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Check Steam service availability
        steam_available = steam_service is not None
        api_key_configured = bool(steam_service and steam_service.api_key) if steam_available else False
        
        # Get sync status using User model helper methods
        sync_status = user.get_steam_sync_status() if user.steam_id else {
            "connected": False,
            "can_sync": False,
            "message": "Steam account not connected",
            "last_synced": None,
            "cooldown_remaining": 0
        }
        
        # 🔧 NEW: Add live voting integration status
        live_voting_manager = get_live_voting_manager()
        integration_status = {
            'sse_available': live_voting_manager is not None,
            'can_broadcast_updates': live_voting_manager is not None and user.is_steam_connected,
            'active_sessions': 0
        }
        
        if live_voting_manager:
            try:
                active_sessions = db.session.query(GameSession).join(GamingGroup).filter(
                    GamingGroup.members.any(id=user_id),
                    GameSession.status.in_(['planning', 'voting'])
                ).count()
                integration_status['active_sessions'] = active_sessions
            except Exception:
                pass
        
        return jsonify({
            'success': True,
            'steam_service': {
                'available': steam_available,
                'api_key_configured': api_key_configured,
                'status': 'operational' if steam_available and api_key_configured else 'limited'
            },
            'user_connection': {
                'connected': user.is_steam_connected,
                'steam_id': user.steam_id if user.is_steam_connected else None,
                'steam_username': user.steam_username if user.is_steam_connected else None,
                'total_games': user.total_games if user.is_steam_connected else 0,
                'last_synced': user.steam_library_synced_at.isoformat() if user.steam_library_synced_at else None
            },
            'sync_status': sync_status,
            'integration_status': integration_status
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting Steam status: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

# ============================================================================
# 🔧 NEW: STEAM CONNECTION ENDPOINTS WITH SSE BROADCASTING
# ============================================================================

@steam.route('/connect-status', methods=['GET'])
@jwt_required()
def get_connection_status():
    """Get detailed Steam connection status for user"""
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Get detailed connection info
        connection_info = {
            'steam_connected': user.is_steam_connected,
            'steam_id': user.steam_id,
            'steam_username': user.steam_username,
            'steam_avatar_url': user.steam_avatar_url,
            'steam_profile_url': user.steam_profile_url,
            'total_games': user.total_games or 0,
            'last_synced': user.steam_library_synced_at.isoformat() if user.steam_library_synced_at else None
        }
        
        # Get active voting sessions that would benefit from Steam connection
        active_sessions = []
        if user.is_steam_connected:
            try:
                sessions = db.session.query(GameSession).join(GamingGroup).filter(
                    GamingGroup.members.any(id=user_id),
                    GameSession.status.in_(['planning', 'voting'])
                ).all()
                
                for session in sessions:
                    active_sessions.append({
                        'id': session.id,
                        'session_name': session.session_name,
                        'status': session.status,
                        'group_name': session.group.name
                    })
            except Exception as e:
                current_app.logger.warning(f"Could not get active sessions: {e}")
        
        return jsonify({
            'success': True,
            'connection_info': connection_info,
            'active_sessions': active_sessions,
            'benefits': {
                'can_participate_in_voting': user.is_steam_connected,
                'can_share_games': user.is_steam_connected and user.total_games > 0,
                'real_time_updates': user.is_steam_connected and len(active_sessions) > 0
            }
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting connection status: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

@steam.route('/disconnect', methods=['POST'])
@jwt_required()
def disconnect_steam():
    """🔧 NEW: Disconnect Steam account with SSE broadcasting"""
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        if not user.is_steam_connected:
            return jsonify({
                'success': False,
                'error': 'Steam not connected',
                'message': 'Steam account is not currently connected'
            }), 400
        
        # Get active sessions before disconnection for SSE broadcasting
        live_voting_manager = get_live_voting_manager()
        active_sessions = []
        
        if live_voting_manager:
            try:
                active_sessions = db.session.query(GameSession).join(GamingGroup).filter(
                    GamingGroup.members.any(id=user_id),
                    GameSession.status.in_(['planning', 'voting'])
                ).all()
            except Exception as e:
                current_app.logger.warning(f"Could not find active sessions: {e}")
        
        # Store user data for broadcasting before disconnection
        user_data = {
            'user_id': user_id,
            'username': user.username,
            'steam_username': user.steam_username,
            'steam_avatar_url': user.steam_avatar_url
        }
        
        # Disconnect Steam
        user.steam_id = None
        user.steam_username = None
        user.steam_avatar_url = None
        user.steam_profile_url = None
        user.steam_connected = False
        user.is_steam_connected = False
        user.steam_library_synced_at = None
        user.total_games = 0
        
        # Clear user's game associations
        user.owned_games.clear()
        
        db.session.commit()
        
        current_app.logger.info(f"Steam disconnected for user {user.username}")
        
        # 🔧 NEW: Broadcast disconnection to active voting sessions
        if live_voting_manager and active_sessions:
            for session in active_sessions:
                try:
                    live_voting_manager.broadcast_steam_connection_change(
                        session.id, user_data, 'disconnected'
                    )
                    current_app.logger.info(f"Broadcasted Steam disconnection to session {session.id}")
                except Exception as e:
                    current_app.logger.warning(f"Failed to broadcast to session {session.id}: {e}")
        
        return jsonify({
            'success': True,
            'message': 'Steam account disconnected successfully',
            'active_sessions_notified': len(active_sessions) if active_sessions else 0
        }), 200
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error disconnecting Steam: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'message': 'Failed to disconnect Steam account. Please try again later.'
        }), 500

# ============================================================================
# HEALTH CHECK AND DEBUGGING ENDPOINTS
# ============================================================================

@steam.route('/health', methods=['GET'])
def steam_health():
    """Steam service health check with SSE integration status"""
    try:
        health_status = {
            'steam_service': 'available' if steam_service else 'unavailable',
            'api_key': 'configured' if (steam_service and steam_service.api_key) else 'missing',
            'database': 'unknown',
            'sse_integration': 'unknown'
        }
        
        # Test database connection
        try:
            db.session.execute(text('SELECT 1'))
            health_status['database'] = 'healthy'
        except Exception:
            health_status['database'] = 'unhealthy'
        
        # Test SSE integration
        live_voting_manager = get_live_voting_manager()
        health_status['sse_integration'] = 'available' if live_voting_manager else 'unavailable'
        
        # Test Steam API if available
        if steam_service and steam_service.api_key:
            try:
                # Quick test - get details for a known game (e.g., Counter-Strike)
                test_result = steam_service.get_game_details(730)
                health_status['steam_api'] = 'responding' if test_result else 'not_responding'
            except Exception:
                health_status['steam_api'] = 'error'
        else:
            health_status['steam_api'] = 'not_configured'
        
        overall_status = 'healthy' if all(
            status in ['available', 'configured', 'healthy', 'responding'] 
            for status in health_status.values()
        ) else 'degraded'
        
        return jsonify({
            'status': overall_status,
            'components': health_status,
            'timestamp': utc_now().isoformat()
        }), 200 if overall_status == 'healthy' else 503
        
    except Exception as e:
        current_app.logger.error(f"Steam health check error: {str(e)}")
        return jsonify({
            'status': 'error',
            'error': str(e),
            'timestamp': utc_now().isoformat()
        }), 500

@steam.route('/debug/active-sessions', methods=['GET'])
@jwt_required()
def debug_active_sessions():
    """🔧 NEW: Debug endpoint to see active sessions for current user"""
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Get active sessions
        active_sessions = db.session.query(GameSession).join(GamingGroup).filter(
            GamingGroup.members.any(id=user_id),
            GameSession.status.in_(['planning', 'voting'])
        ).all()
        
        session_data = []
        for session in active_sessions:
            session_data.append({
                'id': session.id,
                'session_name': session.session_name,
                'status': session.status,
                'group_id': session.group.id,
                'group_name': session.group.name,
                'total_members': len(session.group.members),
                'steam_connected_members': len([m for m in session.group.members if m.is_steam_connected]),
                'created_at': session.created_at.isoformat()
            })
        
        # Check SSE integration
        live_voting_manager = get_live_voting_manager()
        sse_status = {
            'manager_available': live_voting_manager is not None,
            'active_connections': 0
        }
        
        if live_voting_manager:
            total_connections = sum(
                len(connections) 
                for connections in live_voting_manager.session_connections.values()
            )
            sse_status['active_connections'] = total_connections
        
        return jsonify({
            'success': True,
            'user_id': user_id,
            'username': user.username,
            'steam_connected': user.is_steam_connected,
            'active_sessions': session_data,
            'active_sessions_count': len(active_sessions),
            'sse_status': sse_status,
            'timestamp': utc_now().isoformat()
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error in debug endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'details': str(e)
        }), 500