// src/front/store/services/TokenService.js - JWT Token Management Service

/**
 * TokenService - Focused JWT token management
 * Extracted from monolithic AuthService for better performance
 * Perfect for SSE voting system that needs fast token operations
 */
class TokenService {
    constructor() {
        this.tokenKey = 'squadup_access_token';
        this.refreshTokenKey = 'squadup_refresh_token';
        this.userKey = 'squadup_user';
        this.rememberKey = 'squadup_remember_me';
        
        this.refreshTimer = null;
        this.isRefreshing = false;
        this.failedQueue = [];
        
        // JWT Configuration
        this.jwtConfig = {
            headerName: 'Authorization',
            headerType: 'Bearer',
            tokenRefreshThreshold: 5 * 60 * 1000, // 5 minutes before expiry
            maxRetries: 3,
            retryDelay: 1000
        };
        
        console.log('🔐 TokenService initialized for optimized JWT management');
    }

    // ============================================================================
    // JWT PARSING AND VALIDATION
    // ============================================================================

    /**
     * Parse and validate JWT token structure
     */
    parseJWT(token) {
        if (!token || typeof token !== 'string') return null;
        
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return null;
            
            const header = JSON.parse(atob(parts[0]));
            const payload = JSON.parse(atob(parts[1]));
            
            return {
                header,
                payload,
                signature: parts[2],
                raw: token
            };
        } catch (error) {
            console.warn('🔍 JWT parsing failed:', error);
            return null;
        }
    }

    /**
     * Validate JWT token format and expiration
     */
    isValidTokenFormat(token) {
        const parsed = this.parseJWT(token);
        if (!parsed) return false;
        
        const { payload } = parsed;
        
        // Check required claims
        if (!payload.sub || !payload.exp || !payload.iat) {
            console.warn('🔍 JWT missing required claims');
            return false;
        }
        
        // Check expiration
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp <= now) {
            console.warn('🔍 JWT is expired');
            return false;
        }
        
        // Check not before (if present)
        if (payload.nbf && payload.nbf > now) {
            console.warn('🔍 JWT not yet valid (nbf claim)');
            return false;
        }
        
        return true;
    }

    /**
     * Get token expiration time in milliseconds
     */
    getTokenExpiry(token) {
        const parsed = this.parseJWT(token);
        return parsed ? parsed.payload.exp * 1000 : null;
    }

    /**
     * Check if token needs refresh
     */
    needsRefresh(token) {
        const expiry = this.getTokenExpiry(token);
        if (!expiry) return true;
        
        return (expiry - Date.now()) < this.jwtConfig.tokenRefreshThreshold;
    }

    /**
     * Get comprehensive token info for debugging/display
     */
    getTokenInfo(token = null) {
        const actualToken = token || this.getAccessToken();
        if (!actualToken) return null;

        const parsed = this.parseJWT(actualToken);
        if (!parsed) return null;

        const expiry = new Date(parsed.payload.exp * 1000);
        const issuedAt = new Date(parsed.payload.iat * 1000);
        const timeUntilExpiry = expiry.getTime() - Date.now();

        return {
            header: parsed.header,
            payload: {
                // Only expose safe claims
                sub: parsed.payload.sub,
                username: parsed.payload.username,
                email: parsed.payload.email,
                steam_connected: parsed.payload.steam_connected,
                exp: parsed.payload.exp,
                iat: parsed.payload.iat,
                fresh: parsed.payload.fresh
            },
            expiry,
            issuedAt,
            timeUntilExpiry,
            isExpired: timeUntilExpiry <= 0,
            needsRefresh: this.needsRefresh(actualToken),
            isValid: this.isValidTokenFormat(actualToken)
        };
    }

    // ============================================================================
    // TOKEN STORAGE MANAGEMENT
    // ============================================================================

    /**
     * Store tokens with proper storage selection
     */
    setTokens(accessToken, refreshToken, user, remember = false) {
        // Determine storage type based on remember preference
        const storage = remember ? localStorage : sessionStorage;
        
        // Also check if user explicitly set remember me previously
        const wasRemembered = localStorage.getItem(this.rememberKey) === 'true';
        const useLocalStorage = remember || wasRemembered;
        const finalStorage = useLocalStorage ? localStorage : sessionStorage;
        
        if (!accessToken || !user) {
            console.error('❌ Invalid tokens or user data provided to TokenService');
            return false;
        }
        
        // Validate token before storing
        if (!this.isValidTokenFormat(accessToken)) {
            console.error('❌ Invalid token format provided to TokenService');
            return false;
        }
        
        try {
            // Clear from both storages first
            [localStorage, sessionStorage].forEach(s => {
                s.removeItem(this.tokenKey);
                s.removeItem(this.refreshTokenKey);
                s.removeItem(this.userKey);
            });
            
            // Store in the chosen storage
            finalStorage.setItem(this.tokenKey, accessToken);
            if (refreshToken) {
                finalStorage.setItem(this.refreshTokenKey, refreshToken);
            }
            finalStorage.setItem(this.userKey, JSON.stringify(user));
            
            // Store remember preference
            if (remember) {
                localStorage.setItem(this.rememberKey, 'true');
            } else {
                localStorage.removeItem(this.rememberKey);
            }
            
            this.scheduleTokenRefresh(accessToken);
            console.log('✅ Tokens stored successfully by TokenService in', useLocalStorage ? 'localStorage' : 'sessionStorage');
            return true;
        } catch (error) {
            console.error('❌ TokenService error storing tokens:', error);
            return false;
        }
    }

    /**
     * Get stored access token
     */
    getAccessToken() {
        return localStorage.getItem(this.tokenKey) || sessionStorage.getItem(this.tokenKey);
    }

    /**
     * Get stored refresh token
     */
    getRefreshToken() {
        return localStorage.getItem(this.refreshTokenKey) || sessionStorage.getItem(this.refreshTokenKey);
    }

    /**
     * Get stored user data
     */
    getUser() {
        const userStr = localStorage.getItem(this.userKey) || sessionStorage.getItem(this.userKey);
        try {
            return userStr ? JSON.parse(userStr) : null;
        } catch (e) {
            console.error('TokenService error parsing user data:', e);
            this.clearUserData();
            return null;
        }
    }

    /**
     * Clear all stored auth data
     */
    clearTokens() {
        console.log('🧹 TokenService clearing all stored tokens...');
        
        [localStorage, sessionStorage].forEach(s => {
            s.removeItem(this.tokenKey);
            s.removeItem(this.refreshTokenKey);
            s.removeItem(this.userKey);
        });
        
        localStorage.removeItem(this.rememberKey);
        
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        
        console.log('✅ TokenService cleared all tokens');
    }

    /**
     * Clear just user data (keeping tokens)
     */
    clearUserData() {
        [localStorage, sessionStorage].forEach(s => {
            s.removeItem(this.userKey);
        });
    }

    // ============================================================================
    // TOKEN REFRESH SCHEDULING
    // ============================================================================

    /**
     * Schedule automatic token refresh
     */
    scheduleTokenRefresh(accessToken, refreshCallback = null) {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        
        try {
            const expiry = this.getTokenExpiry(accessToken);
            if (!expiry) return;
            
            const timeToRefresh = expiry - Date.now() - this.jwtConfig.tokenRefreshThreshold;
            
            if (timeToRefresh > 0) {
                this.refreshTimer = setTimeout(() => {
                    console.log('⏰ TokenService automatic refresh triggered');
                    if (refreshCallback) {
                        refreshCallback();
                    }
                }, timeToRefresh);
                
                console.log(`⏰ TokenService refresh scheduled in ${Math.round(timeToRefresh / 1000 / 60)} minutes`);
            } else {
                console.log('⚠️ Token expires soon, scheduling immediate refresh');
                if (refreshCallback) {
                    setTimeout(() => refreshCallback(), 1000);
                }
            }
        } catch (error) {
            console.error('TokenService error scheduling refresh:', error);
        }
    }

    /**
     * Cancel scheduled refresh
     */
    cancelScheduledRefresh() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
            console.log('🚫 TokenService cancelled scheduled refresh');
        }
    }

    // ============================================================================
    // TOKEN VALIDATION AND VERIFICATION
    // ============================================================================

    /**
     * Check if current tokens are valid
     */
    hasValidTokens() {
        const accessToken = this.getAccessToken();
        const user = this.getUser();
        
        const hasValidToken = accessToken && this.isValidTokenFormat(accessToken);
        const hasValidUser = user && typeof user === 'object' && user.id;
        
        return !!(hasValidToken && hasValidUser);
    }

    /**
     * Verify token with server (async)
     */
    async verifyTokenWithServer(token, fetchFunction) {
        try {
            const response = await fetchFunction('/api/auth/verify', {
                method: 'GET',
                headers: {
                    [this.jwtConfig.headerName]: `${this.jwtConfig.headerType} ${token}`
                },
                signal: AbortSignal.timeout(10000)
            });
            
            if (response.ok) {
                const data = await response.json();
                return data.valid === true;
            }
            
            return false;
        } catch (error) {
            console.warn('TokenService verification request failed:', error);
            return false;
        }
    }

    // ============================================================================
    // REFRESH TOKEN MANAGEMENT
    // ============================================================================

    /**
     * Process refresh queue for concurrent requests
     */
    processQueue(error, token = null) {
        this.failedQueue.forEach(({ resolve, reject }) => {
            if (error) {
                reject(error);
            } else {
                resolve(token);
            }
        });
        this.failedQueue = [];
    }

    /**
     * Add request to refresh queue
     */
    addToRefreshQueue() {
        return new Promise((resolve, reject) => {
            this.failedQueue.push({ resolve, reject });
        });
    }

    /**
     * Handle refresh in progress state
     */
    setRefreshInProgress(inProgress) {
        this.isRefreshing = inProgress;
    }

    // ============================================================================
    // UTILITY METHODS
    // ============================================================================

    /**
     * Get JWT configuration
     */
    getJWTConfig() {
        return { ...this.jwtConfig };
    }

    /**
     * Update JWT configuration
     */
    updateJWTConfig(updates) {
        this.jwtConfig = { ...this.jwtConfig, ...updates };
        console.log('🔧 TokenService JWT config updated:', updates);
    }

    /**
     * Get token statistics for monitoring
     */
    getTokenStats() {
        const accessToken = this.getAccessToken();
        const refreshToken = this.getRefreshToken();
        const user = this.getUser();
        
        const tokenInfo = accessToken ? this.getTokenInfo(accessToken) : null;
        
        return {
            hasAccessToken: !!accessToken,
            hasRefreshToken: !!refreshToken,
            hasUser: !!user,
            isValid: this.hasValidTokens(),
            tokenInfo: tokenInfo ? {
                timeUntilExpiry: tokenInfo.timeUntilExpiry,
                needsRefresh: tokenInfo.needsRefresh,
                isExpired: tokenInfo.isExpired
            } : null,
            refreshScheduled: !!this.refreshTimer,
            isRefreshing: this.isRefreshing,
            queueLength: this.failedQueue.length
        };
    }

    /**
     * Debug information (development only)
     */
    getDebugInfo() {
        if (process.env.NODE_ENV !== 'development') return null;
        
        return {
            storage: {
                localStorage: {
                    hasToken: !!localStorage.getItem(this.tokenKey),
                    hasRefresh: !!localStorage.getItem(this.refreshTokenKey),
                    hasUser: !!localStorage.getItem(this.userKey),
                    hasRemember: !!localStorage.getItem(this.rememberKey)
                },
                sessionStorage: {
                    hasToken: !!sessionStorage.getItem(this.tokenKey),
                    hasRefresh: !!sessionStorage.getItem(this.refreshTokenKey),
                    hasUser: !!sessionStorage.getItem(this.userKey)
                }
            },
            config: this.jwtConfig,
            state: {
                refreshTimer: !!this.refreshTimer,
                isRefreshing: this.isRefreshing,
                queueLength: this.failedQueue.length
            },
            stats: this.getTokenStats()
        };
    }
}

export default TokenService;