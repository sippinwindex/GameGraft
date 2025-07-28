// src/front/hooks/useAuth.js - Missing authentication hook

import { useGlobalReducer } from '../store/store.js';

/**
 * Authentication hook for accessing auth state and user data
 * Works with the global store and authService
 */
const useAuth = () => {
    const { store } = useGlobalReducer();
    
    return {
        // User data
        user: store.user,
        isAuthenticated: store.isAuthenticated,
        
        // Loading states
        isLoading: store.authLoading,
        
        // Error states
        error: store.authError,
        
        // Token access
        token: store.token,
        
        // Convenience methods
        hasRole: (role) => store.user?.role === role,
        hasPermission: (permission) => store.user?.permissions?.includes(permission),
        isConnectedToSteam: () => store.user?.steam_connected || store.user?.is_steam_connected || false,
        
        // User profile helpers
        getUserId: () => store.user?.id,
        getUsername: () => store.user?.username,
        getUserEmail: () => store.user?.email,
        getUserAvatar: () => store.user?.avatar_url,
        
        // Steam-specific helpers
        getSteamUsername: () => store.user?.steam_username,
        getSteamId: () => store.user?.steam_id,
        getSteamAvatar: () => store.user?.steam_avatar_url,
        getTotalGames: () => store.user?.total_games || 0,
        getLastSynced: () => store.user?.steam_library_synced_at
    };
};

export default useAuth;