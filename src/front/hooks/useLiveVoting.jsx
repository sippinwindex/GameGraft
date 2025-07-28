// src/front/hooks/useLiveVoting.jsx - PHASE 4 SSE INTEGRATION WITH YOUR EXISTING COMPONENTS
// 🚀 Works with your LiveVotingSession.jsx, VotingStatusPanel.jsx, and VotingReminders.jsx

import { useEffect, useRef, useCallback } from 'react';
import { useGlobalReducer, ACTION_TYPES, selectors, votingHelpers } from '../store/store.js';
import { useSSEManager } from '../services/sseManager.js';
import authService from '../store/authService.js';

/**
 * 🚀 Phase 4: Enhanced Live Voting Hook
 * Integrates with your existing SSE components and beautiful UI
 */
export const useLiveVoting = (sessionId, options = {}) => {
    const { store, dispatch } = useGlobalReducer();
    const reconnectAttempts = useRef(0);
    const maxReconnectAttempts = 10;

    // Options with defaults
    const {
        onAllVotesComplete = null,
        onVoteUpdate = null,
        onMemberUpdate = null,
        onError = null,
        enableAutoReconnect = true,
        autoNavigateOnComplete = false
    } = options;

    // 🚀 Get voting state from optimized store selectors
    const isVotingActive = selectors.selectIsVotingActive(store);
    const votingMembers = selectors.selectVotingMembers(store);
    const votedUsers = selectors.selectVotedUsers(store);
    const pendingUsers = selectors.selectPendingUsers(store);
    const allVotesComplete = selectors.selectAllVotesComplete(store);
    const votingProgress = selectors.selectVotingProgress(store);
    const currentVoter = selectors.selectCurrentVoter(store);
    const sessionStatus = selectors.selectSessionStatus(store);
    const votingError = selectors.selectVotingError(store);

    // Get backend URL
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

    // 🚀 SSE Manager for reliable connections (using your existing sseManager)
    const sseEndpoint = sessionId ? `/api/live-voting/sessions/${sessionId}/live-stream` : null;
    const { manager, status } = useSSEManager(sseEndpoint, {
        enableLogging: true,
        autoReconnect: enableAutoReconnect,
        maxReconnectAttempts,
        reconnectDelay: 1000
    });

    // 🚀 Enhanced SSE Event Handlers (optimized for your components)
    const handleVotingUpdate = useCallback((data) => {
        console.log('🔥 SSE: Live voting update received:', data);
        
        try {
            switch (data.type) {
                case 'voting_session_started':
                    console.log('🚀 SSE: Voting session started');
                    votingHelpers.startVotingSession(dispatch, {
                        sessionId: data.sessionId,
                        members: data.members,
                        gameTitle: data.gameTitle,
                        initiatedBy: data.initiatedBy
                    });
                    break;

                case 'user_vote_submitted':
                    console.log('✅ SSE: User voted:', data.userId);
                    votingHelpers.handleVoteUpdate(dispatch, {
                        userId: data.userId,
                        action: 'voted',
                        voteData: data.voteData,
                        timestamp: data.timestamp
                    });
                    
                    // Trigger custom callback
                    if (onVoteUpdate) {
                        onVoteUpdate({
                            userId: data.userId,
                            status: 'voted',
                            voteData: data.voteData
                        });
                    }
                    break;

                case 'user_status_pending':
                    console.log('⏳ SSE: User pending:', data.userId);
                    votingHelpers.handleVoteUpdate(dispatch, {
                        userId: data.userId,
                        action: 'pending',
                        reason: data.reason
                    });
                    break;

                case 'user_currently_voting':
                    console.log('🎯 SSE: User currently voting:', data.userId);
                    dispatch({
                        type: ACTION_TYPES.SET_CURRENT_VOTER,
                        payload: {
                            userId: data.userId,
                            startTime: data.startTime,
                            timeLimit: data.timeLimit
                        }
                    });
                    break;

                case 'voting_session_complete':
                    console.log('🎉 SSE: All votes complete!');
                    dispatch({
                        type: ACTION_TYPES.ALL_VOTES_COMPLETE,
                        payload: {
                            completed: true,
                            results: data.results,
                            completedAt: data.completedAt
                        }
                    });
                    
                    // Enhanced completion callback with results
                    if (onAllVotesComplete) {
                        setTimeout(() => onAllVotesComplete({
                            sessionId: data.sessionId,
                            results: data.results,
                            completedAt: data.completedAt,
                            autoNavigate: autoNavigateOnComplete
                        }), 1500); // Delay for visual feedback
                    }
                    break;

                case 'voting_session_ended':
                    console.log('🏁 SSE: Voting session ended');
                    votingHelpers.endVotingSession(dispatch, {
                        reason: data.reason,
                        endedBy: data.endedBy
                    });
                    break;

                case 'member_joined_session':
                    console.log('👥 SSE: New member joined voting');
                    dispatch({
                        type: ACTION_TYPES.UPDATE_VOTING_MEMBERS,
                        payload: {
                            members: data.members,
                            newMember: data.newMember
                        }
                    });
                    
                    if (onMemberUpdate) {
                        onMemberUpdate({
                            action: 'joined',
                            member: data.newMember,
                            members: data.members
                        });
                    }
                    break;

                case 'member_left_session':
                    console.log('👋 SSE: Member left voting');
                    dispatch({
                        type: ACTION_TYPES.UPDATE_VOTING_MEMBERS,
                        payload: {
                            members: data.members,
                            leftMember: data.leftMember
                        }
                    });
                    
                    if (onMemberUpdate) {
                        onMemberUpdate({
                            action: 'left',
                            member: data.leftMember,
                            members: data.members
                        });
                    }
                    break;

                case 'voting_reminder_sent':
                    console.log('🔔 SSE: Reminder sent to users');
                    dispatch({
                        type: ACTION_TYPES.VOTING_REMINDER_SENT,
                        payload: {
                            reminderType: data.reminderType,
                            sentTo: data.sentTo,
                            timestamp: data.timestamp
                        }
                    });
                    break;

                case 'voting_time_warning':
                    console.log('⏰ SSE: Time warning');
                    dispatch({
                        type: ACTION_TYPES.VOTING_TIME_WARNING,
                        payload: {
                            timeRemaining: data.timeRemaining,
                            warningType: data.warningType
                        }
                    });
                    break;

                case 'voting_error':
                    console.error('❌ SSE: Voting error:', data.error);
                    dispatch({
                        type: ACTION_TYPES.SET_VOTING_ERROR,
                        payload: {
                            error: data.error,
                            code: data.code,
                            timestamp: data.timestamp
                        }
                    });
                    
                    if (onError) {
                        onError({
                            error: data.error,
                            code: data.code,
                            timestamp: data.timestamp
                        });
                    }
                    break;

                default:
                    console.log('🔄 SSE: Unknown voting event:', data.type, data);
            }
        } catch (error) {
            console.error('❌ SSE: Error handling voting update:', error);
            dispatch({
                type: ACTION_TYPES.SET_VOTING_ERROR,
                payload: {
                    error: 'Failed to process live update',
                    details: error.message,
                    timestamp: new Date().toISOString()
                }
            });
        }
    }, [dispatch, onAllVotesComplete, onVoteUpdate, onMemberUpdate, onError, autoNavigateOnComplete]);

    // 🚀 Enhanced SSE Event Listeners
    useEffect(() => {
        if (!manager || !sessionId) return;

        console.log('🔌 SSE: Setting up live voting listeners for session:', sessionId);

        // Main voting events
        manager.addEventListener('voting_update', handleVotingUpdate);
        manager.addEventListener('session_update', handleVotingUpdate);
        manager.addEventListener('member_update', handleVotingUpdate);
        manager.addEventListener('error', (event) => {
            console.error('❌ SSE: Connection error:', event);
            dispatch({
                type: ACTION_TYPES.SET_VOTING_ERROR,
                payload: {
                    error: 'Connection error',
                    details: event.data?.message || 'SSE connection failed',
                    timestamp: new Date().toISOString()
                }
            });
        });

        // Connection status events
        manager.addEventListener('connected', () => {
            console.log('✅ SSE: Connected to live voting');
            reconnectAttempts.current = 0;
            dispatch({
                type: ACTION_TYPES.SET_VOTING_CONNECTION_STATUS,
                payload: 'connected'
            });
        });

        manager.addEventListener('disconnected', () => {
            console.log('🔌 SSE: Disconnected from live voting');
            dispatch({
                type: ACTION_TYPES.SET_VOTING_CONNECTION_STATUS,
                payload: 'disconnected'
            });
        });

        manager.addEventListener('reconnecting', (event) => {
            console.log('🔄 SSE: Reconnecting...', event.data);
            dispatch({
                type: ACTION_TYPES.SET_VOTING_CONNECTION_STATUS,
                payload: 'reconnecting'
            });
        });

        return () => {
            console.log('🧹 SSE: Cleaning up live voting listeners');
            manager.removeAllEventListeners();
        };
    }, [manager, sessionId, handleVotingUpdate, dispatch]);

    // 🚀 Helper functions for your existing components
    const startVotingSession = useCallback(async (members, gameData) => {
        try {
            console.log('🚀 Starting voting session:', { sessionId, members, gameData });
            
            const currentUser = authService.getCurrentUser();
            const response = await fetch(`${backendUrl}/api/live-voting/sessions/${sessionId}/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser?.token}`
                },
                body: JSON.stringify({
                    sessionId,
                    members,
                    gameData,
                    initiatedBy: currentUser?.id
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to start voting session: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('✅ Voting session started:', result);
            
            return result;
        } catch (error) {
            console.error('❌ Failed to start voting session:', error);
            dispatch({
                type: ACTION_TYPES.SET_VOTING_ERROR,
                payload: {
                    error: 'Failed to start voting session',
                    details: error.message,
                    timestamp: new Date().toISOString()
                }
            });
            throw error;
        }
    }, [dispatch, sessionId, backendUrl]);

    const endVotingSession = useCallback(async (reason = 'manual') => {
        try {
            console.log('🏁 Ending voting session:', sessionId);
            
            const currentUser = authService.getCurrentUser();
            const response = await fetch(`${backendUrl}/api/live-voting/sessions/${sessionId}/end`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser?.token}`
                },
                body: JSON.stringify({
                    sessionId,
                    reason,
                    endedBy: currentUser?.id
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to end voting session: ${response.statusText}`);
            }

            votingHelpers.endVotingSession(dispatch, { reason, endedBy: currentUser?.id });
            
            // Disconnect SSE
            if (manager) {
                manager.disconnect();
            }

            console.log('✅ Voting session ended');
        } catch (error) {
            console.error('❌ Failed to end voting session:', error);
            dispatch({
                type: ACTION_TYPES.SET_VOTING_ERROR,
                payload: {
                    error: 'Failed to end voting session',
                    details: error.message,
                    timestamp: new Date().toISOString()
                }
            });
        }
    }, [dispatch, sessionId, backendUrl, manager]);

    const sendVotingReminder = useCallback(async (reminderType = 'gentle') => {
        try {
            const currentUser = authService.getCurrentUser();
            const response = await fetch(`${backendUrl}/api/live-voting/sessions/${sessionId}/remind`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser?.token}`
                },
                body: JSON.stringify({
                    sessionId,
                    reminderType,
                    sentBy: currentUser?.id
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to send reminder: ${response.statusText}`);
            }

            console.log('🔔 Voting reminder sent');
            return await response.json();
        } catch (error) {
            console.error('❌ Failed to send reminder:', error);
            throw error;
        }
    }, [sessionId, backendUrl]);

    // 🚀 Derived state for your components
    const votingStatus = {
        // Core status
        isActive: isVotingActive,
        sessionId: selectors.selectVotingSession(store),
        status: sessionStatus,
        error: votingError,
        
        // Member data
        members: votingMembers,
        votedUsers,
        pendingUsers,
        currentVoter,
        
        // Progress data
        allVotesComplete,
        progress: votingProgress,
        votedCount: votedUsers.length,
        pendingCount: pendingUsers.length,
        totalCount: votingMembers.length,
        
        // Connection status
        connectionStatus: status,
        isConnected: status === 'connected',
        isReconnecting: status === 'reconnecting'
    };

    // 🚀 Utility functions for your components
    const utilities = {
        isUserVoted: (userId) => votedUsers.some(user => user.id === userId),
        isUserPending: (userId) => pendingUsers.some(user => user.id === userId),
        isUserCurrentVoter: (userId) => currentVoter?.userId === userId,
        getUserStatus: (userId) => {
            if (votedUsers.some(user => user.id === userId)) return 'voted';
            if (currentVoter?.userId === userId) return 'voting';
            if (pendingUsers.some(user => user.id === userId)) return 'pending';
            return 'waiting';
        },
        getMemberStatusIcon: (userId) => {
            const status = utilities.getUserStatus(userId);
            switch (status) {
                case 'voted': return '✅';
                case 'voting': return '🎯';
                case 'pending': return '⏳';
                default: return '⚪';
            }
        },
        getMemberStatusColor: (userId) => {
            const status = utilities.getUserStatus(userId);
            switch (status) {
                case 'voted': return 'text-neon-green';
                case 'voting': return 'text-neon-cyan';
                case 'pending': return 'text-neon-yellow';
                default: return 'text-gray-400';
            }
        },
        getProgressPercentage: () => {
            if (votingMembers.length === 0) return 0;
            return Math.round((votedUsers.length / votingMembers.length) * 100);
        }
    };

    return {
        // Status and data
        ...votingStatus,
        
        // Actions
        startVotingSession,
        endVotingSession,
        sendVotingReminder,
        reconnect: manager?.connect,
        disconnect: manager?.disconnect,
        
        // Utilities
        ...utilities
    };
};

// 🚀 ENHANCED LIVE VOTING STATUS COMPONENT (for your existing LiveVotingSession.jsx)
export const LiveVotingStatusPanel = ({ 
    sessionId, 
    currentUser, 
    onNavigateToResults,
    className = "",
    showReminders = true,
    showProgress = true 
}) => {
    const voting = useLiveVoting(sessionId, {
        onAllVotesComplete: (data) => {
            if (onNavigateToResults) {
                onNavigateToResults(data);
            }
        },
        autoNavigateOnComplete: true
    });

    if (!voting.isActive) {
        return null;
    }

    return (
        <div className={`glass-gaming rounded-3xl p-6 mb-6 ${className}`}>
            {/* Header with connection status */}
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-white text-shadow-glow">
                    🎮 Live Voting Session
                </h3>
                <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                        voting.isConnected ? 'bg-neon-green animate-glow-pulse' : 
                        voting.isReconnecting ? 'bg-neon-yellow animate-pulse' : 
                        'bg-red-500'
                    }`}></div>
                    <span className={`text-sm font-medium ${
                        voting.isConnected ? 'text-neon-green' : 
                        voting.isReconnecting ? 'text-neon-yellow' : 
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
                    <div className="flex justify-between text-sm text-neon-cyan mb-2">
                        <span className="font-medium">Voting Progress</span>
                        <span className="text-shadow-glow">
                            {voting.votedCount} / {voting.totalCount} completed ({voting.getProgressPercentage()}%)
                        </span>
                    </div>
                    <div className="w-full bg-discord-800 rounded-full h-3 overflow-hidden">
                        <div 
                            className="bg-gradient-to-r from-neon-cyan to-neon-purple h-3 rounded-full transition-all duration-500 ease-out animate-shimmer"
                            style={{ width: `${voting.progress}%` }}
                        ></div>
                    </div>
                </div>
            )}

            {/* Enhanced Members Status Grid */}
            <div className="space-y-4">
                <h4 className="text-lg font-semibold text-neon-cyan text-shadow-glow">
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
                                className={`glass-effect rounded-xl p-4 transition-all duration-300 animate-fade-in magnetic ${
                                    isCurrentUser ? 'ring-2 ring-neon-cyan' : ''
                                }`}
                                style={{ animationDelay: `${index * 0.1}s` }}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-3">
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-discord-600 to-discord-700 flex items-center justify-center text-sm font-bold">
                                            {member.username.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <span className={`font-medium ${isCurrentUser ? 'text-neon-cyan' : 'text-white'}`}>
                                                {member.username}
                                            </span>
                                            {isCurrentUser && (
                                                <span className="text-xs text-neon-cyan ml-2">(You)</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <span className="text-lg">{statusIcon}</span>
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${statusColor} ${
                                            status === 'voted' ? 'bg-neon-green/20 border-neon-green' :
                                            status === 'voting' ? 'bg-neon-cyan/20 border-neon-cyan animate-glow-pulse' :
                                            status === 'pending' ? 'bg-neon-yellow/20 border-neon-yellow' :
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
                <div className="mt-6 glass-gaming rounded-2xl p-6 border-2 border-neon-green animate-glow-pulse">
                    <div className="flex items-center justify-center space-x-4">
                        <span className="text-4xl animate-bounce">🎉</span>
                        <div className="text-center">
                            <h4 className="text-xl font-bold text-neon-green text-shadow-glow">
                                All Votes Complete!
                            </h4>
                            <p className="text-neon-cyan">
                                Navigating to results...
                            </p>
                        </div>
                        <span className="text-4xl animate-bounce" style={{ animationDelay: '0.2s' }}>🚀</span>
                    </div>
                </div>
            )}

            {/* Enhanced Error Display */}
            {voting.error && (
                <div className="mt-6 glass-dark rounded-2xl p-4 border border-red-500/50">
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
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-all duration-300 magnetic"
                            >
                                Reconnect
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Voting Reminders Panel */}
            {showReminders && !voting.allVotesComplete && voting.pendingCount > 0 && (
                <div className="mt-6 glass-effect rounded-2xl p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <span className="text-neon-yellow">🔔</span>
                            <span className="text-sm text-neon-yellow">
                                {voting.pendingCount} member{voting.pendingCount > 1 ? 's' : ''} still need to vote
                            </span>
                        </div>
                        <button 
                            onClick={() => voting.sendVotingReminder('gentle')}
                            className="px-3 py-1 bg-neon-yellow/20 hover:bg-neon-yellow/30 text-neon-yellow rounded-lg text-xs font-medium transition-all duration-300 magnetic"
                        >
                            Send Reminder
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default useLiveVoting;