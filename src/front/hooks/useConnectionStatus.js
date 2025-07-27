// src/front/hooks/useConnectionStatus.js - Connection Status Monitoring
import { useState, useEffect, useCallback } from 'react';

/**
 * Connection status monitoring hook
 * Separated from auth for better performance in SSE components
 */
const useConnectionStatus = () => {
    const [connectionStatus, setConnectionStatus] = useState({
        isOnline: navigator.onLine,
        lastCheck: Date.now(),
        apiReachable: true
    });

    // Monitor online/offline status
    useEffect(() => {
        const handleOnline = () => {
            console.log('🌐 Connection restored');
            setConnectionStatus(prev => ({ 
                ...prev, 
                isOnline: true, 
                lastCheck: Date.now() 
            }));
        };

        const handleOffline = () => {
            console.log('📴 Connection lost');
            setConnectionStatus(prev => ({ 
                ...prev, 
                isOnline: false, 
                lastCheck: Date.now() 
            }));
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Periodic API reachability check
    useEffect(() => {
        if (!connectionStatus.isOnline) return;

        const checkApiReachability = async () => {
            try {
                const response = await fetch('/api/health', { 
                    method: 'GET',
                    signal: AbortSignal.timeout(5000)
                });
                
                const isReachable = response.ok;
                setConnectionStatus(prev => ({ 
                    ...prev, 
                    apiReachable: isReachable,
                    lastCheck: Date.now()
                }));
                
                if (!isReachable) {
                    console.warn('⚠️ API not reachable');
                }
            } catch (error) {
                console.warn('⚠️ API reachability check failed:', error);
                setConnectionStatus(prev => ({ 
                    ...prev, 
                    apiReachable: false,
                    lastCheck: Date.now()
                }));
            }
        };

        // Check immediately and then every 30 seconds
        checkApiReachability();
        const interval = setInterval(checkApiReachability, 30000);

        return () => clearInterval(interval);
    }, [connectionStatus.isOnline]);

    const isConnected = useCallback(() => {
        return connectionStatus.isOnline && connectionStatus.apiReachable;
    }, [connectionStatus]);

    const isOffline = useCallback(() => {
        return !connectionStatus.isOnline;
    }, [connectionStatus]);

    const isServerUnreachable = useCallback(() => {
        return connectionStatus.isOnline && !connectionStatus.apiReachable;
    }, [connectionStatus]);

    const getConnectionQuality = useCallback(() => {
        if (!connectionStatus.isOnline) return 'offline';
        if (!connectionStatus.apiReachable) return 'server_unreachable';
        
        // Could add latency testing here for more detailed quality assessment
        return 'good';
    }, [connectionStatus]);

    const getLastCheckAge = useCallback(() => {
        return Date.now() - connectionStatus.lastCheck;
    }, [connectionStatus.lastCheck]);

    return {
        ...connectionStatus,
        isConnected: isConnected(),
        isOffline: isOffline(),
        isServerUnreachable: isServerUnreachable(),
        connectionQuality: getConnectionQuality(),
        lastCheckAge: getLastCheckAge()
    };
};

export default useConnectionStatus;