// src/front/hooks/useTokenManager.js - JWT Token Management
import { useCallback, useEffect, useRef } from 'react';
import useGlobalReducer from './useGlobalReducer';
import authService from '../store/authService';

/**
 * JWT token management hook
 * Handles token parsing, validation, refresh scheduling
 */
const useTokenManager = () => {
    const { store, dispatch } = useGlobalReducer();
    const initializationRef = useRef(false);

    // Initialize auth service with dispatch on first render
    useEffect(() => {
        if (!initializationRef.current && dispatch) {
            console.log('🔗 Initializing token manager with dispatch...');
            initializationRef.current = true;
            authService.setDispatch(dispatch);
        }
    }, [dispatch]);

    const getTokenInfo = useCallback(() => {
        const token = authService.getAccessToken();
        if (!token) return null;

        const parsed = authService.parseJWT(token);
        if (!parsed) return null;

        const expiry = new Date(parsed.payload.exp * 1000);
        const issuedAt = new Date(parsed.payload.iat * 1000);
        const timeUntilExpiry = expiry.getTime() - Date.now();

        return {
            header: parsed.header,
            payload: {
                ...parsed.payload,
                // Don't expose sensitive data
                sub: parsed.payload.sub,
                username: parsed.payload.username,
                email: parsed.payload.email,
                steam_connected: parsed.payload.steam_connected
            },
            expiry,
            issuedAt,
            timeUntilExpiry,
            isExpired: timeUntilExpiry <= 0,
            needsRefresh: authService.needsRefresh(token)
        };
    }, []);

    const refreshToken = useCallback(async () => {
        try {
            await authService.refreshTokenSilently();
            return { success: true };
        } catch (error) {
            console.error('Token refresh failed:', error);
            return { success: false, error: error.message };
        }
    }, []);

    const verifyToken = useCallback(async () => {
        try {
            const token = authService.getAccessToken();
            if (!token) {
                return { valid: false, error: 'No token available' };
            }

            const response = await authService.authenticatedFetch('/api/auth/verify');
            
            if (response.ok) {
                const data = await response.json();
                return { valid: data.valid, user: data.user };
            } else {
                throw new Error('Token verification failed');
            }
        } catch (error) {
            console.error('Token verification error:', error);
            return { valid: false, error: error.message };
        }
    }, []);

    const isValid = useCallback(() => {
        const info = getTokenInfo();
        return info && !info.isExpired;
    }, [getTokenInfo]);

    const needsRefresh = useCallback(() => {
        const info = getTokenInfo();
        return info && info.needsRefresh;
    }, [getTokenInfo]);

    const hasValidToken = useCallback(() => {
        return !!authService.getAccessToken() && isValid();
    }, [isValid]);

    const verifyAuthenticationStatus = useCallback(async () => {
        try {
            const tokenInfo = getTokenInfo();
            if (!tokenInfo || tokenInfo.isExpired) {
                console.log('🔍 Token is expired or invalid');
                authService.clearAuth();
                return { authenticated: false, reason: 'token_expired' };
            }

            if (tokenInfo.needsRefresh) {
                console.log('🔄 Token needs refresh');
                try {
                    await authService.refreshTokenSilently();
                } catch (refreshError) {
                    console.error('🔄 Token refresh failed:', refreshError);
                    authService.clearAuth();
                    return { authenticated: false, reason: 'refresh_failed' };
                }
            }

            // Verify with server
            const verification = await verifyToken();
            if (!verification.valid) {
                console.log('🔍 Server token verification failed');
                authService.clearAuth();
                return { authenticated: false, reason: 'server_rejected' };
            }

            return { authenticated: true, user: store?.user };
        } catch (error) {
            console.error('🔍 Auth verification error:', error);
            return { authenticated: false, reason: 'verification_error', error: error.message };
        }
    }, [getTokenInfo, verifyToken, store?.user]);

    const waitForAuth = useCallback(async () => {
        if (authService.authCheckCompleted) {
            return { 
                isAuthenticated: store?.isAuthenticated, 
                user: store?.user,
                tokenInfo: getTokenInfo()
            };
        }
        
        await authService.waitForInitialization();
        return { 
            isAuthenticated: store?.isAuthenticated, 
            user: store?.user,
            tokenInfo: getTokenInfo()
        };
    }, [store?.isAuthenticated, store?.user, getTokenInfo]);

    const getAuthStatus = useCallback(() => {
        const tokenInfo = getTokenInfo();
        
        return {
            isAuthenticated: store?.isAuthenticated,
            isLoading: store?.authLoading,
            hasError: !!store?.authError,
            error: store?.authError,
            user: store?.user,
            token: !!authService.getAccessToken(),
            tokenInfo,
            steamConnected: store?.user?.steam_connected || store?.user?.is_steam_connected || false,
            canRefreshToken: !!authService.getRefreshToken(),
            authService: {
                hasValidToken: tokenInfo && !tokenInfo.isExpired,
                needsRefresh: tokenInfo && tokenInfo.needsRefresh,
                timeUntilExpiry: tokenInfo ? tokenInfo.timeUntilExpiry : null
            }
        };
    }, [store, getTokenInfo]);

    return {
        getTokenInfo,
        refreshToken,
        verifyToken,
        isValid,
        needsRefresh,
        hasValidToken,
        verifyAuthenticationStatus,
        waitForAuth,
        getAuthStatus
    };
};

export default useTokenManager;