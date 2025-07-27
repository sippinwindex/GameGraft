// src/front/hooks/useAuthFlow.js - Authentication Flow Management
import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useGlobalReducer from './useGlobalReducer';
import authService from '../store/authService';

/**
 * Authentication flow management hook
 * Handles login, register, logout flows
 */
const useAuthFlow = () => {
    const { dispatch } = useGlobalReducer();
    const navigate = useNavigate();
    const location = useLocation();

    const getErrorMessage = useCallback((error) => {
        if (!error) return 'An unknown error occurred';
        
        const message = error.message || error.toString() || '';
        
        // Authentication-specific errors
        if (message.includes('Invalid credentials')) {
            return 'Invalid email/username or password. Please check your credentials and try again.';
        }
        
        if (message.includes('rate_limit') || message.includes('too many')) {
            return 'Too many login attempts. Please wait a few minutes before trying again.';
        }
        
        if (message.includes('Account is deactivated')) {
            return 'Your account has been deactivated. Please contact support for assistance.';
        }
        
        if (message.includes('email already exists')) {
            return 'An account with this email already exists. Try logging in instead.';
        }
        
        if (message.includes('username already taken')) {
            return 'This username is already taken. Please choose a different one.';
        }
        
        if (message.includes('timeout') || message.includes('AbortError')) {
            return 'Request timed out. Please check your connection and try again.';
        }
        
        if (message.includes('network') || message.includes('fetch')) {
            return 'Network error. Please check your internet connection and try again.';
        }
        
        return message || 'An unexpected error occurred. Please try again.';
    }, []);

    const login = useCallback(async (credentials, remember = false) => {
        console.log('🔐 useAuthFlow.login called');
        
        try {
            dispatch({ type: 'set_loading', payload: true });
            dispatch({ type: 'clear_error' });
            
            const result = await authService.login(credentials, remember);
            
            if (result.success) {
                console.log('✅ Login successful in useAuthFlow');
                
                // Navigate after state is properly updated
                setTimeout(() => {
                    const intendedPath = location.state?.from?.pathname || '/dashboard';
                    navigate(intendedPath, { replace: true });
                }, 100);
                
                return { success: true, user: result.user };
            } else {
                console.log('❌ Login failed in useAuthFlow:', result.error);
                dispatch({ 
                    type: 'set_error', 
                    payload: result.error 
                });
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error('💥 Login error in useAuthFlow:', error);
            const errorMessage = getErrorMessage(error);
            dispatch({ 
                type: 'set_error', 
                payload: errorMessage 
            });
            return { success: false, error: errorMessage };
        } finally {
            dispatch({ type: 'set_loading', payload: false });
        }
    }, [dispatch, navigate, location.state, getErrorMessage]);

    const register = useCallback(async (userData, remember = false) => {
        console.log('📝 useAuthFlow.register called');
        
        try {
            dispatch({ type: 'set_loading', payload: true });
            dispatch({ type: 'clear_error' });
            
            const result = await authService.register(userData, remember);
            
            if (result.success) {
                console.log('✅ Registration successful in useAuthFlow');
                
                // Navigate after state update
                setTimeout(() => {
                    navigate('/dashboard', { replace: true });
                }, 100);
                
                return { success: true, user: result.user };
            } else {
                console.log('❌ Registration failed in useAuthFlow:', result.error);
                dispatch({ 
                    type: 'set_error', 
                    payload: result.error 
                });
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error('💥 Registration error in useAuthFlow:', error);
            const errorMessage = getErrorMessage(error);
            dispatch({ 
                type: 'set_error', 
                payload: errorMessage 
            });
            return { success: false, error: errorMessage };
        } finally {
            dispatch({ type: 'set_loading', payload: false });
        }
    }, [dispatch, navigate, getErrorMessage]);

    const logout = useCallback(async () => {
        console.log('🚪 useAuthFlow.logout called');
        
        try {
            await authService.logout();
            
            // Clear any errors and navigate to home
            dispatch({ type: 'clear_error' });
            navigate('/', { replace: true });
            
            return { success: true };
        } catch (error) {
            console.error('💥 Logout error in useAuthFlow:', error);
            // Even if logout fails, clear local state
            dispatch({ type: 'logout' });
            navigate('/', { replace: true });
            return { success: false, error: error.message };
        }
    }, [dispatch, navigate]);

    const refreshUserProfile = useCallback(async () => {
        try {
            const response = await authService.authenticatedFetch('/api/auth/profile');
            
            if (response.ok) {
                const data = await response.json();
                dispatch({
                    type: 'set_user',
                    payload: data.user
                });
                return { success: true, user: data.user };
            } else {
                throw new Error('Failed to refresh user profile');
            }
        } catch (error) {
            console.error('Error refreshing user profile:', error);
            return { success: false, error: error.message };
        }
    }, [dispatch]);

    return {
        login,
        register,
        logout,
        refreshUserProfile
    };
};

export default useAuthFlow;