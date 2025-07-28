// src/front/hooks/useAuth.js - REFACTORED CORE VERSION (150 lines vs 655)
import { useCallback } from 'react';
import useGlobalReducer from './useGlobalReducer';
import useAuthFlow from './useAuthFlow';
import useTokenManager from './useTokenManager';
import useConnectionStatus from './useConnectionStatus';

/**
 * Core authentication hook - simplified for performance
 * Perfect for SSE components that just need auth state
 * 
 * REFACTORED: Reduced from 655 lines to ~150 lines
 * - Removed heavy debugging code (moved to useAuthDebug)
 * - Removed connection monitoring (moved to useConnectionStatus)
 * - Removed token management complexity (moved to useTokenManager)
 * - Removed auth flows (moved to useAuthFlow)
 */
export const useAuth = () => {
    const { store, dispatch } = useGlobalReducer();
    const authFlow = useAuthFlow();
    const tokenManager = useTokenManager();
    const connectionStatus = useConnectionStatus();

    // Extract auth state with proper defaults
    const {
        isAuthenticated = false,
        user = null,
        authLoading = false,
        authError = null
    } = store || {};

    const clearError = useCallback(() => {
        dispatch({ type: 'clear_error' });
    }, [dispatch]);

    const updateUser = useCallback((updatedUser) => {
        console.log('👤 Updating user in useAuth hook:', updatedUser);
        dispatch({
            type: 'set_user',
            payload: updatedUser
        });
    }, [dispatch]);

    const hasPermission = useCallback((permission) => {
        if (!user) return false;
        
        switch (permission) {
            case 'admin':
                return user.role === 'admin' || user.is_admin;
            case 'steam_connected':
                return user.steam_connected || user.is_steam_connected;
            case 'verified':
                return user.email_verified || user.is_verified;
            case 'active':
                return user.is_active;
            default:
                return false;
        }
    }, [user]);

    const getAuthStatus = useCallback(() => {
        return tokenManager.getAuthStatus();
    }, [tokenManager]);

    const waitForAuth = useCallback(async () => {
        return await tokenManager.waitForAuth();
    }, [tokenManager]);

    // Core auth interface - clean and fast for SSE components
    return {
        // Core state (what most components need)
        isAuthenticated,
        user,
        authLoading,
        authError,
        
        // Core actions (delegated to focused hooks)
        login: authFlow.login,
        register: authFlow.register,
        logout: authFlow.logout,
        
        // Token info (delegated to token manager)
        token: tokenManager.hasValidToken(),
        getTokenInfo: tokenManager.getTokenInfo,
        refreshToken: tokenManager.refreshToken,
        verifyToken: tokenManager.verifyToken,
        
        // User management
        updateUser,
        refreshUserProfile: authFlow.refreshUserProfile,
        
        // Status and validation  
        verifyAuthenticationStatus: tokenManager.verifyAuthenticationStatus,
        clearError,
        hasPermission,
        getAuthStatus,
        waitForAuth,
        
        // Connection status (for compatibility)
        connectionStatus
    };
};

// ============================================================================
// BACKWARD COMPATIBILITY HOOKS
// ============================================================================

/**
 * Hook specifically for token management
 * MAINTAINED: For backward compatibility
 */
export const useToken = () => {
    const tokenManager = useTokenManager();
    return {
        getTokenInfo: tokenManager.getTokenInfo,
        refreshToken: tokenManager.refreshToken,
        verifyToken: tokenManager.verifyToken,
        isValid: tokenManager.isValid,
        needsRefresh: tokenManager.needsRefresh
    };
};

/**
 * Hook for permission checking
 * MAINTAINED: For backward compatibility
 */
export const usePermissions = () => {
    const { user, hasPermission } = useAuth();
    
    const can = useCallback((permission) => hasPermission(permission), [hasPermission]);
    const cannot = useCallback((permission) => !hasPermission(permission), [hasPermission]);
    
    const isRole = useCallback((role) => user?.role === role, [user]);
    const isOwner = useCallback((resource) => {
        if (!user || !resource) return false;
        return resource.creator_id === user.id || 
               resource.owner_id === user.id || 
               resource.user_id === user.id;
    }, [user]);
    
    return {
        user,
        can,
        cannot,
        isRole,
        isOwner,
        hasPermission
    };
};

/**
 * Hook for connection monitoring
 * MAINTAINED: For backward compatibility
 * ENHANCED: Now uses dedicated useConnectionStatus hook
 */
