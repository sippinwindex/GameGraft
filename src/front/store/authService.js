// src/front/store/authService.js - REFACTORED MAIN COORDINATOR (180 lines vs 800)

import TokenService from './services/TokenService.js';
import AuthFlowService from './services/AuthFlowService.js';
import AuthStateService from './services/AuthStateService.js';

/**
 * AuthService - Main coordinator for authentication
 * REFACTORED: Reduced from 800 lines to ~180 lines (75% reduction)
 * 
 * Now delegates to focused services:
 * - TokenService: JWT management
 * - AuthFlowService: Login/logout/register flows  
 * - AuthStateService: Store integration
 * 
 * Optimized for SSE voting system performance
 */
class AuthService {
    constructor() {
        // Initialize focused services
        this.tokenService = new TokenService();
        this.authFlowService = new AuthFlowService(this.tokenService);
        this.authStateService = new AuthStateService(this.tokenService, this.authFlowService);
        
        console.log('🔐 Enhanced AuthService initialized with focused services');
    }

    // ============================================================================
    // DISPATCH AND INITIALIZATION (delegated to AuthStateService)
    // ============================================================================

    setDispatch(dispatch) {
        return this.authStateService.setDispatch(dispatch);
    }

    get authCheckCompleted() {
        return this.authStateService.authCheckCompleted;
    }

    get isRefreshing() {
        return this.tokenService.isRefreshing;
    }

    get dispatch() {
        return this.authStateService.dispatch;
    }

    async waitForInitialization() {
        return await this.authStateService.waitForInitialization();
    }

    // ============================================================================
    // CORE AUTHENTICATION FLOWS (delegated to AuthFlowService)
    // ============================================================================

    async login(credentials, remember = false) {
        return await this.authStateService.handleLoginSuccess(credentials, remember);
    }

    async register(userData, remember = false) {
        return await this.authStateService.handleRegistration(userData, remember);
    }

    async logout() {
        return await this.authStateService.handleLogout();
    }

    async refreshTokenSilently() {
        return await this.authStateService.handleTokenRefresh();
    }

    async authenticatedFetch(url, options = {}) {
        return await this.authFlowService.authenticatedFetch(url, options);
    }

    // ============================================================================
    // TOKEN MANAGEMENT (delegated to TokenService)
    // ============================================================================

    getAccessToken() {
        return this.tokenService.getAccessToken();
    }

    getRefreshToken() {
        return this.tokenService.getRefreshToken();
    }

    getUser() {
        return this.tokenService.getUser();
    }

    getCurrentUser() {
        return this.tokenService.getUser();
    }

    parseJWT(token) {
        return this.tokenService.parseJWT(token);
    }

    isValidTokenFormat(token) {
        return this.tokenService.isValidTokenFormat(token);
    }

    needsRefresh(token) {
        return this.tokenService.needsRefresh(token);
    }

    getTokenExpiry(token) {
        return this.tokenService.getTokenExpiry(token);
    }

    setTokens(accessToken, refreshToken, user, remember = false) {
        return this.tokenService.setTokens(accessToken, refreshToken, user, remember);
    }

    scheduleTokenRefresh(accessToken) {
        const refreshCallback = async () => {
            try {
                await this.authStateService.handleTokenRefresh();
            } catch (error) {
                console.error('⚠️ Scheduled token refresh failed:', error);
                this.clearAuth();
            }
        };
        
        this.tokenService.scheduleTokenRefresh(accessToken, refreshCallback);
    }

    // ============================================================================
    // AUTHENTICATION STATE (delegated to services)
    // ============================================================================

    isAuthenticated() {
        return this.authFlowService.isAuthenticated();
    }

    clearAuth() {
        this.authStateService.clearAuth();
    }

    // ============================================================================
    // UTILITY METHODS (simplified)
    // ============================================================================

    getErrorMessage(error, statusCode = null) {
        return this.authFlowService.getErrorMessage(error, statusCode);
    }

    async verifyTokenWithServer(token = null) {
        return await this.authFlowService.verifyTokenWithServer(token);
    }

    getApiUrl() {
        // Simple method for compatibility - avoid import.meta.env in Node.js
        if (typeof window !== 'undefined') {
            return import.meta.env?.VITE_BACKEND_URL || 'https://bookish-funicular-9754qgjjg9743pqr7-3001.app.github.dev';
        }
        return 'https://bookish-funicular-9754qgjjg9743pqr7-3001.app.github.dev';
    }

    // ============================================================================
    // BACKWARD COMPATIBILITY METHODS
    // ============================================================================

    /**
     * Backward compatibility for existing components
     * These methods delegate to the focused services
     */

    // User profile methods
    async refreshUserProfile() {
        const response = await this.authenticatedFetch('/api/auth/profile');
        if (response.ok) {
            const data = await response.json();
            const accessToken = this.getAccessToken();
            const refreshToken = this.getRefreshToken();
            const remember = !!localStorage.getItem(this.tokenService.tokenKey);
            this.tokenService.setTokens(accessToken, refreshToken, data.user, remember);
            return { success: true, user: data.user };
        }
        return { success: false, error: 'Failed to refresh user profile' };
    }

    // Token info method for hooks
    getTokenInfo(token = null) {
        return this.tokenService.getTokenInfo(token);
    }

    // Queue management (for compatibility)
    processQueue(error, token = null) {
        this.tokenService.processQueue(error, token);
    }

    get failedQueue() {
        return this.tokenService.failedQueue;
    }

    // Clear methods
    clearUserData() {
        this.tokenService.clearUserData();
    }

    // Configuration methods
    get jwtConfig() {
        return this.tokenService.getJWTConfig();
    }
}

// Create singleton instance for backward compatibility
const authService = new AuthService();

export default authService;
export { AuthService };