import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth'; // Assuming useAuth provides token and user info

export const useSteam = () => {
    const [games, setGames] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [syncStatus, setSyncStatus] = useState({ connected: false });
    const { store } = useAuth(); // Get auth state from useAuth
    const token = store.token;
    const backendUrl = import.meta.env.VITE_BACKEND_URL;

    const fetchGames = useCallback(async () => {
        if (!token) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`${backendUrl}/api/steam/owned-games`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to fetch games.');
            }
            const data = await response.json();
            setGames(data.games || []);
        } catch (err) {
            setError(err.message || 'Failed to load games.');
            console.error('Error fetching games:', err);
        } finally {
            setIsLoading(false);
        }
    }, [token, backendUrl]);

    const checkSteamStatus = useCallback(async () => {
        if (!token) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`${backendUrl}/api/steam_proxy/status`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to check Steam status.');
            }
            const data = await response.json();
            setSyncStatus(data.user_connection);
            if (data.user_connection.connected) {
                fetchGames();
            }
        } catch (err) {
            setError(err.message || 'Failed to check Steam status.');
            console.error('Error checking Steam status:', err);
        } finally {
            setIsLoading(false);
        }
    }, [token, backendUrl, fetchGames]);

    useEffect(() => {
        checkSteamStatus();
    }, [checkSteamStatus]);

    const connectSteam = useCallback(async () => {
        if (!token) {
            setError('Authentication required to connect Steam.');
            return;
        }
        try {
            const response = await fetch(`${backendUrl}/api/auth/steam/login`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to initiate Steam login.');
            }
            const data = await response.json();
            if (data.steam_auth_url) {
                window.location.href = data.steam_auth_url;
            } else {
                throw new Error('No Steam auth URL received.');
            }
        } catch (err) {
            setError(err.message || 'Error connecting to Steam.');
            console.error('Error initiating Steam login:', err);
        }
    }, [token, backendUrl]);

    const disconnectSteam = useCallback(async () => {
        if (!token) {
            setError('Authentication required to disconnect Steam.');
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`${backendUrl}/api/auth/steam/disconnect`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to disconnect Steam.');
            }
            setSteamId(null); // Assuming steamId is part of syncStatus or managed elsewhere
            setSyncStatus({ connected: false });
            setGames([]); // Clear games on disconnect
        } catch (err) {
            setError(err.message || 'Error disconnecting from Steam.');
            console.error('Error disconnecting Steam:', err);
        } finally {
            setIsLoading(false);
        }
    }, [token, backendUrl]);

    return {
        games,
        isLoading,
        error,
        syncStatus,
        actions: {
            connectSteam,
            disconnectSteam,
            fetchGames, // Expose fetchGames for manual refresh if needed
            checkSteamStatus // Expose checkSteamStatus for manual refresh if needed
        }
    };
};


