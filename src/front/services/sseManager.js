// src/front/services/sseManager.js - FIXED VERSION with proper useSSEManager export

import authService from '../store/authService';
import { useRef, useState, useEffect } from 'react';

/**
 * Enhanced SSE Manager for reliable real-time connections
 * Handles connection management, reconnection logic, heartbeat monitoring, and error recovery
 * FIXED: Now properly exports useSSEManager hook that components expect
 */
class SSEManager {
    constructor(endpoint, options = {}) {
        this.endpoint = endpoint;
        this.options = {
            maxRetries: 5,
            retryDelay: 3000,
            heartbeatTimeout: 60000,
            reconnectMultiplier: 1.3,
            maxReconnectDelay: 45000,
            enableLogging: true,
            autoReconnect: true,
            connectionTimeout: 15000,
            ...options
        };
        
        // Connection state
        this.eventSource = null;
        this.retryCount = 0;
        this.isConnected = false;
        this.isReconnecting = false;
        this.isDestroyed = false;
        this.lastHeartbeat = null;
        this.connectionId = Math.random().toString(36).substr(2, 9);
        this.connectionStartTime = null;
        
        // Event handling
        this.listeners = new Map();
        this.messageQueue = [];
        this.connectionAttempts = 0;
        
        // Timers
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.healthCheckTimer = null;
        this.connectionTimeoutTimer = null;
        
        // Bind methods to preserve context
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.scheduleReconnect = this.scheduleReconnect.bind(this);
        this.checkHeartbeat = this.checkHeartbeat.bind(this);
        this.handleOpen = this.handleOpen.bind(this);
        this.handleMessage = this.handleMessage.bind(this);
        this.handleError = this.handleError.bind(this);
        
        this.log('SSE Manager initialized', { endpoint, options: this.options });
    }
    
    connect() {
        if (this.isDestroyed) {
            this.log('Cannot connect - manager is destroyed', 'warn');
            return;
        }
        
        const token = authService.getAccessToken();
        if (!token) {
            this.log('No auth token available', 'error');
            this.emit('authError', { message: 'No authentication token' });
            return;
        }
        
        if (this.isConnected || this.isReconnecting) {
            this.log('Connection already active or reconnecting', 'warn');
            return;
        }
        
        this.connectionAttempts++;
        this.connectionStartTime = Date.now();
        this.isReconnecting = true;
        this.clearTimers();
        
        try {
            // Build URL with authentication
            const url = new URL(this.endpoint, window.location.origin);
            url.searchParams.set('token', token);
            url.searchParams.set('connection_id', this.connectionId);
            url.searchParams.set('client', 'web');
            url.searchParams.set('version', '1.0');
            
            this.log(`Connecting to SSE (attempt ${this.connectionAttempts})...`);
            
            this.eventSource = new EventSource(url.toString());
            
            // Set up event handlers
            this.eventSource.onopen = this.handleOpen;
            this.eventSource.onmessage = this.handleMessage;
            this.eventSource.onerror = this.handleError;
            
            // Add connection timeout
            this.connectionTimeoutTimer = setTimeout(() => {
                if (this.isReconnecting && !this.isConnected) {
                    this.log('Connection timeout reached', 'warn');
                    this.handleConnectionFailure(new Error('Connection timeout'));
                }
            }, this.options.connectionTimeout);
            
            // Start health monitoring
            this.startHealthMonitoring();
            
        } catch (error) {
            this.log('Failed to create EventSource', 'error', error);
            this.handleConnectionFailure(error);
        }
    }
    
    handleOpen(event) {
        const connectionTime = Date.now() - this.connectionStartTime;
        
        this.log(`SSE connected successfully in ${connectionTime}ms`, 'success');
        
        this.isConnected = true;
        this.isReconnecting = false;
        this.retryCount = 0;
        this.lastHeartbeat = Date.now();
        
        this.clearReconnectTimer();
        
        setTimeout(() => {
            if (this.isConnected) {
                this.startHeartbeatMonitor();
            }
        }, 2000);
        
        this.emit('connected', { 
            connectionId: this.connectionId,
            endpoint: this.endpoint,
            connectionTime,
            attempt: this.connectionAttempts
        });
        
        this.processMessageQueue();
    }
    
    handleMessage(event) {
        try {
            this.lastHeartbeat = Date.now();
            
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (parseError) {
                this.log('Failed to parse message data', 'warn', parseError);
                this.emit('parseError', { 
                    error: parseError, 
                    rawData: event.data 
                });
                return;
            }
            
            this.log('Received message', 'debug', data);
            
            // Handle different message types
            if (data.type === 'heartbeat') {
                this.emit('heartbeat', { 
                    timestamp: data.timestamp || this.lastHeartbeat,
                    connectionId: this.connectionId
                });
                return;
            }
            
            if (data.type === 'error') {
                this.log('Server error message', 'error', data);
                this.emit('serverError', data);
                return;
            }
            
            if (data.type === 'auth_error') {
                this.log('Authentication error from server', 'error', data);
                this.emit('authError', data);
                this.disconnect();
                return;
            }
            
            // Regular data message
            this.emit('message', data);
            
        } catch (error) {
            this.log('Error processing message', 'error', error);
        }
    }
    
    handleError(error) {
        this.log('SSE connection error', 'error', error);
        
        const timeSinceConnection = Date.now() - (this.connectionStartTime || 0);
        
        if (timeSinceConnection < 1000) {
            this.log('Ignoring error within 1s of connection (possible browser quirk)', 'warn');
            return;
        }
        
        this.isConnected = false;
        this.isReconnecting = false;
        this.stopHeartbeatMonitor();
        
        this.emit('disconnected', {
            reason: 'connection_error',
            retryCount: this.retryCount,
            connectionId: this.connectionId,
            timeSinceConnection
        });
        
        this.emit('error', { 
            error,
            retryCount: this.retryCount,
            willRetry: this.retryCount < this.options.maxRetries,
            timeSinceConnection
        });
        
        if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
            this.eventSource.close();
            this.eventSource = null;
        }
        
        if (this.options.autoReconnect && !this.isDestroyed) {
            this.scheduleReconnect();
        }
    }
    
    handleConnectionFailure(error) {
        this.log('Connection failure', 'error', error);
        
        this.isConnected = false;
        this.isReconnecting = false;
        
        this.emit('connectionError', { error });
        this.emit('error', {
            message: error.message || 'Failed to establish connection',
            retryCount: this.retryCount,
            willRetry: this.retryCount < this.options.maxRetries
        });
        
        if (this.options.autoReconnect && !this.isDestroyed) {
            this.scheduleReconnect();
        }
    }
    
    disconnect() {
        this.log('Disconnecting SSE');
        
        this.isConnected = false;
        this.isReconnecting = false;
        this.clearTimers();
        
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        
        this.emit('disconnected', { 
            reason: 'manual_disconnect',
            connectionId: this.connectionId,
            wasConnected: this.isConnected 
        });
    }
    
    scheduleReconnect() {
        if (this.retryCount >= this.options.maxRetries) {
            this.log('Max reconnection attempts reached', 'error');
            this.emit('maxRetriesReached', { 
                retryCount: this.retryCount,
                maxRetries: this.options.maxRetries,
                totalAttempts: this.connectionAttempts
            });
            return;
        }
        
        this.retryCount++;
        
        const baseDelay = this.options.retryDelay;
        const multiplier = Math.pow(this.options.reconnectMultiplier, this.retryCount - 1);
        const delay = Math.min(baseDelay * multiplier, this.options.maxReconnectDelay);
        
        this.log(`Scheduling reconnect attempt ${this.retryCount} in ${delay}ms`);
        
        this.emit('reconnectScheduled', { 
            delay, 
            retryCount: this.retryCount,
            maxRetries: this.options.maxRetries 
        });
        
        this.reconnectTimer = setTimeout(() => {
            if (!this.isConnected && !this.isDestroyed) {
                this.log(`Attempting reconnect ${this.retryCount}/${this.options.maxRetries}`);
                this.connect();
            }
        }, delay);
    }
    
    startHeartbeatMonitor() {
        this.stopHeartbeatMonitor();
        
        this.heartbeatTimer = setInterval(() => {
            this.checkHeartbeat();
        }, 10000);
    }
    
    stopHeartbeatMonitor() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    
    checkHeartbeat() {
        if (!this.isConnected || !this.lastHeartbeat) return;
        
        const timeSinceHeartbeat = Date.now() - this.lastHeartbeat;
        const warningThreshold = this.options.heartbeatTimeout * 0.8;
        
        if (timeSinceHeartbeat > warningThreshold && timeSinceHeartbeat <= this.options.heartbeatTimeout) {
            this.log(`Heartbeat warning (${timeSinceHeartbeat}ms since last heartbeat)`, 'warn');
        } else if (timeSinceHeartbeat > this.options.heartbeatTimeout) {
            this.log(`Heartbeat timeout (${timeSinceHeartbeat}ms since last heartbeat)`, 'warn');
            this.emit('heartbeatTimeout', { 
                timeSinceHeartbeat,
                timeout: this.options.heartbeatTimeout 
            });
            
            if (timeSinceHeartbeat > this.options.heartbeatTimeout * 1.5) {
                this.handleHeartbeatTimeout();
            }
        }
    }
    
    handleHeartbeatTimeout() {
        this.log('Heartbeat timeout detected, forcing reconnection', 'warn');
        
        this.disconnect();
        
        if (this.options.autoReconnect && !this.isDestroyed) {
            this.scheduleReconnect();
        }
    }
    
    startHealthMonitoring() {
        this.stopHealthMonitoring();
        
        this.healthCheckTimer = setInterval(() => {
            if (this.isConnected && this.eventSource) {
                if (this.eventSource.readyState === EventSource.CLOSED) {
                    this.log('EventSource closed unexpectedly', 'warn');
                    this.handleError(new Event('unexpected_close'));
                }
            }
        }, 30000);
    }
    
    stopHealthMonitoring() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }
    
    clearTimers() {
        this.clearReconnectTimer();
        this.stopHeartbeatMonitor();
        this.stopHealthMonitoring();
        
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
            this.connectionTimeoutTimer = null;
        }
    }
    
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    
    // Event management methods
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
        
        return () => this.off(event, callback);
    }
    
    off(event, callback) {
        if (this.listeners.has(event)) {
            const callbacks = this.listeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }
    
    removeAllListeners(event) {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }
    
    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    this.log(`Error in event listener for ${event}`, 'error', error);
                }
            });
        }
    }
    
    queueMessage(message) {
        this.messageQueue.push({
            message,
            timestamp: Date.now()
        });
        
        if (this.messageQueue.length > 100) {
            this.messageQueue.shift();
        }
    }
    
    processMessageQueue() {
        if (this.messageQueue.length > 0) {
            this.log(`Processing ${this.messageQueue.length} queued messages`);
            
            this.messageQueue.forEach(({ message }) => {
                this.emit('message', message);
            });
            
            this.messageQueue = [];
        }
    }
    
    getStatus() {
        return {
            isConnected: this.isConnected,
            isReconnecting: this.isReconnecting,
            isDestroyed: this.isDestroyed,
            retryCount: this.retryCount,
            maxRetries: this.options.maxRetries,
            lastHeartbeat: this.lastHeartbeat,
            connectionId: this.connectionId,
            connectionAttempts: this.connectionAttempts,
            endpoint: this.endpoint,
            queuedMessages: this.messageQueue.length,
            uptime: this.connectionStartTime ? Date.now() - this.connectionStartTime : 0
        };
    }
    
    getStats() {
        return this.getStatus();
    }
    
    forceReconnect() {
        this.log('Force reconnection requested');
        this.retryCount = 0;
        this.disconnect();
        setTimeout(() => this.connect(), 1000);
    }
    
    updateOptions(newOptions) {
        this.options = { ...this.options, ...newOptions };
        this.log('Options updated', 'info', this.options);
    }
    
    destroy() {
        this.log('Destroying SSE Manager');
        
        this.isDestroyed = true;
        this.disconnect();
        this.removeAllListeners();
        this.clearTimers();
        this.messageQueue = [];
        
        this.emit('destroyed');
    }
    
    log(message, level = 'info', data = null) {
        if (!this.options.enableLogging) return;
        
        const prefix = `[SSE Manager]`;
        const timestamp = new Date().toISOString();
        
        switch (level) {
            case 'error':
                console.error(`${prefix} ${timestamp} ❌`, message, data || '');
                break;
            case 'warn':
                console.warn(`${prefix} ${timestamp} ⚠️`, message, data || '');
                break;
            case 'success':
                console.log(`${prefix} ${timestamp} ✅`, message, data || '');
                break;
            case 'debug':
                console.debug(`${prefix} ${timestamp} 🔍`, message, data || '');
                break;
            default:
                console.log(`${prefix} ${timestamp} ℹ️`, message, data || '');
        }
    }
}

// Factory function to create SSE manager instances
export function createSSEManager(endpoint, options = {}) {
    return new SSEManager(endpoint, options);
}

// 🔥 FIXED: Hook for React components that your code expects
export function useSSEManager(endpoint, options = {}) {
    const managerRef = useRef(null);
    const [status, setStatus] = useState({
        isConnected: false,
        isReconnecting: false,
        retryCount: 0,
        error: null
    });
    
    useEffect(() => {
        if (!endpoint) return;
        
        const manager = new SSEManager(endpoint, options);
        managerRef.current = manager;
        
        // Set up status listeners
        const unsubscribers = [
            manager.on('connected', () => {
                setStatus(prev => ({ ...prev, isConnected: true, error: null }));
            }),
            manager.on('disconnected', () => {
                setStatus(prev => ({ ...prev, isConnected: false }));
            }),
            manager.on('reconnectScheduled', (data) => {
                setStatus(prev => ({ 
                    ...prev, 
                    isReconnecting: true, 
                    retryCount: data.retryCount 
                }));
            }),
            manager.on('error', (data) => {
                setStatus(prev => ({ 
                    ...prev, 
                    error: data.error?.message || data.message || 'Connection error',
                    retryCount: data.retryCount 
                }));
            }),
            manager.on('maxRetriesReached', () => {
                setStatus(prev => ({ 
                    ...prev, 
                    isReconnecting: false,
                    error: 'Max reconnection attempts reached' 
                }));
            })
        ];
        
        // Start connection
        manager.connect();
        
        // Cleanup
        return () => {
            unsubscribers.forEach(unsub => unsub());
            manager.destroy();
        };
    }, [endpoint]);
    
    return {
        manager: managerRef.current,
        status,
        forceReconnect: () => managerRef.current?.forceReconnect(),
        disconnect: () => managerRef.current?.disconnect()
    };
}

export default SSEManager;