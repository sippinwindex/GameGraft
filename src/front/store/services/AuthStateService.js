// src/front/store/services/AuthStateService.js - Redux Store Integration Service

/**
 * AuthStateService - Focused state management integration
 * Handles Redux/store dispatch integration for authentication
 * Optimized for SSE voting system state synchronization
 */
class AuthStateService {
    constructor(tokenService, authFlowService) {
        this.tokenService = tokenService;
        this.authFlowService = authFlowService;
        this.dispatch = null;
        this.authCheckCompleted = false;
        this.initializationPromise = null;
        this.isInitializing = false;
        
        console.log('🔐 AuthStateService initialized for optimized state management');
    }

    // ============================================================================
    // DISPATCH MANAGEMENT
    // ============================================================================

    /**
     * Set dispatch function and trigger initialization
     */
    setDispatch(dispatch) {
        console.log('✅ AuthStateService dispatch function injected');
        this.dispatch = dispatch;
        
        if (this.isInitializing || this.authCheckCompleted) {
            console.log('🔍 Auth check already in progress or completed, skipping...');
            return this.initializationPromise || Promise.resolve();
        }
        
        if (!this.initializationPromise) {
            this.isInitializing = true;
            this.initializationPromise = this.checkAuthOnStartup()
                .finally(() => {
                    this.isInitializing = false;
                });
        }
        
        return this.initializationPromise;
    }

    /**
     * Check if dispatch is available
     */
    hasDispatch() {
        return !!this.dispatch;
    }

    // ============================================================================
    // STARTUP AUTHENTICATION CHECK
    // ============================================================================

    /**
     * Enhanced startup authentication check
     */
    async checkAuthOnStartup() {
        if (this.authCheckCompleted) {
            console.log('🔍 AuthStateService auth check already completed, skipping...');
            return;
        }
        
        console.log('🔍 AuthStateService starting enhanced auth check on startup...');
        
        if (this.dispatch) {
            this.dispatch({ type: 'set_loading', payload: true });
        }
        
        try {
            const accessToken = this.tokenService.getAccessToken();
            const refreshToken = this.tokenService.getRefreshToken();
            const storedUser = this.tokenService.getUser();
            
            if (accessToken && storedUser && this.tokenService.isValidTokenFormat(accessToken)) {
                console.log('🔍 AuthStateService found valid stored credentials');
                
                // Check if token needs refresh
                if (this.tokenService.needsRefresh(accessToken) && refreshToken) {
                    console.log('🔄 Token needs refresh, attempting...');
                    try {
                        await this.authFlowService.refreshTokenSilently();
                    } catch (refreshError) {
                        console.warn('⚠️ Token refresh failed during startup:', refreshError);
                        this.clearAuth();
                        return;
                    }
                }
                
                // Verify token with server
                try {
                    const isValid = await this.authFlowService.verifyTokenWithServer(accessToken);
                    if (isValid) {
                        this.dispatchLoginSuccess(storedUser, accessToken, refreshToken);
                        this.scheduleTokenRefresh(accessToken);
                    } else {
                        throw new Error('Token verification failed');
                    }
                } catch (verifyError) {
                    console.warn('⚠️ Token verification failed:', verifyError);
                    
                    // Try refresh if available
                    if (refreshToken) {
                        try {
                            await this.authFlowService.refreshTokenSilently();
                            // After successful refresh, dispatch the new state
                            const newToken = this.tokenService.getAccessToken();
                            const newUser = this.tokenService.getUser();
                            this.dispatchLoginSuccess(newUser, newToken, refreshToken);
                        } catch (refreshError) {
                            console.warn('⚠️ Refresh also failed, clearing auth');
                            this.clearAuth();
                        }
                    } else {
                        this.clearAuth();
                    }
                }
            } else {
                console.log('🚫 AuthStateService no valid stored credentials found');
                if (this.dispatch) {
                    this.dispatch({ type: 'logout' });
                }
            }
        } catch (error) {
            console.error('💥 AuthStateService startup check error:', error);
            if (this.dispatch) {
                this.dispatch({ type: 'set_loading', payload: false });
            }
        } finally {
            this.authCheckCompleted = true;
            
            if (this.dispatch) {
                this.dispatch({ type: 'set_loading', payload: false });
            }
            
            console.log('🔍 AuthStateService enhanced auth check completed');
        }
    }

    // ============================================================================
    // STATE DISPATCH HELPERS
    // ============================================================================

    /**
     * Dispatch login success to store
     */
    dispatchLoginSuccess(user, accessToken, refreshToken) {
        if (this.dispatch) {
            this.dispatch({ 
                type: 'login_success',
                payload: { 
                    user, 
                    token: accessToken, 
                    refreshToken 
                }
            });
        }
    }

    /**
     * Dispatch logout to store
     */
    dispatchLogout() {
        if (this.dispatch) {
            this.dispatch({ type: 'logout' });
        }
    }

    /**
     * Dispatch loading state
     */
    dispatchLoading(loading) {
        if (this.dispatch) {
            this.dispatch({ type: 'set_loading', payload: loading });
        }
    }

    /**
     * Dispatch error state
     */
    dispatchError(error) {
        if (this.dispatch) {
            this.dispatch({ type: 'set_error', payload: error });
        }
    }

    /**
     * Dispatch clear error
     */
    dispatchClearError() {
        if (this.dispatch) {
            this.dispatch({ type: 'clear_error' });
        }
    }

    // ============================================================================
    // AUTH STATE MANAGEMENT
    // ============================================================================

    /**
     * Handle successful login with state updates
     */
    async handleLoginSuccess(credentials, remember = false) {
        try {
            this.dispatchLoading(true);
            this.dispatchClearError();
            
            const result = await this.authFlowService.login(credentials, remember);
            
            if (result.success) {
                console.log('✅ AuthStateService login successful');
                
                this.dispatchLoginSuccess(result.user, result.accessToken, result.refreshToken);
                this.scheduleTokenRefresh(result.accessToken);
                
                return { success: true, user: result.user };
            } else {
                console.log('❌ AuthStateService login failed:', result.error);
                this.dispatchError(result.error);
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error('💥 AuthStateService login error:', error);
            this.dispatchError(error.message);
            return { success: false, error: error.message };
        } finally {
            this.dispatchLoading(false);
        }
    }

    /**
     * Handle successful registration with state updates
     */
    async handleRegistration(userData, remember = false) {
        try {
            this.dispatchLoading(true);
            this.dispatchClearError();
            
            const result = await this.authFlowService.register(userData, remember);
            
            if (result.success) {
                console.log('✅ AuthStateService registration successful');
                
                this.dispatchLoginSuccess(result.user, result.accessToken, result.refreshToken);
                this.scheduleTokenRefresh(result.accessToken);
                
                return { success: true, user: result.user };
            } else {
                console.log('❌ AuthStateService registration failed:', result.error);
                this.dispatchError(result.error);
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error('💥 AuthStateService registration error:', error);
            this.dispatchError(error.message);
            return { success: false, error: error.message };
        } finally {
            this.dispatchLoading(false);
        }
    }

    /**
     * Handle logout with state updates
     */
    async handleLogout() {
        try {
            await this.authFlowService.logout();
            this.clearAuth();
            return { success: true };
        } catch (error) {
            console.error('💥 AuthStateService logout error:', error);
            // Even if logout fails, clear local state
            this.clearAuth();
            return { success: false, error: error.message };
        }
    }

    /**
     * Clear authentication state
     */
    clearAuth() {
        console.log('🧹 AuthStateService clearing auth state...');
        
        this.tokenService.clearTokens();
        this.authCheckCompleted = true;
        
        this.dispatchLogout();
        this.dispatchLoading(false);
        
        console.log('🧹 AuthStateService auth cleared successfully');
    }

    // ============================================================================
    // TOKEN REFRESH WITH STATE SYNC
    // ============================================================================

    /**
     * Schedule token refresh with state synchronization
     */
    scheduleTokenRefresh(accessToken) {
        const refreshCallback = async () => {
            try {
                await this.authFlowService.refreshTokenSilently();
                const newToken = this.tokenService.getAccessToken();
                if (newToken && this.dispatch) {
                    this.dispatch({ type: 'set_token', payload: newToken });
                }
            } catch (error) {
                console.error('⚠️ Scheduled token refresh failed:', error);
                this.clearAuth();
            }
        };
        
        this.tokenService.scheduleTokenRefresh(accessToken, refreshCallback);
    }

    /**
     * Handle token refresh with state updates
     */
    async handleTokenRefresh() {
        try {
            const result = await this.authFlowService.refreshTokenSilently();
            if (result.success && this.dispatch) {
                this.dispatch({ type: 'set_token', payload: result.accessToken });
                return { success: true };
            } else {
                throw new Error('Token refresh failed');
            }
        } catch (error) {
            console.error('Token refresh failed:', error);
            this.clearAuth();
            return { success: false, error: error.message };
        }
    }

    // ============================================================================
    // UTILITY METHODS
    // ============================================================================

    /**
     * Wait for initialization to complete
     */
    async waitForInitialization() {
        if (this.authCheckCompleted) {
            return;
        }
        
        if (this.initializationPromise) {
            await this.initializationPromise;
        }
        
        const maxWait = 5000;
        const startTime = Date.now();
        
        while (!this.authCheckCompleted && (Date.now() - startTime < maxWait)) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * Get initialization status
     */
    getInitializationStatus() {
        return {
            authCheckCompleted: this.authCheckCompleted,
            isInitializing: this.isInitializing,
            hasDispatch: this.hasDispatch()
        };
    }

    /**
     * Get auth state summary
     */
    getAuthStateSummary() {
        const tokenStats = this.tokenService.getTokenStats();
        const initStatus = this.getInitializationStatus();
        
        return {
            isAuthenticated: this.authFlowService.isAuthenticated(),
            user: this.tokenService.getUser(),
            tokenStats,
            initStatus,
            hasDispatch: this.hasDispatch()
        };
    }
}

export default AuthStateService;