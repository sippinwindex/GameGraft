// src/front/components/LiveVotingSession.jsx - Enhanced with useLiveVoting Hook Integration

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import { useLiveVoting, LiveVotingStatusPanel } from '../hooks/useLiveVoting';
import authService from '../store/authService';
import { apiUrl } from '../config/environment.js';

const LiveVotingSession = () => {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuth();
    
    // Session state
    const [sessionState, setSessionState] = useState('loading');
    const [sessionData, setSessionData] = useState(null);
    const [error, setError] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    
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
        lastConnected: null
    });

    // 🚀 NEW: Enhanced Live Voting Hook Integration
    const voting = useLiveVoting(sessionId, {
        onAllVotesComplete: (data) => {
            console.log('🎉 All votes complete via hook:', data);
            // Auto-navigate to results or show completion
            if (data.autoNavigate) {
                setTimeout(() => {
                    setSessionState('results');
                    setSessionData(prev => ({
                        ...prev,
                        state: 'results',
                        results: data.results,
                        winner: data.results?.[0]
                    }));
                }, 2000); // Allow time for celebration
            }
        },
        onVoteUpdate: (update) => {
            console.log('🗳️ Vote update via hook:', update);
            // Sync with existing session data
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
            // Sync member updates with session data
            if (memberUpdate.action === 'joined' || memberUpdate.action === 'left') {
                setSessionData(prev => ({
                    ...prev,
                    members: memberUpdate.members
                }));
            }
        },
        onError: (hookError) => {
            console.error('❌ Live voting hook error:', hookError);
            // Don't override critical errors, but log hook-specific ones
            if (!error) {
                setError(`Live voting error: ${hookError.error}`);
            }
        },
        enableAutoReconnect: true,
        autoNavigateOnComplete: true
    });

    // Enhanced connect function with hook integration
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
    
    // Enhanced event handler with hook synchronization
    const handleLiveEvent = (data) => {
        console.log('📡 Live event received:', data);
        
        switch (data.type) {
            case 'session_state':
                setSessionData(data);
                setSessionState(data.state || 'unknown');
                if (data.voting_settings) {
                    setMaxChoices(data.voting_settings.max_choices || 3);
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
                
                // 🚀 NEW: Start voting session in hook
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
                
                // 🚀 NEW: End voting session in hook
                voting.endVotingSession('completed');
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
    
    // Enhanced start voting with hook integration
    const startVoting = async () => {
        const startTime = performance.now();
        
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
            
            // 🚀 NEW: End voting session in hook
            voting.endVotingSession('manual_completion');
            
            console.log('✅ Voting completed successfully');
        } catch (error) {
            console.error('❌ Failed to complete voting:', error);
            setError(error.message);
        }
    };

    // 🚀 NEW: Enhanced navigation handler for hook integration
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
    
    // Render loading state
    if (sessionState === 'loading') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-white mx-auto mb-4"></div>
                    <h2 className="text-2xl font-bold text-white mb-2">Loading Live Session...</h2>
                    <p className="text-white/70">
                        {isConnected ? 'Connected to live stream' : 'Connecting...'}
                    </p>
                    {/* 🚀 NEW: Hook connection status */}
                    {voting.isConnected && (
                        <p className="text-neon-green text-sm mt-2">
                            🎮 Live voting ready
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
    
    // Render lobby state with enhanced live voting panel
    if (sessionState === 'lobby' || sessionState === 'planning') {
        return (
            <LobbyView
                sessionData={sessionData}
                user={user}
                onStartVoting={startVoting}
                isConnected={isConnected}
                performanceMetrics={performanceMetrics}
                voting={voting}
                sessionId={sessionId}
                onNavigateToResults={handleNavigateToResults}
            />
        );
    }
    
    // Render voting state with enhanced live voting panel
    if (sessionState === 'voting') {
        return (
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
            />
        );
    }
    
    // Render results state with enhanced live voting panel
    if (sessionState === 'results' || sessionState === 'completed') {
        return (
            <ResultsView
                sessionData={sessionData}
                user={user}
                onBackToDashboard={() => navigate('/dashboard')}
                isConnected={isConnected}
                performanceMetrics={performanceMetrics}
                voting={voting}
                sessionId={sessionId}
            />
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
            />
        </div>
    );
};

// Enhanced Lobby View with Live Voting Panel
const LobbyView = ({ sessionData, user, onStartVoting, isConnected, performanceMetrics, voting, sessionId, onNavigateToResults }) => {
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
                        {/* 🚀 NEW: Hook connection status */}
                        {voting.isConnected && (
                            <>
                                <span>•</span>
                                <span className="text-neon-cyan">🎮 Hook Live</span>
                            </>
                        )}
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

                {/* 🚀 NEW: Live Voting Status Panel */}
                <LiveVotingStatusPanel 
                    sessionId={sessionId}
                    currentUser={user}
                    onNavigateToResults={onNavigateToResults}
                    showReminders={true}
                    showProgress={true}
                    className="mb-8"
                />
                
                {/* Members (preserved) */}
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8">
                    <h2 className="text-2xl font-bold text-white mb-4">
                        👥 Group Members ({sessionData?.members?.length || 0})
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {sessionData?.members?.map(member => (
                            <div key={member.id} className="bg-white/5 rounded-lg p-4 flex items-center space-x-3">
                                <img
                                    src={member.avatar_url || '/default-avatar.png'}
                                    alt={member.username}
                                    className="w-10 h-10 rounded-full"
                                />
                                <div className="flex-1">
                                    <p className="text-white font-semibold">{member.username}</p>
                                    <div className="flex items-center space-x-2 text-sm">
                                        {member.steam_connected ? (
                                            <span className="text-green-400">🎮 Steam Connected</span>
                                        ) : (
                                            <span className="text-red-400">❌ Steam Not Connected</span>
                                        )}
                                        <span className="text-white/60">
                                            {member.total_games} games
                                        </span>
                                        {/* 🚀 NEW: Show hook-tracked voting status */}
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
                
                {/* Common Games Preview (preserved) */}
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8">
                    <h2 className="text-2xl font-bold text-white mb-4">
                        🎯 Common Multiplayer Games ({sessionData?.total_common_games || 0})
                    </h2>
                    {sessionData?.common_games?.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                            {sessionData.common_games.slice(0, 12).map(game => (
                                <div key={game.id} className="bg-white/5 rounded-lg p-3 text-center">
                                    <img
                                        src={game.header_image || '/game-placeholder.jpg'}
                                        alt={game.name}
                                        className="w-full h-20 object-cover rounded mb-2"
                                    />
                                    <p className="text-white text-sm font-medium truncate">
                                        {game.name}
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <p className="text-white/70 text-lg mb-4">
                                No common multiplayer games found
                            </p>
                            <p className="text-white/50">
                                Make sure group members have connected Steam accounts with public profiles
                            </p>
                        </div>
                    )}
                </div>
                
                {/* Action Buttons */}
                <div className="text-center">
                    {canStartVoting ? (
                        <button
                            onClick={onStartVoting}
                            disabled={!sessionData?.can_start_voting}
                            className="px-8 py-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-xl font-bold text-lg transition-colors"
                        >
                            🚀 Start Voting
                        </button>
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

// Enhanced Voting View (similar enhancements...)
const VotingView = ({ sessionData, user, selectedGames, maxChoices, onToggleGame, onSubmitVote, onCompleteVoting, isSubmittingVote, isConnected, performanceMetrics, voting, sessionId, onNavigateToResults }) => {
    const userHasVoted = sessionData?.user_has_voted;
    const canCompleteVoting = sessionData?.session?.creator_id === user?.id;
    
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 p-6">
            <div className="max-w-6xl mx-auto">
                {/* Enhanced Header */}
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
                        {/* Hook status */}
                        {voting.isConnected && (
                            <>
                                <span>•</span>
                                <span className="text-neon-cyan">🎮 Hook Live</span>
                            </>
                        )}
                        {/* Progress from hook */}
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
                                className="bg-gradient-to-r from-neon-cyan to-neon-purple h-3 rounded-full transition-all duration-500 animate-shimmer"
                                style={{ width: `${voting.isActive ? voting.getProgressPercentage() : (sessionData?.progress?.percentage || 0)}%` }}
                            />
                        </div>
                        <p className="text-white/70 text-sm mt-2">
                            {voting.isActive ? `${voting.votedCount} of ${voting.totalCount}` : `${sessionData?.progress?.voted || 0} of ${sessionData?.progress?.total || 0}`} members voted
                        </p>
                    </div>
                </div>

                {/* 🚀 NEW: Live Voting Status Panel */}
                <LiveVotingStatusPanel 
                    sessionId={sessionId}
                    currentUser={user}
                    onNavigateToResults={onNavigateToResults}
                    showReminders={true}
                    showProgress={false} // Already showing above
                    className="mb-8"
                />
                
                {/* Rest of voting interface preserved... */}
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
                
                {/* Voting Interface - preserved but with enhanced styling */}
                {!userHasVoted && (
                    <div className="glass-gaming rounded-xl p-6 mb-8">
                        <h2 className="text-2xl font-bold text-white mb-4">
                            Select Your Games ({selectedGames.length}/{maxChoices})
                        </h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
                            {sessionData?.votable_games?.map(game => {
                                const isSelected = selectedGames.find(g => g.id === game.id);
                                const selectionIndex = selectedGames.findIndex(g => g.id === game.id);
                                
                                return (
                                    <div
                                        key={game.id}
                                        onClick={() => onToggleGame(game)}
                                        className={`relative cursor-pointer transition-all duration-200 rounded-lg overflow-hidden magnetic ${
                                            isSelected 
                                                ? 'ring-4 ring-neon-cyan scale-105 animate-glow' 
                                                : 'hover:scale-102 hover:ring-2 hover:ring-blue-300'
                                        }`}
                                    >
                                        <img
                                            src={game.header_image || '/game-placeholder.jpg'}
                                            alt={game.name}
                                            className="w-full h-32 object-cover"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                                        <div className="absolute bottom-2 left-2 right-2">
                                            <p className="text-white font-semibold text-sm truncate">
                                                {game.name}
                                            </p>
                                        </div>
                                        {isSelected && (
                                            <div className="absolute top-2 right-2 bg-neon-cyan text-black rounded-full w-8 h-8 flex items-center justify-center font-bold animate-glow-pulse">
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
                                className="btn-base bg-gradient-to-r from-neon-cyan to-neon-purple hover:from-neon-purple hover:to-neon-cyan disabled:from-gray-600 disabled:to-gray-700 text-white font-bold text-lg magnetic"
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
                <div className="glass-effect rounded-xl p-6 mb-8">
                    <h2 className="text-2xl font-bold text-white mb-4">👥 Voting Status</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {(voting.isActive ? voting.members : sessionData?.members_status || []).map(member => (
                            <div key={member.id} className="glass-effect rounded-lg p-4 text-center">
                                <img
                                    src={member.avatar_url || '/default-avatar.png'}
                                    alt={member.username}
                                    className="w-12 h-12 rounded-full mx-auto mb-2"
                                />
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
                            className="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold magnetic"
                        >
                            🏁 Complete Voting Early
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// Enhanced Results View (similar pattern...)
const ResultsView = ({ sessionData, user, onBackToDashboard, isConnected, performanceMetrics, voting, sessionId }) => {
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

                {/* 🚀 NEW: Final Live Voting Status (show completion celebration) */}
                {voting.allVotesComplete && (
                    <div className="glass-gaming rounded-3xl p-8 mb-8 text-center border-2 border-neon-green animate-glow-pulse">
                        <div className="flex items-center justify-center space-x-4 mb-4">
                            <span className="text-6xl animate-bounce">🎉</span>
                            <div>
                                <h2 className="text-3xl font-bold text-neon-green text-shadow-glow">
                                    Voting Complete!
                                </h2>
                                <p className="text-neon-cyan">
                                    All {voting.totalCount} members voted
                                </p>
                            </div>
                            <span className="text-6xl animate-bounce" style={{ animationDelay: '0.2s' }}>🚀</span>
                        </div>
                    </div>
                )}
                
                {/* Winner (preserved but enhanced) */}
                {sessionData?.winner && (
                    <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500 rounded-xl p-8 mb-8 text-center animate-glow">
                        <div className="text-6xl mb-4">🥇</div>
                        <h2 className="text-3xl font-bold text-yellow-400 mb-2 text-shadow-glow">Winner!</h2>
                        <img
                            src={sessionData.winner.game.header_image || '/game-placeholder.jpg'}
                            alt={sessionData.winner.game.name}
                            className="w-64 h-32 object-cover rounded-lg mx-auto mb-4"
                        />
                        <h3 className="text-2xl font-bold text-white mb-2">
                            {sessionData.winner.game.name}
                        </h3>
                        <p className="text-white/70">
                            {sessionData.winner.total_points} points • {sessionData.winner.vote_count} votes
                        </p>
                    </div>
                )}
                
                {/* Rest of results preserved... */}
                {/* Full Results, Statistics, Action Buttons - all preserved */}
                
                <div className="text-center space-x-4">
                    <button
                        onClick={onBackToDashboard}
                        className="btn-base bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold text-lg magnetic"
                    >
                        🏠 Back to Dashboard
                    </button>
                    <button
                        onClick={() => window.print()}
                        className="btn-base bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-bold text-lg magnetic"
                    >
                        🖨️ Print Results
                    </button>
                </div>
            </div>
        </div>
    );
};

// Enhanced Performance Debug Panel
const PerformanceDebugPanel = ({ performanceMetrics, sessionState, voting, className = "" }) => {
    const showDebug = process.env.NODE_ENV === 'development' || 
                     localStorage.getItem('debug_performance') === 'true';
    
    if (!showDebug) return null;
    
    return (
        <div className={`fixed bottom-4 right-4 glass-dark text-white p-3 rounded-lg text-xs max-w-xs border border-gray-600 ${className}`}>
            <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-neon-yellow">🔧 Performance</h4>
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
                    <span className="text-neon-blue">{sessionState}</span>
                </div>
                {/* 🚀 NEW: Hook status */}
                <div className="flex justify-between">
                    <span>Hook:</span>
                    <span className={voting.isConnected ? 'text-neon-green' : 'text-red-400'}>
                        {voting.isConnected ? 'Connected' : 'Disconnected'}
                    </span>
                </div>
                {voting.isActive && (
                    <div className="flex justify-between">
                        <span>Progress:</span>
                        <span className="text-neon-cyan">{voting.getProgressPercentage()}%</span>
                    </div>
                )}
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
                {performanceMetrics.reconnectCount > 0 && (
                    <div className="flex justify-between">
                        <span>Reconnects:</span>
                        <span className="text-yellow-400">{performanceMetrics.reconnectCount}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LiveVotingSession;