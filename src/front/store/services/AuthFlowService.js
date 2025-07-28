// src/front/store/services/AuthFlowService.js - Authentication Flow Management

import { fetchWithConfig } from '../../config/environment.js';

/**
 * AuthFlowService - Focused authentication flow management
 * Handles login, register, logout, and profile operations
 * Optimized for SSE voting system performance
 */
class AuthFlowService {
    constructor(tokenService) {
        this.tokenService = tokenService;
        this.maxRetries = 3;
        this.retryDelay = 1000;
        
        console.log('🔐 AuthFlowService initialized for optimized auth flows');
    }

    // ============================================================================
    // CORE AUTHENTICATION FLOWS
    // ============================================================================

    /**
     * Enhanced login with proper token handling
     */
    async login(credentials, remember = false) {
        try {
            console.log('🔐 AuthFlowService starting login process...');
            
            const response = await fetchWithConfig('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ 
                    login: credentials.email || credentials.login, 
                    password: credentials.password 
                }),
                signal: AbortSignal.timeout(15000)
            });
            
            const data = await response.json();
            console.log('🔍 AuthFlowService login response:', data);
            
            if (response.ok && data.success) {
                // Handle both token formats
                let accessToken, refreshToken;
                
                if (data.tokens) {
                    // New format: tokens nested under 'tokens' object
                    accessToken = data.tokens.access_token;
                    refreshToken = data.tokens.refresh_token;
                } else {
                    // Current format: tokens at root level
                    accessToken = data.access_token;
                    refreshToken = data.refresh_token;
                }
                
                if (!accessToken) {
                    throw new Error('No access token received from server');
                }
                
                // Validate received token using TokenService
                if (!this.tokenService.isValidTokenFormat(accessToken)) {
                    throw new Error('Received invalid access token format');
                }
                
                console.log('✅ AuthFlowService login successful, storing tokens...');
                const tokensStored = this.tokenService.setTokens(accessToken, refreshToken, data.user, remember);
                
                if (!tokensStored) {
                    throw new Error('Failed to store authentication tokens');
                }
                
                return { 
                    success: true, 
                    user: data.user, 
                    message: data.message,
                    accessToken,
                    refreshToken
                };
            } else { 
                const errorMessage = this.getErrorMessage(data, response.status);
                return { success: false, error: errorMessage }; 
            }
        } catch (error) { 
            console.error('AuthFlowService login error:', error);
            return { success: false, error: this.getErrorMessage(error) }; 
        }
    }

    /**
     * Enhanced registration with proper token handling
     */
    async register(userData, remember = false) {
        try {
            console.log('📝 AuthFlowService starting registration process...');
            
            const response = await fetchWithConfig('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(userData),
                signal: AbortSignal.timeout(15000)
            });
            
            const data = await response.json();
            console.log('🔍 AuthFlowService registration response:', data);
            
            if (response.ok && data.success) {
                // Handle both token formats
                let accessToken, refreshToken;
                
                if (data.tokens) {
                    accessToken = data.tokens.access_token;
                    refreshToken = data.tokens.refresh_token;
                } else {
                    accessToken = data.access_token;
                    refreshToken = data.refresh_token;
                }
                
                if (!accessToken) {
                    console.error('❌ No access token in registration response:', data);
                    throw new Error('No access token received from server');
                }
                
                if (!this.tokenService.isValidTokenFormat(accessToken)) {
                    console.error('❌ Invalid token format in registration:', accessToken);
                    throw new Error('Received invalid access token format');
                }
                
                console.log('✅ AuthFlowService registration successful, storing tokens...');
                const tokensStored = this.tokenService.setTokens(accessToken, refreshToken, data.user, remember);
                
                if (!tokensStored) {
                    throw new Error('Failed to store authentication tokens');
                }
                
                console.log('🎉 AuthFlowService registration completed successfully!');
                return { 
                    success: true, 
                    user: data.user, 
                    message: data.message || 'Account created successfully! Welcome to SquadUp!',
                    accessToken,
                    refreshToken
                };
            } else { 
                const errorMessage = this.getErrorMessage(data, response.status);
                return { success: false, error: errorMessage }; 
            }
        } catch (error) { 
            console.error('AuthFlowService registration error:', error);
            return { success: false, error: this.getErrorMessage(error) }; 
        }
    }

    /**
     * Enhanced logout with server notification
     */
    async logout() { 
        console.log('🚪 AuthFlowService starting logout process...');
        
        try { 
            const token = this.tokenService.getAccessToken(); 
            if (token) { 
                const response = await fetchWithConfig('/api/auth/logout', {
                    method: 'POST',
                    headers: {
                        [this.tokenService.getJWTConfig().headerName]: 
                            `${this.tokenService.getJWTConfig().headerType} ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                console.log('📡 AuthFlowService logout API response:', response.status);
            } 
        } catch (error) { 
            console.error('AuthFlowService logout API call failed:', error); 
        }
        
        // Always clear tokens regardless of API response
        this.tokenService.clearTokens();
        console.log('✅ AuthFlowService logout completed');
        
        return { success: true };
    }

    // ============================================================================
    // TOKEN REFRESH MANAGEMENT
    // ============================================================================

    /**
     * Silent token refresh for maintaining sessions
     */
    async refreshTokenSilently() {
        if (this.tokenService.isRefreshing) {
            return this.tokenService.addToRefreshQueue();
        }

        this.tokenService.setRefreshInProgress(true);
        const refreshToken = this.tokenService.getRefreshToken();

        if (!refreshToken) {
            console.warn('🔄 AuthFlowService: No refresh token available');
            this.tokenService.clearTokens();
            this.tokenService.processQueue(new Error('No refresh token'), null);
            return;
        }

        try {
            console.log('🔄 AuthFlowService attempting silent token refresh...');
            
            const response = await fetchWithConfig('/api/auth/refresh', {
                method: 'POST',
                headers: {
                    [this.tokenService.getJWTConfig().headerName]: 
                        `${this.tokenService.getJWTConfig().headerType} ${refreshToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                
                // Handle both token formats for refresh too
                let newAccessToken;
                if (data.tokens) {
                    newAccessToken = data.tokens.access_token;
                } else {
                    newAccessToken = data.access_token;
                }
                
                if (newAccessToken && this.tokenService.isValidTokenFormat(newAccessToken)) {
                    const user = this.tokenService.getUser();
                    const remember = !!localStorage.getItem(this.tokenService.tokenKey);
                    this.tokenService.setTokens(newAccessToken, refreshToken, user, remember);
                    
                    this.tokenService.processQueue(null, newAccessToken);
                    console.log('✅ AuthFlowService token refreshed successfully');
                    
                    return { success: true, accessToken: newAccessToken };
                } else {
                    throw new Error('Invalid token received from refresh');
                }
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Token refresh failed');
            }
        } catch (error) {
            console.error('AuthFlowService token refresh failed:', error);
            this.tokenService.clearTokens();
            this.tokenService.processQueue(error, null);
            throw error;
        } finally {
            this.tokenService.setRefreshInProgress(false);
        }
    }

    // ============================================================================
    // AUTHENTICATED REQUESTS
    // ============================================================================

    /**
     * Make authenticated requests with automatic token refresh
     */
    async authenticatedFetch(url, options = {}) {
        const token = this.tokenService.getAccessToken();
        
        if (!token) {
            throw new Error('No authentication token available');
        }

        // Check if token needs refresh before making request
        if (this.tokenService.needsRefresh(token)) {
            const refreshToken = this.tokenService.getRefreshToken();
            if (refreshToken && !this.tokenService.isRefreshing) {
                try {
                    await this.refreshTokenSilently();
                } catch (refreshError) {
                    throw new Error('Authentication failed - token refresh failed');
                }
            }
        }

        const currentToken = this.tokenService.getAccessToken();
        const config = {
            ...options,
            headers: {
                [this.tokenService.getJWTConfig().headerName]: 
                    `${this.tokenService.getJWTConfig().headerType} ${currentToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...options.headers
            }
        };

        try {
            const response = await fetchWithConfig(url, config);
            
            // Handle 401 with token refresh (but don't create loops)
            if (response.status === 401 && !this.tokenService.isRefreshing) {
                try {
                    await this.refreshTokenSilently();
                    const newToken = this.tokenService.getAccessToken();
                    if (newToken) {
                        config.headers[this.tokenService.getJWTConfig().headerName] = 
                            `${this.tokenService.getJWTConfig().headerType} ${newToken}`;
                        return await fetchWithConfig(url, config);
                    }
                } catch (refreshError) {
                    this.tokenService.clearTokens();
                    throw new Error('Authentication failed');
                }
            }
            
            return response;
        } catch (error) {
            throw error;
        }
    }

    // ============================================================================
    // UTILITY METHODS
    // ============================================================================

    /**
     * Enhanced error message handling
     */
    getErrorMessage(error, statusCode = null) {
        if (!error) return 'An unknown error occurred';
        
        // Handle response data with error field
        if (error.error) return error.error;
        
        // Handle different error types
        const message = error.message || error.toString() || '';
        
        // Handle HTTP status codes
        if (statusCode) {
            switch (statusCode) {
                case 400: return 'Invalid request data';
                case 401: return 'Invalid credentials';
                case 403: return 'Access denied';
                case 404: return 'Service not found';
                case 409: return 'Account already exists';
                case 429: return 'Too many requests. Please try again later.';
                case 500: return 'Server error. Please try again later.';
                default: break;
            }
        }
        
        // Handle specific error patterns
        if (message.includes('AbortError') || message.includes('TimeoutError')) {
            return 'Request timed out. Please try again.';
        }
        
        if (message.includes('fetch') || message.includes('network')) {
            return 'Network error. Please check your connection.';
        }
        
        return message || 'An unexpected error occurred. Please try again.';
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return this.tokenService.hasValidTokens();
    }

    /**
     * Get current user
     */
    getCurrentUser() {
        return this.tokenService.getUser();
    }

    /**
     * Verify token with server
     */
    async verifyTokenWithServer(token = null) {
        const tokenToVerify = token || this.tokenService.getAccessToken();
        if (!tokenToVerify) return false;
        
        return await this.tokenService.verifyTokenWithServer(tokenToVerify, fetchWithConfig);
    }

    /**
     * Wait for initialization (compatibility method)
     */
    async waitForInitialization() {
        // This service doesn't need initialization waiting
        // Method exists for compatibility with existing code
        return Promise.resolve();
    }
}

export default AuthFlowService;