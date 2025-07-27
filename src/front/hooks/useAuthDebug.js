// src/front/hooks/useAuthDebug.js - Development Debugging Features
import { useCallback } from 'react';
import useGlobalReducer from './useGlobalReducer';
import useTokenManager from './useTokenManager';
import authService from '../store/authService';

/**
 * Development debugging hook for authentication
 * Only available in development mode
 */
const useAuthDebug = () => {
    const { store } = useGlobalReducer();
    const tokenManager = useTokenManager();

    // Only provide debug functions in development
    if (process.env.NODE_ENV !== 'development') {
        return {
            available: false,
            debugInfo: null,
            forceTokenRefresh: () => ({ success: false, error: 'Not available in production' }),
            resetAuth: () => console.warn('resetAuth is only available in development mode')
        };
    }

    const getDebugInfo = useCallback(() => {
        const tokenInfo = tokenManager.getTokenInfo();
        
        return {
            // Auth state
            isAuthenticated: store?.isAuthenticated,
            authLoading: store?.authLoading,
            authError: store?.authError,
            user: store?.user ? { 
                id: store.user.id, 
                username: store.user.username, 
                email: store.user.email,
                steam_connected: store.user.steam_connected || store.user.is_steam_connected
            } : null,
            
            // Token info
            hasAccessToken: !!authService.getAccessToken(),
            hasRefreshToken: !!authService.getRefreshToken(),
            tokenInfo: tokenInfo ? {
                isExpired: tokenInfo.isExpired,
                needsRefresh: tokenInfo.needsRefresh,
                timeUntilExpiry: tokenInfo.timeUntilExpiry,
                expiryDate: tokenInfo.expiry.toISOString(),
                issuedAt: tokenInfo.issuedAt.toISOString()
            } : null,
            
            // Service state
            authServiceState: {
                authCheckCompleted: authService.authCheckCompleted,
                isRefreshing: authService.isRefreshing,
                hasDispatch: !!authService.dispatch
            },
            
            // Store state
            storeState: {
                hasStore: !!store,
                storeKeys: store ? Object.keys(store) : []
            },
            
            // Performance metrics
            performance: {
                timestamp: new Date().toISOString(),
                tokenAge: tokenInfo ? Date.now() - tokenInfo.issuedAt.getTime() : null,
                timeToExpiry: tokenInfo ? tokenInfo.timeUntilExpiry : null
            }
        };
    }, [store, tokenManager]);

    const forceTokenRefresh = useCallback(async () => {
        try {
            console.log('🔄 [DEBUG] Forcing token refresh...');
            await authService.refreshTokenSilently();
            console.log('✅ [DEBUG] Token refresh completed');
            return { success: true };
        } catch (error) {
            console.error('❌ [DEBUG] Token refresh failed:', error);
            return { success: false, error: error.message };
        }
    }, []);

    const resetAuth = useCallback(() => {
        console.log('🧹 [DEBUG] Resetting authentication state...');
        authService.clearAuth();
        console.log('✅ [DEBUG] Auth state reset completed');
    }, []);

    const simulateTokenExpiry = useCallback(() => {
        console.log('⏰ [DEBUG] Simulating token expiry...');
        // In development, we can manipulate the token to test expiry scenarios
        const token = authService.getAccessToken();
        if (token) {
            // This would normally require server-side testing
            console.warn('⚠️ [DEBUG] Token expiry simulation requires server-side support');
        }
    }, []);

    const logAuthFlow = useCallback((action, data = {}) => {
        if (process.env.NODE_ENV === 'development') {
            console.log(`🔍 [AUTH_DEBUG] ${action}:`, {
                timestamp: new Date().toISOString(),
                authState: {
                    isAuthenticated: store?.isAuthenticated,
                    hasUser: !!store?.user,
                    hasToken: !!authService.getAccessToken()
                },
                ...data
            });
        }
    }, [store]);

    return {
        available: true,
        debugInfo: getDebugInfo(),
        forceTokenRefresh,
        resetAuth,
        simulateTokenExpiry,
        logAuthFlow,
        authService // Direct access for debugging
    };
};

export default useAuthDebug;