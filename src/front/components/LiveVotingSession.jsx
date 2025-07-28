// src/front/components/LiveVotingSession.jsx - 🔧 ENHANCED with Steam + SSE Integration

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import authService from '../store/authService';
import { apiUrl } from '../config/environment.js';

// 🔥 FIXED: Import the hook correctly (not the component)
import { useLiveVoting } from '../hooks/useLiveVoting';

const LiveVotingSession = () => {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuth();
    
    // Session state
    const [sessionState, setSessionState] = useState('loading');
    const [sessionData, setSessionData] = useState(null);
    const [error, setError] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    
    // 🚀 NEW: Steam state
    const [steamStatus, setSteamStatus] = useState({
        coverage: { connected: 0, total: 0, percentage: 0 },
        readyForVoting: false,
        commonGamesCount: 0,
        lastSyncUpdate: null,
        syncingMembers: new Set(),
        steamWarnings: [],
        steamNotifications: []
    });
    
    // Voting state
    const [selectedGames, setSelectedGames] = useState([]);
    const [isSubmittingVote, setIsSubmittingVote] = useState(false);
    const [maxChoices, setMaxChoices] = useState(3);
    
    // SSE connection (existing implementation)
    const eventSourceRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const [connectionAttempts, setConnectionAttempts] = useState(0);
    const maxReconnectAttempts = 5;
    
    // Performance monitoring state (preserved)
    const [performanceMetrics, setPerformanceMetrics] = useState({
        connectionTime: null,
        latency: null,
        lastHeartbeat: null,
        messageCount: 0,
        reconnectCount: 0,
        lastConnected: null,
        steamEventCount: 0, // 🚀 NEW: Track Steam events
        lastSteamEvent: null
    });

    // 🚀 Enhanced Live Voting Hook Integration
    const voting = useLiveVoting(sessionId, {
        onAllVotesComplete: (data) => {
            console.log('🎉 All votes complete via hook:', data);
            if (data.autoNavigate) {
                setTimeout(() => {
                    setSessionState('results');
                    setSessionData(prev => ({
                        ...prev,
                        state: 'results',
                        results: data.results,
                        winner: data.results?.[0]
                    }));
                }, 2000);
            }
        },
        onVoteUpdate: (update) => {
            console.log('🗳️ Vote update via hook:', update);
            if (sessionData && sessionData.members_status && update.status === 'voted') {
                setSessionData(prev => ({
                    ...prev,
                    members_status: prev.members_status.map(member =>
                        member.id === update.userId
                            ? { ...member, has_voted: true, status: 'voted' }
                            : member
                    )
                }));
            }
        },
        onMemberUpdate: (memberUpdate) => {
            console.log('👥 Member update via hook:', memberUpdate);
            if (memberUpdate.action === 'joined' || memberUpdate.action === 'left') {
                setSessionData(prev => ({
                    ...prev,
                    members: memberUpdate.members
                }));
                
                // 🚀 Update Steam coverage when members change
                updateSteamCoverage(memberUpdate.members);
            }
        },
        onError: (hookError) => {
            console.error('❌ Live voting hook error:', hookError);
            if (!error) {
                setError(`Live voting error: ${hookError.error}`);
            }
        },
        enableAutoReconnect: true,
        autoNavigateOnComplete: true
    });

    // 🚀 NEW: Steam utility functions
    const updateSteamCoverage = useCallback((members = null) => {
        const membersList = members || sessionData?.members || [];
        const steamMembers = membersList.filter(m => m.steam_connected || m.is_steam_connected);
        const total = membersList.length;
        
        setSteamStatus(prev => ({
            ...prev,
            coverage: {
                connected: steamMembers.length,
                total: total,
                percentage: total > 0 ? (steamMembers.length / total * 100) : 0
            },
            readyForVoting: steamMembers.length >= 2 && prev.commonGamesCount > 0
        }));
    }, [sessionData?.members]);

    const addSteamNotification = useCallback((notification) => {
        setSteamStatus(prev => ({
            ...prev,
            steamNotifications: [
                { id: Date.now(), timestamp: new Date(), ...notification },
                ...prev.steamNotifications.slice(0, 4) // Keep last 5
            ]
        }));
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            setSteamStatus(prev => ({
                ...prev,
                steamNotifications: prev.steamNotifications.filter(n => n.id !== notification.id)
            }));
        }, 5000);
    }, []);

    const updateSyncingStatus = useCallback((userId, isSyncing) => {
        setSteamStatus(prev => {
            const newSyncingMembers = new Set(prev.syncingMembers);
            if (isSyncing) {
                newSyncingMembers.add(userId);
            } else {
                newSyncingMembers.delete(userId);
            }
            return {
                ...prev,
                syncingMembers: newSyncingMembers
            };
        });
    }, []);

    // Enhanced connect function with Steam SSE integration
    const connectToLiveStream = useCallback(() => {
        if (!isAuthenticated || !sessionId) return;
        
        const token = authService.getAccessToken();
        if (!token) {
            setError('Authentication required');
            return;
        }
        
        try {
            const connectStart = performance.now();
            const url = `${apiUrl}/api/live-voting/sessions/${sessionId}/live-stream?token=${encodeURIComponent(token)}`;
            
            console.log('🔗 Connecting to live voting stream:', url);
            
            const eventSource = new EventSource(url);
            eventSourceRef.current = eventSource;
            
            eventSource.onopen = () => {
                const connectTime = performance.now() - connectStart;
                console.log(`✅ Live voting stream connected in ${connectTime.toFixed(2)}ms`);
                setIsConnected(true);
                setConnectionAttempts(0);
                setError(null);
                
                setPerformanceMetrics(prev => ({
                    ...prev,
                    connectionTime: connectTime,
                    lastConnected: new Date().toISOString(),
                    reconnectCount: connectionAttempts
                }));
            };
            
            eventSource.onmessage = (event) => {
                const messageStart = performance.now();
                
                try {
                    const data = JSON.parse(event.data);
                    
                    setPerformanceMetrics(prev => ({
                        ...prev,
                        messageCount: prev.messageCount + 1
                    }));
                    
                    // Handle heartbeat performance tracking
                    if (data.type === 'heartbeat') {
                        const serverTime = data.timestamp * 1000;
                        const latency = Math.abs(performance.now() - serverTime);
                        setPerformanceMetrics(prev => ({
                            ...prev,
                            latency: latency,
                            lastHeartbeat: new Date().toISOString()
                        }));
                        return;
                    }
                    
                    // 🚀 Track Steam events
                    if (data.type.includes('steam')) {
                        setPerformanceMetrics(prev => ({
                            ...prev,
                            steamEventCount: prev.steamEventCount + 1,
                            lastSteamEvent: new Date().toISOString()
                        }));
                    }
                    
                    handleLiveEvent(data);
                    
                    const processTime = performance.now() - messageStart;
                    if (processTime > 50) {
                        console.log(`🐌 Slow SSE message processing: ${processTime.toFixed(2)}ms for ${data.type}`);
                    }
                    
                } catch (error) {
                    console.error('Error parsing SSE message:', error);
                }
            };

            eventSource.onerror = (error) => {
                console.error('❌ Live voting stream error:', error);
                setIsConnected(false);
                
                setPerformanceMetrics(prev => ({
                    ...prev,
                    reconnectCount: prev.reconnectCount + 1
                }));
                
                if (connectionAttempts < maxReconnectAttempts) {
                    const delay = Math.min(1000 * Math.pow(2, connectionAttempts), 30000);
                    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${connectionAttempts + 1})`);
                    
                    reconnectTimeoutRef.current = setTimeout(() => {
                        setConnectionAttempts(prev => prev + 1);
                        connectToLiveStream();
                    }, delay);
                } else {
                    setError('Connection lost. Please refresh the page.');
                }
            };
            
        } catch (error) {
            console.error('Failed to create EventSource:', error);
            setError('Failed to connect to live session');
        }
    }, [isAuthenticated, sessionId, connectionAttempts]);
    
    // 🚀 ENHANCED: Live event handler with Steam integration
    const handleLiveEvent = (data) => {
        console.log('📡 Live event received:', data);
        
        switch (data.type) {
            case 'session_state':
                setSessionData(data);
                setSessionState(data.state || 'unknown');
                if (data.voting_settings) {
                    setMaxChoices(data.voting_settings.max_choices || 3);
                }
                // 🚀 Update Steam status from session data
                if (data.steam_coverage) {
                    setSteamStatus(prev => ({
                        ...prev,
                        coverage: data.steam_coverage,
                        commonGamesCount: data.common_games_count || 0,
                        readyForVoting: data.ready_for_voting || false
                    }));
                }
                break;
                
            case 'state_change':
                setSessionState(data.new_state);
                break;
                
            case 'voting_started':
                setSessionState('voting');
                setSessionData(prev => ({
                    ...prev,
                    state: 'voting',
                    votable_games: data.votable_games,
                    voting_settings: data.voting_settings
                }));
                if (data.voting_settings) {
                    setMaxChoices(data.voting_settings.max_choices || 3);
                }
                
                // 🚀 Start voting session in hook
                if (data.votable_games && data.votable_games.length > 0) {
                    const members = sessionData?.members || [];
                    voting.startVotingSession(members, {
                        gameTitle: sessionData?.session?.session_name,
                        votableGames: data.votable_games,
                        maxChoices: data.voting_settings?.max_choices || 3
                    });
                }
                break;
                
            case 'vote_submitted':
                if (sessionData && sessionData.members_status) {
                    setSessionData(prev => ({
                        ...prev,
                        progress: data.progress,
                        members_status: prev.members_status.map(member =>
                            member.id === data.user_id
                                ? { ...member, has_voted: true, status: 'voted' }
                                : member
                        )
                    }));
                }
                break;
                
            case 'voting_completed':
                setSessionState('results');
                setSessionData(prev => ({
                    ...prev,
                    state: 'results',
                    results: data.final_results,
                    winner: data.winner
                }));
                
                // 🚀 End voting session in hook
                voting.endVotingSession('completed');
                break;

            // 🚀 NEW: Steam SSE event handlers
            case 'steam_sync_started':
                console.log('🎮 Steam sync started:', data);
                updateSyncingStatus(data.user_id, true);
                addSteamNotification({
                    type: 'sync_started',
                    message: `${data.username} is syncing their Steam library...`,
                    icon: '🔄',
                    color: 'text-blue-400'
                });
                break;

            case 'steam_sync_completed':
                console.log('🎮 Steam sync completed:', data);
                updateSyncingStatus(data.user_id, false);
                
                // Update member in session data
                setSessionData(prev => ({
                    ...prev,
                    members: prev.members?.map(member =>
                        member.id === data.user_id
                            ? { 
                                ...member, 
                                total_games: data.total_games,
                                steam_library_synced_at: data.synced_at,
                                steam_connected: true
                            }
                            : member
                    )
                }));
                
                // Update Steam status
                setSteamStatus(prev => ({
                    ...prev,
                    commonGamesCount: data.new_common_games_count || prev.commonGamesCount,
                    lastSyncUpdate: new Date().toISOString()
                }));
                
                addSteamNotification({
                    type: 'sync_completed',
                    message: `${data.username} synced ${data.total_games} games! ${data.new_games_added} new games added.`,
                    icon: '✅',
                    color: 'text-green-400'
                });
                break;

            case 'steam_sync_failed':
                console.log('❌ Steam sync failed:', data);
                updateSyncingStatus(data.user_id, false);
                addSteamNotification({
                    type: 'sync_failed',
                    message: `Steam sync failed for ${data.username}: ${data.error}`,
                    icon: '❌',
                    color: 'text-red-400'
                });
                break;

            case 'steam_coverage_update':
                console.log('📊 Steam coverage update:', data);
                setSteamStatus(prev => ({
                    ...prev,
                    coverage: data.steam_coverage,
                    readyForVoting: data.ready_for_voting,
                    steamWarnings: data.warnings || []
                }));
                break;

            case 'common_games_refreshed':
                console.log('🎯 Common games refreshed:', data);
                setSessionData(prev => ({
                    ...prev,
                    common_games: data.common_games,
                    total_common_games: data.total_games,
                    votable_games: sessionState === 'voting' ? data.common_games : prev.votable_games
                }));
                
                setSteamStatus(prev => ({
                    ...prev,
                    commonGamesCount: data.total_games,
                    readyForVoting: data.total_games > 0 && prev.coverage.connected >= 2
                }));
                
                if (data.total_games > 0) {
                    addSteamNotification({
                        type: 'games_refreshed',
                        message: `Found ${data.total_games} common games after library sync!`,
                        icon: '🎯',
                        color: 'text-cyan-400'
                    });
                }
                break;

            case 'member_joined':
                console.log('👋 Member joined:', data);
                // Update members and Steam coverage
                if (sessionData?.members) {
                    const updatedMembers = [...sessionData.members, {
                        id: data.user_id,
                        username: data.username,
                        steam_connected: data.steam_connected,
                        avatar_url: data.avatar_url
                    }];
                    setSessionData(prev => ({ ...prev, members: updatedMembers }));
                    updateSteamCoverage(updatedMembers);
                }
                
                addSteamNotification({
                    type: 'member_joined',
                    message: `${data.username} joined${data.steam_connected ? ' with Steam connected' : ''}`,
                    icon: '👋',
                    color: data.steam_connected ? 'text-green-400' : 'text-yellow-400'
                });
                break;

            case 'member_left':
                console.log('👋 Member left:', data);
                // Update members and Steam coverage
                if (sessionData?.members) {
                    const updatedMembers = sessionData.members.filter(m => m.id !== data.user_id);
                    setSessionData(prev => ({ ...prev, members: updatedMembers }));
                    updateSteamCoverage(updatedMembers);
                }
                
                addSteamNotification({
                    type: 'member_left',
                    message: `${data.username} left the session`,
                    icon: '👋',
                    color: 'text-gray-400'
                });
                break;
                
            case 'user_connected':
            case 'user_disconnected':
                // Update connection count in UI
                break;
                
            case 'error':
                setError(data.error || 'An error occurred');
                break;
                
            default:
                console.log('Unknown event type:', data.type);
        }
    };
    
    // Initialize connection (preserved)
    useEffect(() => {
        if (isAuthenticated && sessionId) {
            connectToLiveStream();
        }
        
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, [isAuthenticated, sessionId, connectToLiveStream]);

    // 🚀 Update Steam coverage when session data changes
    useEffect(() => {
        if (sessionData?.members) {
            updateSteamCoverage();
        }
    }, [sessionData?.members, updateSteamCoverage]);
    
    // Enhanced start voting with Steam validation
    const startVoting = async () => {
        const startTime = performance.now();
        
        // 🚀 Pre-validate Steam readiness
        if (!steamStatus.readyForVoting) {
            const warnings = [];
            if (steamStatus.coverage.connected < 2) {
                warnings.push(`Need at least 2 Steam-connected members (currently ${steamStatus.coverage.connected})`);
            }
            if (steamStatus.commonGamesCount === 0) {
                warnings.push('No common multiplayer games found');
            }
            
            setError(`Cannot start voting: ${warnings.join(', ')}`);
            return;
        }
        
        try {
            const response = await authService.authenticatedFetch(
                `/api/live-voting/sessions/${sessionId}/start-voting`,
                { method: 'POST' }
            );
            
            const responseTime = performance.now() - startTime;
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to start voting');
            }
            
            console.log(`⚡ Voting started in ${responseTime.toFixed(2)}ms`);
            
            const serverResponseTime = response.headers.get('X-Response-Time');
            if (serverResponseTime) {
                console.log(`📊 Server start voting time: ${serverResponseTime}`);
            }
            
            console.log('✅ Voting started successfully');
        } catch (error) {
            const responseTime = performance.now() - startTime;
            console.error(`❌ Failed to start voting after ${responseTime.toFixed(2)}ms:`, error);
            setError(error.message);
        }
    };
    
    // Enhanced submit vote with performance tracking
    const submitVote = async () => {
        if (selectedGames.length === 0) {
            setError('Please select at least one game');
            return;
        }
        
        if (selectedGames.length > maxChoices) {
            setError(`Please select no more than ${maxChoices} games`);
            return;
        }
        
        setIsSubmittingVote(true);
        setError(null);
        
        const voteStart = performance.now();
        
        try {
            const gameVotes = selectedGames.map((game, index) => ({
                game_id: game.id,
                priority: selectedGames.length - index
            }));
            
            const response = await authService.authenticatedFetch(
                `/api/live-voting/sessions/${sessionId}/submit-vote`,
                {
                    method: 'POST',
                    body: JSON.stringify({ game_votes: gameVotes })
                }
            );
            
            const voteTime = performance.now() - voteStart;
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to submit vote');
            }
            
            const result = await response.json();
            
            console.log(`⚡ Vote submitted in ${voteTime.toFixed(2)}ms`);
            
            const serverResponseTime = response.headers.get('X-Response-Time');
            const serverHealth = response.headers.get('X-Server-Health');
            
            if (serverResponseTime) {
                console.log(`📊 Server processing time: ${serverResponseTime}`);
            }
            
            if (serverHealth && serverHealth !== 'healthy') {
                console.warn(`⚠️ Server health status: ${serverHealth}`);
            }
            
            if (result.performance) {
                console.log('📈 Vote processing performance:', result.performance);
            }
            
            console.log('✅ Vote submitted successfully:', result);
            setSelectedGames([]);
            
        } catch (error) {
            const voteTime = performance.now() - voteStart;
            console.error(`❌ Vote submission failed after ${voteTime.toFixed(2)}ms:`, error);
            setError(error.message);
        } finally {
            setIsSubmittingVote(false);
        }
    };
    
    // Toggle game selection (preserved)
    const toggleGameSelection = (game) => {
        setSelectedGames(prev => {
            const isSelected = prev.find(g => g.id === game.id);
            
            if (isSelected) {
                return prev.filter(g => g.id !== game.id);
            } else if (prev.length < maxChoices) {
                return [...prev, game];
            } else {
                setError(`You can only select ${maxChoices} games`);
                return prev;
            }
        });
    };
    
    // Complete voting with hook integration
    const completeVoting = async () => {
        try {
            const response = await authService.authenticatedFetch(
                `/api/live-voting/sessions/${sessionId}/complete-voting`,
                { method: 'POST' }
            );
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to complete voting');
            }
            
            // 🚀 End voting session in hook
            voting.endVotingSession('manual_completion');
            
            console.log('✅ Voting completed successfully');
        } catch (error) {
            console.error('❌ Failed to complete voting:', error);
            setError(error.message);
        }
    };

    // 🚀 Enhanced navigation handler for hook integration
    const handleNavigateToResults = (data) => {
        console.log('🎯 Navigating to results:', data);
        setSessionState('results');
        setSessionData(prev => ({
            ...prev,
            state: 'results',
            results: data.results,
            winner: data.results?.[0],
            session_completed_at: data.completedAt
        }));
    };
    
    // 🚀 NEW: Steam action handlers
    const handleSteamSync = async (userId = user?.id) => {
        try {
            const response = await authService.authenticatedFetch('/api/steam/sync-library', {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error('Failed to start Steam sync');
            }
            
            addSteamNotification({
                type: 'sync_started',
                message: 'Starting Steam library sync...',
                icon: '🔄',
                color: 'text-blue-400'
            });
            
        } catch (error) {
            setError(`Steam sync failed: ${error.message}`);
        }
    };

    const dismissSteamNotification = (notificationId) => {
        setSteamStatus(prev => ({
            ...prev,
            steamNotifications: prev.steamNotifications.filter(n => n.id !== notificationId)
        }));
    };
    
    // Render loading state with Steam status
    if (sessionState === 'loading') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-white mx-auto mb-4"></div>
                    <h2 className="text-2xl font-bold text-white mb-2">Loading Live Session...</h2>
                    <p className="text-white/70">
                        {isConnected ? 'Connected to live stream' : 'Connecting...'}
                    </p>
                    {/* 🚀 Hook connection status */}
                    {voting.isConnected && (
                        <p className="text-neon-green text-sm mt-2">
                            🎮 Live voting ready
                        </p>
                    )}
                    {/* 🚀 Steam status */}
                    {steamStatus.coverage.total > 0 && (
                        <p className="text-cyan-400 text-sm mt-1">
                            🎯 Steam: {steamStatus.coverage.connected}/{steamStatus.coverage.total} connected
                        </p>
                    )}
                </div>
            </div>
        );
    }
    
    // Render error state (preserved)
    if (error) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center">
                <div className="text-center max-w-md mx-auto p-6">
                    <div className="text-red-400 text-6xl mb-4">⚠️</div>
                    <h2 className="text-2xl font-bold text-white mb-4">Connection Error</h2>
                    <p className="text-white/70 mb-6">{error}</p>
                    <div className="space-x-4">
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold"
                        >
                            Reload Page
                        </button>
                        <button
                            onClick={() => navigate('/dashboard')}
                            className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold"
                        >
                            Back to Dashboard
                        </button>
                    </div>
                </div>
            </div>
        );
    }
    
    // 🚀 Steam Notifications Overlay
    const SteamNotificationsOverlay = () => (
        <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
            {steamStatus.steamNotifications.map((notification) => (
                <div
                    key={notification.id}
                    className="bg-black/80 backdrop-blur-sm border border-white/20 rounded-xl p-4 text-white animate-slide-in-right"
                >
                    <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-3">
                            <span className="text-2xl">{notification.icon}</span>
                            <div>
                                <p className={`font-medium ${notification.color}`}>
                                    {notification.message}
                                </p>
                                <p className="text-xs text-white/60">
                                    {notification.timestamp.toLocaleTimeString()}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => dismissSteamNotification(notification.id)}
                            className="text-white/60 hover:text-white text-sm"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
    
    // Render lobby state with enhanced Steam integration
    if (sessionState === 'lobby' || sessionState === 'planning') {
        return (
            <div>
                <LobbyView
                    sessionData={sessionData}
                    user={user}
                    onStartVoting={startVoting}
                    isConnected={isConnected}
                    performanceMetrics={performanceMetrics}
                    voting={voting}
                    sessionId={sessionId}
                    onNavigateToResults={handleNavigateToResults}
                    steamStatus={steamStatus}
                    onSteamSync={handleSteamSync}
                />
                <SteamNotificationsOverlay />
            </div>
        );
    }
    
    // Render voting state with enhanced Steam integration
    if (sessionState === 'voting') {
        return (
            <div>
                <VotingView
                    sessionData={sessionData}
                    user={user}
                    selectedGames={selectedGames}
                    maxChoices={maxChoices}
                    onToggleGame={toggleGameSelection}
                    onSubmitVote={submitVote}
                    onCompleteVoting={completeVoting}
                    isSubmittingVote={isSubmittingVote}
                    isConnected={isConnected}
                    performanceMetrics={performanceMetrics}
                    voting={voting}
                    sessionId={sessionId}
                    onNavigateToResults={handleNavigateToResults}
                    steamStatus={steamStatus}
                />
                <SteamNotificationsOverlay />
            </div>
        );
    }
    
    // Render results state with enhanced Steam integration
    if (sessionState === 'results' || sessionState === 'completed') {
        return (
            <div>
                <ResultsView
                    sessionData={sessionData}
                    user={user}
                    onBackToDashboard={() => navigate('/dashboard')}
                    isConnected={isConnected}
                    performanceMetrics={performanceMetrics}
                    voting={voting}
                    sessionId={sessionId}
                    steamStatus={steamStatus}
                />
                <SteamNotificationsOverlay />
            </div>
        );
    }
    
    // Unknown state with debug info
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-white mb-4">Unknown Session State</h2>
                <p className="text-white/70 mb-6">Session state: {sessionState}</p>
                <button
                    onClick={() => navigate('/dashboard')}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold"
                >
                    Back to Dashboard
                </button>
            </div>
            <PerformanceDebugPanel 
                performanceMetrics={performanceMetrics} 
                sessionState={sessionState}
                voting={voting}
                steamStatus={steamStatus}
            />
        </div>
    );
};

// 🚀 ENHANCED: Lobby View with Steam Integration
const LobbyView = ({ sessionData, user, onStartVoting, isConnected, performanceMetrics, voting, sessionId, onNavigateToResults, steamStatus, onSteamSync }) => {
    const canStartVoting = sessionData?.can_start_voting && 
                          sessionData?.session?.creator_id === user?.id;
    
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 p-6">
            <div className="max-w-6xl mx-auto">
                {/* Header with enhanced performance metrics */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-white mb-2">
                        🎮 {sessionData?.session?.session_name || 'Gaming Session'}
                    </h1>
                    <div className="flex items-center justify-center space-x-2 text-white/70 flex-wrap">
                        <span>Preparing to vote on games</span>
                        <span>•</span>
                        <div className="flex items-center space-x-2">
                            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                            <span>{isConnected ? '🟢 Live' : '🔴 Disconnected'}</span>
                        </div>
                        {/* 🚀 Hook connection status */}
                        {voting.isConnected && (
                            <>
                                <span>•</span>
                                <span className="text-neon-cyan">🎮 Hook Live</span>
                            </>
                        )}
                        {/* 🚀 Steam status indicator */}
                        <>
                            <span>•</span>
                            <span className={`text-sm ${steamStatus.readyForVoting ? 'text-green-400' : 'text-yellow-400'}`}>
                                🎯 Steam: {steamStatus.coverage.connected}/{steamStatus.coverage.total} ({Math.round(steamStatus.coverage.percentage)}%)
                            </span>
                        </>
                        {performanceMetrics.latency && performanceMetrics.latency < 1000 && (
                            <>
                                <span>•</span>
                                <span className="text-xs">
                                    {Math.round(performanceMetrics.latency)}ms
                                </span>
                            </>
                        )}
                    </div>
                </div>

                {/* 🚀 Steam Readiness Banner */}
                <SteamReadinessBanner 
                    steamStatus={steamStatus}
                    user={user}
                    onSteamSync={onSteamSync}
                    sessionData={sessionData}
                />

                {/* 🚀 Live Voting Status Panel - Import component locally */}
                {voting.isActive && (
                    <LiveVotingStatusPanelLocal 
                        sessionId={sessionId}
                        currentUser={user}
                        onNavigateToResults={onNavigateToResults}
                        showReminders={true}
                        showProgress={true}
                        className="mb-8"
                        voting={voting}
                    />
                )}
                
                {/* Enhanced Members with Steam Status */}
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8">
                    <h2 className="text-2xl font-bold text-white mb-4">
                        👥 Group Members ({sessionData?.members?.length || 0})
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {sessionData?.members?.map(member => (
                            <div key={member.id} className="bg-white/5 rounded-lg p-4 flex items-center space-x-3">
                                <div className="relative">
                                    <img
                                        src={member.avatar_url || '/default-avatar.png'}
                                        alt={member.username}
                                        className="w-10 h-10 rounded-full"
                                    />
                                    {/* 🚀 Steam sync indicator */}
                                    {steamStatus.syncingMembers.has(member.id) && (
                                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full animate-spin flex items-center justify-center">
                                            <span className="text-white text-xs">🔄</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1">
                                    <p className="text-white font-semibold">{member.username}</p>
                                    <div className="flex items-center space-x-2 text-sm">
                                        {member.steam_connected ? (
                                            <span className="text-green-400">🎮 Steam Connected</span>
                                        ) : (
                                            <span className="text-red-400">❌ Steam Not Connected</span>
                                        )}
                                        <span className="text-white/60">
                                            {member.total_games || 0} games
                                        </span>
                                        {/* 🚀 Last sync indicator */}
                                        {member.steam_library_synced_at && (
                                            <span className="text-cyan-400 text-xs">
                                                📅 {new Date(member.steam_library_synced_at).toLocaleDateString()}
                                            </span>
                                        )}
                                        {/* 🚀 Show hook-tracked voting status */}
                                        {voting.isActive && (
                                            <span className={`text-xs px-2 py-1 rounded ${
                                                voting.isUserVoted(member.id) ? 'bg-green-500/20 text-green-400' :
                                                voting.isUserCurrentVoter(member.id) ? 'bg-blue-500/20 text-blue-400' :
                                                'bg-gray-500/20 text-gray-400'
                                            }`}>
                                                {voting.getMemberStatusIcon(member.id)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                
                {/* Enhanced Common Games Preview with Steam Status */}
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-bold text-white">
                            🎯 Common Multiplayer Games ({steamStatus.commonGamesCount})
                        </h2>
                        {steamStatus.lastSyncUpdate && (
                            <span className="text-sm text-cyan-400">
                                Updated {new Date(steamStatus.lastSyncUpdate).toLocaleTimeString()}
                            </span>
                        )}
                    </div>
                    
                    {sessionData?.common_games?.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                            {sessionData.common_games.slice(0, 12).map(game => (
                                <div key={game.id} className="bg-white/5 rounded-lg p-3 text-center hover:bg-white/10 transition-colors">
                                    <img
                                        src={game.header_image || '/game-placeholder.jpg'}
                                        alt={game.name}
                                        className="w-full h-20 object-cover rounded mb-2"
                                    />
                                    <p className="text-white text-sm font-medium truncate">
                                        {game.name}
                                    </p>
                                    {/* 🚀 Game type indicators */}
                                    <div className="flex justify-center space-x-1 mt-1">
                                        {game.multiplayer && <span className="text-xs text-green-400">👥</span>}
                                        {game.co_op && <span className="text-xs text-blue-400">🤝</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <p className="text-white/70 text-lg mb-4">
                                {steamStatus.coverage.connected < 2 
                                    ? `Need at least 2 Steam-connected members (have ${steamStatus.coverage.connected})`
                                    : 'No common multiplayer games found'
                                }
                            </p>
                            <p className="text-white/50">
                                {steamStatus.coverage.connected < 2 
                                    ? 'Ask group members to connect their Steam accounts'
                                    : 'Make sure group members have synced their Steam libraries with public profiles'
                                }
                            </p>
                        </div>
                    )}
                </div>
                
                {/* Enhanced Action Buttons with Steam Validation */}
                <div className="text-center">
                    {canStartVoting ? (
                        <div className="space-y-4">
                            <button
                                onClick={onStartVoting}
                                disabled={!steamStatus.readyForVoting}
                                className={`px-8 py-4 text-white rounded-xl font-bold text-lg transition-colors ${
                                    steamStatus.readyForVoting
                                        ? 'bg-green-600 hover:bg-green-700'
                                        : 'bg-gray-600 cursor-not-allowed'
                                }`}
                            >
                                {steamStatus.readyForVoting ? '🚀 Start Voting' : '⏳ Not Ready to Vote'}
                            </button>
                            
                            {/* 🚀 Steam status warnings */}
                            {!steamStatus.readyForVoting && (
                                <div className="text-yellow-400 text-sm space-y-1">
                                    {steamStatus.coverage.connected < 2 && (
                                        <p>⚠️ Need at least 2 Steam-connected members</p>
                                    )}
                                    {steamStatus.commonGamesCount === 0 && steamStatus.coverage.connected >= 2 && (
                                        <p>⚠️ No common multiplayer games found</p>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-white/70">
                            Waiting for session creator to start voting...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// 🚀 NEW: Steam Readiness Banner Component
const SteamReadinessBanner = ({ steamStatus, user, onSteamSync, sessionData }) => {
    if (steamStatus.readyForVoting) {
        return (
            <div className="bg-green-600/20 border border-green-500 rounded-xl p-6 mb-8">
                <div className="flex items-center justify-center space-x-4">
                    <span className="text-4xl">✅</span>
                    <div className="text-center">
                        <h3 className="text-xl font-bold text-green-400">Steam Ready!</h3>
                        <p className="text-white/80">
                            {steamStatus.coverage.connected} members connected • {steamStatus.commonGamesCount} common games
                        </p>
                    </div>
                    <span className="text-4xl">🎮</span>
                </div>
            </div>
        );
    }

    const currentUserSteamConnected = sessionData?.members?.find(m => m.id === user?.id)?.steam_connected;

    return (
        <div className="bg-yellow-600/20 border border-yellow-500 rounded-xl p-6 mb-8">
            <div className="text-center">
                <h3 className="text-xl font-bold text-yellow-400 mb-3">🎯 Steam Setup Needed</h3>
                
                <div className="grid md:grid-cols-2 gap-6">
                    {/* Steam Coverage Status */}
                    <div className="bg-white/5 rounded-lg p-4">
                        <h4 className="font-semibold text-white mb-2">Member Coverage</h4>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-white/70">Steam Connected</span>
                            <span className={`font-bold ${steamStatus.coverage.connected >= 2 ? 'text-green-400' : 'text-red-400'}`}>
                                {steamStatus.coverage.connected}/{steamStatus.coverage.total}
                            </span>
                        </div>
                        <div className="w-full bg-white/20 rounded-full h-2">
                            <div 
                                className={`h-2 rounded-full transition-all duration-500 ${
                                    steamStatus.coverage.percentage >= 50 ? 'bg-green-500' : 'bg-red-500'
                                }`}
                                style={{ width: `${steamStatus.coverage.percentage}%` }}
                            ></div>
                        </div>
                    </div>

                    {/* Common Games Status */}
                    <div className="bg-white/5 rounded-lg p-4">
                        <h4 className="font-semibold text-white mb-2">Game Library</h4>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-white/70">Common Games</span>
                            <span className={`font-bold ${steamStatus.commonGamesCount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {steamStatus.commonGamesCount}
                            </span>
                        </div>
                        <div className="text-sm text-white/60">
                            {steamStatus.commonGamesCount === 0 && steamStatus.coverage.connected >= 2 
                                ? 'Members need to sync libraries'
                                : steamStatus.coverage.connected < 2 
                                ? 'Need more Steam connections'
                                : 'Games available for voting'
                            }
                        </div>
                    </div>
                </div>

                {/* Action buttons */}
                <div className="mt-4 space-y-2">
                    {!currentUserSteamConnected && (
                        <p className="text-white/80 mb-3">
                            🎮 Connect your Steam account to participate in voting
                        </p>
                    )}
                    
                    {currentUserSteamConnected && (
                        <button
                            onClick={() => onSteamSync(user?.id)}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold"
                        >
                            🔄 Sync My Steam Library
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// Enhanced Voting View with Steam Integration (similar pattern...)
const VotingView = ({ 
    sessionData, user, selectedGames, maxChoices, onToggleGame, onSubmitVote, 
    onCompleteVoting, isSubmittingVote, isConnected, performanceMetrics, voting, 
    sessionId, onNavigateToResults, steamStatus 
}) => {
    const userHasVoted = sessionData?.user_has_voted;
    const canCompleteVoting = sessionData?.session?.creator_id === user?.id;
    
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 p-6">
            <div className="max-w-6xl mx-auto">
                {/* Enhanced Header with Steam Status */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-white mb-2">
                        🗳️ Vote for Your Favorite Games
                    </h1>
                    <div className="flex items-center justify-center space-x-2 text-white/70 flex-wrap">
                        <span>Select up to {maxChoices} games</span>
                        <span>•</span>
                        <div className="flex items-center space-x-2">
                            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                            <span>{isConnected ? '🟢 Live' : '🔴 Disconnected'}</span>
                        </div>
                        {voting.isConnected && (
                            <>
                                <span>•</span>
                                <span className="text-neon-cyan">🎮 Hook Live</span>
                            </>
                        )}
                        {/* 🚀 Steam games indicator */}
                        <>
                            <span>•</span>
                            <span className="text-cyan-400">{steamStatus.commonGamesCount} Steam games</span>
                        </>
                        {voting.isActive && (
                            <>
                                <span>•</span>
                                <span className="text-neon-green">{voting.getProgressPercentage()}% complete</span>
                            </>
                        )}
                    </div>
                    
                    {/* Enhanced Progress Bar with hook data */}
                    <div className="mt-4 max-w-md mx-auto">
                        <div className="bg-white/20 rounded-full h-3">
                            <div
                                className="bg-gradient-to-r from-cyan-400 to-purple-500 h-3 rounded-full transition-all duration-500"
                                style={{ width: `${voting.isActive ? voting.getProgressPercentage() : (sessionData?.progress?.percentage || 0)}%` }}
                            />
                        </div>
                        <p className="text-white/70 text-sm mt-2">
                            {voting.isActive ? `${voting.votedCount} of ${voting.totalCount}` : `${sessionData?.progress?.voted || 0} of ${sessionData?.progress?.total || 0}`} members voted
                        </p>
                    </div>
                </div>

                {/* 🚀 Live Voting Status Panel */}
                {voting.isActive && (
                    <LiveVotingStatusPanelLocal 
                        sessionId={sessionId}
                        currentUser={user}
                        onNavigateToResults={onNavigateToResults}
                        showReminders={true}
                        showProgress={false} // Already showing above
                        className="mb-8"
                        voting={voting}
                    />
                )}
                
                {/* User's Vote Status */}
                {userHasVoted && (
                    <div className="bg-green-600/20 border border-green-500 rounded-xl p-6 mb-8">
                        <h2 className="text-xl font-bold text-green-400 mb-4">✅ Your Vote Submitted</h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {sessionData?.user_votes?.map((vote, index) => (
                                <div key={vote.game.id} className="bg-white/10 rounded-lg p-4 flex items-center space-x-3">
                                    <div className="text-2xl font-bold text-green-400">
                                        #{index + 1}
                                    </div>
                                    <img
                                        src={vote.game.header_image || '/game-placeholder.jpg'}
                                        alt={vote.game.name}
                                        className="w-12 h-12 object-cover rounded"
                                    />
                                    <div>
                                        <p className="text-white font-semibold">{vote.game.name}</p>
                                        <p className="text-white/60 text-sm">{vote.priority} points</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                
                {/* Enhanced Voting Interface with Steam game indicators */}
                {!userHasVoted && (
                    <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8">
                        <h2 className="text-2xl font-bold text-white mb-4">
                            Select Your Games ({selectedGames.length}/{maxChoices})
                        </h2>
                        
                        {/* 🚀 Steam game source indicator */}
                        <div className="mb-4 p-3 bg-cyan-500/20 border border-cyan-400 rounded-lg">
                            <p className="text-cyan-400 text-sm">
                                🎮 Showing {sessionData?.votable_games?.length || 0} multiplayer games from your Steam libraries
                            </p>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
                            {sessionData?.votable_games?.map(game => {
                                const isSelected = selectedGames.find(g => g.id === game.id);
                                const selectionIndex = selectedGames.findIndex(g => g.id === game.id);
                                
                                return (
                                    <div
                                        key={game.id}
                                        onClick={() => onToggleGame(game)}
                                        className={`relative cursor-pointer transition-all duration-200 rounded-lg overflow-hidden ${
                                            isSelected 
                                                ? 'ring-4 ring-cyan-400 scale-105' 
                                                : 'hover:scale-102 hover:ring-2 hover:ring-blue-300'
                                        }`}
                                    >
                                        <img
                                            src={game.header_image || '/game-placeholder.jpg'}
                                            alt={game.name}
                                            className="w-full h-32 object-cover"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                                        
                                        {/* 🚀 Steam game type indicators */}
                                        <div className="absolute top-2 left-2 flex space-x-1">
                                            {game.multiplayer && (
                                                <span className="bg-green-500/80 text-white text-xs px-1 py-0.5 rounded" title="Multiplayer">
                                                    👥
                                                </span>
                                            )}
                                            {game.co_op && (
                                                <span className="bg-blue-500/80 text-white text-xs px-1 py-0.5 rounded" title="Co-op">
                                                    🤝
                                                </span>
                                            )}
                                        </div>
                                        
                                        <div className="absolute bottom-2 left-2 right-2">
                                            <p className="text-white font-semibold text-sm truncate">
                                                {game.name}
                                            </p>
                                        </div>
                                        {isSelected && (
                                            <div className="absolute top-2 right-2 bg-cyan-400 text-black rounded-full w-8 h-8 flex items-center justify-center font-bold">
                                                {selectionIndex + 1}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        
                        <div className="text-center">
                            <button
                                onClick={onSubmitVote}
                                disabled={selectedGames.length === 0 || isSubmittingVote}
                                className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-purple-600 hover:to-cyan-500 disabled:from-gray-600 disabled:to-gray-700 text-white font-bold text-lg rounded-xl transition-all duration-300"
                            >
                                {isSubmittingVote ? (
                                    <>
                                        <span className="animate-spin mr-2">⏳</span>
                                        Submitting Vote...
                                    </>
                                ) : (
                                    `🗳️ Submit Vote (${selectedGames.length} games)`
                                )}
                            </button>
                        </div>
                    </div>
                )}
                
                {/* Enhanced Member Status using hook data when available */}
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8">
                    <h2 className="text-2xl font-bold text-white mb-4">👥 Voting Status</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {(voting.isActive ? voting.members : sessionData?.members_status || []).map(member => (
                            <div key={member.id} className="bg-white/5 rounded-lg p-4 text-center">
                                <div className="relative mx-auto w-12 h-12 mb-2">
                                    <img
                                        src={member.avatar_url || '/default-avatar.png'}
                                        alt={member.username}
                                        className="w-12 h-12 rounded-full"
                                    />
                                    {/* 🚀 Steam connection indicator */}
                                    {member.steam_connected && (
                                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                                            <span className="text-white text-xs">🎮</span>
                                        </div>
                                    )}
                                </div>
                                <p className="text-white font-semibold text-sm">{member.username}</p>
                                <div className="mt-2">
                                    {voting.isActive ? (
                                        <span className={`text-xs px-2 py-1 rounded-full ${voting.getMemberStatusColor(member.id)}`}>
                                            {voting.getMemberStatusIcon(member.id)} {voting.getUserStatus(member.id).toUpperCase()}
                                        </span>
                                    ) : member.has_voted ? (
                                        <span className="text-green-400 text-xs">✅ Voted</span>
                                    ) : (
                                        <span className="text-yellow-400 text-xs">⏳ Voting...</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                
                {/* Admin Controls */}
                {canCompleteVoting && (
                    <div className="text-center">
                        <button
                            onClick={onCompleteVoting}
                            className="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold"
                        >
                            🏁 Complete Voting Early
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// Enhanced Results View with Steam Integration
const ResultsView = ({ sessionData, user, onBackToDashboard, isConnected, performanceMetrics, voting, sessionId, steamStatus }) => {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 p-6">
            <div className="max-w-4xl mx-auto">
                {/* Enhanced Header */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-white mb-2">
                        🏆 Voting Results
                    </h1>
                    <div className="flex items-center justify-center space-x-2 text-white/70 flex-wrap">
                        <span>The votes are in!</span>
                        <span>•</span>
                        <div className="flex items-center space-x-2">
                            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                            <span>{isConnected ? '🟢 Live' : '🔴 Disconnected'}</span>
                        </div>
                        {/* 🚀 Steam session stats */}
                        <>
                            <span>•</span>
                            <span className="text-cyan-400">🎮 {steamStatus.coverage.connected} Steam users voted</span>
                        </>
                        {sessionData?.session_completed_at && (
                            <>
                                <span>•</span>
                                <span className="text-xs">
                                    Completed {new Date(sessionData.session_completed_at).toLocaleTimeString()}
                                </span>
                            </>
                        )}
                    </div>
                </div>

                {/* 🚀 Final Live Voting Status (show completion celebration) */}
                {voting.allVotesComplete && (
                    <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-8 mb-8 text-center border-2 border-green-500">
                        <div className="flex items-center justify-center space-x-4 mb-4">
                            <span className="text-6xl animate-bounce">🎉</span>
                            <div>
                                <h2 className="text-3xl font-bold text-green-400">
                                    Voting Complete!
                                </h2>
                                <p className="text-cyan-400">
                                    All {voting.totalCount} members voted • {steamStatus.commonGamesCount} Steam games considered
                                </p>
                            </div>
                            <span className="text-6xl animate-bounce" style={{ animationDelay: '0.2s' }}>🚀</span>
                        </div>
                    </div>
                )}
                
                {/* Enhanced Winner Section with Steam Game Details */}
                {sessionData?.winner && (
                    <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500 rounded-xl p-8 mb-8 text-center">
                        <div className="text-6xl mb-4">🥇</div>
                        <h2 className="text-3xl font-bold text-yellow-400 mb-2">Winner!</h2>
                        <img
                            src={sessionData.winner.game.header_image || '/game-placeholder.jpg'}
                            alt={sessionData.winner.game.name}
                            className="w-64 h-32 object-cover rounded-lg mx-auto mb-4"
                        />
                        <h3 className="text-2xl font-bold text-white mb-2">
                            {sessionData.winner.game.name}
                        </h3>
                        <div className="flex items-center justify-center space-x-4 text-white/70 mb-4">
                            <span>{sessionData.winner.total_points} points</span>
                            <span>•</span>
                            <span>{sessionData.winner.vote_count} votes</span>
                            {/* 🚀 Steam game type indicators */}
                            {sessionData.winner.game.multiplayer && (
                                <>
                                    <span>•</span>
                                    <span className="text-green-400">👥 Multiplayer</span>
                                </>
                            )}
                            {sessionData.winner.game.co_op && (
                                <>
                                    <span>•</span>
                                    <span className="text-blue-400">🤝 Co-op</span>
                                </>
                            )}
                        </div>
                        
                        {/* 🚀 Steam launch suggestion */}
                        <div className="bg-white/10 rounded-lg p-4 mt-4">
                            <p className="text-cyan-400 font-semibold mb-2">🎮 Ready to Play?</p>
                            <p className="text-white/80 text-sm">
                                This game is available in everyone's Steam library. Time to launch and play together!
                            </p>
                        </div>
                    </div>
                )}

                {/* Enhanced Full Results with Steam Integration */}
                {sessionData?.results && sessionData.results.length > 1 && (
                    <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8">
                        <h2 className="text-2xl font-bold text-white mb-4">📊 Full Results</h2>
                        <div className="space-y-4">
                            {sessionData.results.map((result, index) => (
                                <div key={result.game.id} className={`flex items-center space-x-4 p-4 rounded-lg ${
                                    index === 0 ? 'bg-yellow-500/20 border border-yellow-500' :
                                    index === 1 ? 'bg-gray-400/20 border border-gray-400' :
                                    index === 2 ? 'bg-orange-600/20 border border-orange-600' :
                                    'bg-white/5'
                                }`}>
                                    {/* Ranking */}
                                    <div className="text-2xl font-bold">
                                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                                    </div>
                                    
                                    {/* Game Image */}
                                    <img
                                        src={result.game.header_image || '/game-placeholder.jpg'}
                                        alt={result.game.name}
                                        className="w-16 h-16 object-cover rounded"
                                    />
                                    
                                    {/* Game Details */}
                                    <div className="flex-1">
                                        <h3 className="text-white font-semibold">{result.game.name}</h3>
                                        <div className="flex items-center space-x-2 text-sm text-white/70">
                                            <span>{result.total_points} points</span>
                                            <span>•</span>
                                            <span>{result.vote_count} votes</span>
                                            {/* 🚀 Steam game indicators */}
                                            {result.game.multiplayer && <span className="text-green-400">👥</span>}
                                            {result.game.co_op && <span className="text-blue-400">🤝</span>}
                                        </div>
                                    </div>
                                    
                                    {/* Vote percentage */}
                                    <div className="text-right">
                                        <div className="text-white font-bold">
                                            {Math.round((result.vote_count / (sessionData?.progress?.total || 1)) * 100)}%
                                        </div>
                                        <div className="w-20 bg-white/20 rounded-full h-2 mt-1">
                                            <div
                                                className="bg-gradient-to-r from-cyan-400 to-purple-500 h-2 rounded-full transition-all duration-500"
                                                style={{ width: `${(result.vote_count / (sessionData?.progress?.total || 1)) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 🚀 Session Statistics with Steam Integration */}
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8">
                    <h2 className="text-2xl font-bold text-white mb-4">📈 Session Statistics</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white/5 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-cyan-400">{sessionData?.progress?.total || 0}</div>
                            <div className="text-white/70 text-sm">Total Voters</div>
                        </div>
                        <div className="bg-white/5 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-green-400">{steamStatus.coverage.connected}</div>
                            <div className="text-white/70 text-sm">Steam Users</div>
                        </div>
                        <div className="bg-white/5 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-purple-400">{steamStatus.commonGamesCount}</div>
                            <div className="text-white/70 text-sm">Games Available</div>
                        </div>
                        <div className="bg-white/5 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-yellow-400">{sessionData?.results?.length || 0}</div>
                            <div className="text-white/70 text-sm">Games Voted On</div>
                        </div>
                    </div>
                </div>
                
                {/* Action Buttons */}
                <div className="text-center space-x-4">
                    <button
                        onClick={onBackToDashboard}
                        className="px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold text-lg rounded-xl transition-all duration-300"
                    >
                        🏠 Back to Dashboard
                    </button>
                    <button
                        onClick={() => window.print()}
                        className="px-8 py-4 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-bold text-lg rounded-xl transition-all duration-300"
                    >
                        🖨️ Print Results
                    </button>
                    {/* 🚀 Steam launch button for winner */}
                    {sessionData?.winner && (
                        <button
                            onClick={() => window.open(`steam://run/${sessionData.winner.game.steam_appid}`, '_blank')}
                            className="px-8 py-4 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-bold text-lg rounded-xl transition-all duration-300"
                        >
                            🚀 Launch {sessionData.winner.game.name}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// Local Live Voting Status Panel (simplified version)
const LiveVotingStatusPanelLocal = ({ 
    sessionId, 
    currentUser, 
    onNavigateToResults,
    className = "",
    showReminders = true,
    showProgress = true,
    voting
}) => {
    if (!voting.isActive) {
        return null;
    }

    return (
        <div className={`bg-white/10 backdrop-blur-sm rounded-3xl p-6 mb-6 ${className}`}>
            {/* Header with connection status */}
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-white">
                    🎮 Live Voting Session
                </h3>
                <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                        voting.isConnected ? 'bg-green-400 animate-pulse' : 
                        voting.isReconnecting ? 'bg-yellow-400 animate-pulse' : 
                        'bg-red-500'
                    }`}></div>
                    <span className={`text-sm font-medium ${
                        voting.isConnected ? 'text-green-400' : 
                        voting.isReconnecting ? 'text-yellow-400' : 
                        'text-red-400'
                    }`}>
                        {voting.isConnected ? 'Live' : 
                         voting.isReconnecting ? 'Reconnecting...' : 
                         'Disconnected'}
                    </span>
                </div>
            </div>

            {/* Enhanced Progress Bar */}
            {showProgress && (
                <div className="mb-6">
                    <div className="flex justify-between text-sm text-cyan-400 mb-2">
                        <span className="font-medium">Voting Progress</span>
                        <span>
                            {voting.votedCount} / {voting.totalCount} completed ({voting.getProgressPercentage()}%)
                        </span>
                    </div>
                    <div className="w-full bg-white/20 rounded-full h-3 overflow-hidden">
                        <div 
                            className="bg-gradient-to-r from-cyan-400 to-purple-500 h-3 rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${voting.progress}%` }}
                        ></div>
                    </div>
                </div>
            )}

            {/* Enhanced Members Status Grid */}
            <div className="space-y-4">
                <h4 className="text-lg font-semibold text-cyan-400">
                    👥 Member Status
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {voting.members.map((member, index) => {
                        const status = voting.getUserStatus(member.id);
                        const isCurrentUser = member.id === currentUser?.id;
                        const statusIcon = voting.getMemberStatusIcon(member.id);
                        const statusColor = voting.getMemberStatusColor(member.id);
                        
                        return (
                            <div 
                                key={member.id}
                                className={`bg-white/5 rounded-xl p-4 transition-all duration-300 ${
                                    isCurrentUser ? 'ring-2 ring-cyan-400' : ''
                                }`}
                                style={{ animationDelay: `${index * 0.1}s` }}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-3">
                                        <div className="relative">
                                            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-gray-600 to-gray-700 flex items-center justify-center text-sm font-bold">
                                                {member.username.charAt(0).toUpperCase()}
                                            </div>
                                            {/* 🚀 Steam indicator */}
                                            {member.steam_connected && (
                                                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
                                                    <span className="text-white text-xs">🎮</span>
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <span className={`font-medium ${isCurrentUser ? 'text-cyan-400' : 'text-white'}`}>
                                                {member.username}
                                            </span>
                                            {isCurrentUser && (
                                                <span className="text-xs text-cyan-400 ml-2">(You)</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <span className="text-lg">{statusIcon}</span>
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${statusColor} ${
                                            status === 'voted' ? 'bg-green-500/20 border-green-500' :
                                            status === 'voting' ? 'bg-cyan-400/20 border-cyan-400' :
                                            status === 'pending' ? 'bg-yellow-400/20 border-yellow-400' :
                                            'bg-gray-600/20 border-gray-500'
                                        }`}>
                                            {status === 'voted' ? 'VOTED' :
                                             status === 'voting' ? 'VOTING...' :
                                             status === 'pending' ? 'PENDING' :
                                             'WAITING'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* All Votes Complete Celebration */}
            {voting.allVotesComplete && (
                <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-2xl p-6 border-2 border-green-500">
                    <div className="flex items-center justify-center space-x-4">
                        <span className="text-4xl animate-bounce">🎉</span>
                        <div className="text-center">
                            <h4 className="text-xl font-bold text-green-400">
                                All Votes Complete!
                            </h4>
                            <p className="text-cyan-400">
                                Navigating to results...
                            </p>
                        </div>
                        <span className="text-4xl animate-bounce" style={{ animationDelay: '0.2s' }}>🚀</span>
                    </div>
                </div>
            )}

            {/* Enhanced Error Display */}
            {voting.error && (
                <div className="mt-6 bg-white/5 rounded-2xl p-4 border border-red-500/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <span className="text-red-400 text-xl">⚠️</span>
                            <div>
                                <p className="text-red-400 font-medium">{voting.error.error}</p>
                                {voting.error.details && (
                                    <p className="text-red-300 text-sm">{voting.error.details}</p>
                                )}
                            </div>
                        </div>
                        {voting.reconnect && (
                            <button 
                                onClick={voting.reconnect}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-all duration-300"
                            >
                                Reconnect
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Voting Reminders Panel */}
            {showReminders && !voting.allVotesComplete && voting.pendingCount > 0 && (
                <div className="mt-6 bg-white/5 rounded-2xl p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <span className="text-yellow-400">🔔</span>
                            <span className="text-sm text-yellow-400">
                                {voting.pendingCount} member{voting.pendingCount > 1 ? 's' : ''} still need to vote
                            </span>
                        </div>
                        <button 
                            onClick={() => voting.sendVotingReminder && voting.sendVotingReminder('gentle')}
                            className="px-3 py-1 bg-yellow-400/20 hover:bg-yellow-400/30 text-yellow-400 rounded-lg text-xs font-medium transition-all duration-300"
                        >
                            Send Reminder
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// Enhanced Performance Debug Panel with Steam metrics
const PerformanceDebugPanel = ({ performanceMetrics, sessionState, voting, steamStatus, className = "" }) => {
    const showDebug = process.env.NODE_ENV === 'development' || 
                     localStorage.getItem('debug_performance') === 'true';
    
    if (!showDebug) return null;
    
    return (
        <div className={`fixed bottom-4 right-4 bg-black/80 text-white p-3 rounded-lg text-xs max-w-xs border border-gray-600 ${className}`}>
            <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-yellow-400">🔧 Performance</h4>
                <button
                    onClick={() => localStorage.removeItem('debug_performance')}
                    className="text-gray-400 hover:text-white text-xs"
                >
                    ✕
                </button>
            </div>
            <div className="space-y-1 text-gray-300">
                <div className="flex justify-between">
                    <span>State:</span>
                    <span className="text-blue-400">{sessionState}</span>
                </div>
                {/* 🚀 Hook status */}
                <div className="flex justify-between">
                    <span>Hook:</span>
                    <span className={voting.isConnected ? 'text-green-400' : 'text-red-400'}>
                        {voting.isConnected ? 'Connected' : 'Disconnected'}
                    </span>
                </div>
                {voting.isActive && (
                    <div className="flex justify-between">
                        <span>Progress:</span>
                        <span className="text-cyan-400">{voting.getProgressPercentage()}%</span>
                    </div>
                )}
                {/* 🚀 Steam metrics */}
                <div className="flex justify-between">
                    <span>Steam:</span>
                    <span className="text-cyan-400">
                        {steamStatus.coverage.connected}/{steamStatus.coverage.total}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span>Games:</span>
                    <span className="text-purple-400">{steamStatus.commonGamesCount}</span>
                </div>
                {performanceMetrics.connectionTime && (
                    <div className="flex justify-between">
                        <span>Connect:</span>
                        <span>{performanceMetrics.connectionTime.toFixed(0)}ms</span>
                    </div>
                )}
                {performanceMetrics.latency && (
                    <div className="flex justify-between">
                        <span>Latency:</span>
                        <span className={performanceMetrics.latency > 500 ? 'text-red-400' : 'text-green-400'}>
                            {performanceMetrics.latency.toFixed(0)}ms
                        </span>
                    </div>
                )}
                <div className="flex justify-between">
                    <span>Events:</span>
                    <span>{performanceMetrics.messageCount}</span>
                </div>
                {/* 🚀 Steam events counter */}
                {performanceMetrics.steamEventCount > 0 && (
                    <div className="flex justify-between">
                        <span>Steam Events:</span>
                        <span className="text-cyan-400">{performanceMetrics.steamEventCount}</span>
                    </div>
                )}
                {performanceMetrics.reconnectCount > 0 && (
                    <div className="flex justify-between">
                        <span>Reconnects:</span>
                        <span className="text-yellow-400">{performanceMetrics.reconnectCount}</span>
                    </div>
                )}
                {/* 🚀 Steam sync status */}
                {steamStatus.syncingMembers.size > 0 && (
                    <div className="flex justify-between">
                        <span>Syncing:</span>
                        <span className="text-blue-400">{steamStatus.syncingMembers.size}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LiveVotingSession;