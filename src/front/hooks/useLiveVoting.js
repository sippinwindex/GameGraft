// src/front/hooks/useLiveVoting.js - ENHANCED Live Voting Hook
// Addresses Phase 2 priorities: comprehensive live voting with real-time updates

import { useState, useEffect, useCallback, useRef } from 'react';
import { useGlobalReducer } from '../store/store.js';
import authService from '../store/authService';
import { apiUrl } from '../config/environment.js';

/**
 * Enhanced Live Voting Hook with Kahoot-style real-time features
 * Implements comprehensive voting session lifecycle management
 */
export const useLiveVoting = (sessionId, options = {}) => {
    const {
        onAllVotesComplete,
        onVoteUpdate,
        onMemberUpdate,
        onError,
        enableAutoReconnect = true,
        autoNavigateOnComplete = false,
        heartbeatInterval = 30000,
        maxReconnectAttempts = 5
    } = options;

    const { store, dispatch } = useGlobalReducer();
    
    // Core voting state
    const [votingState, setVotingState] = useState({
        isActive: false,
        isConnected: false,
        isReconnecting: false,
        members: [],
        votedUsers: [],
        pendingUsers: [],
        allVotesComplete: false,
        progress: 0,
        sessionData: null,
        error: null,
        lastUpdate: null
    });

    // Connection management
    const [connectionState, setConnectionState] = useState({
        attempts: 0,
        lastConnected: null,
        reconnectTimeout: null
    });

    // Refs for cleanup and persistence
    const eventSourceRef = useRef(null);
    const heartbeatRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const voteAggregationRef = useRef(new Map());

    // 🎯 ENHANCED: Real-time vote aggregation with conflict resolution
    const aggregateVotes = useCallback((voteData) => {
        const { userId, votes, timestamp, sessionId: voteSessionId } = voteData;
        
        // Validate vote data
        if (!userId || !votes || voteSessionId !== sessionId) {
            console.warn('🚫 Invalid vote data received:', voteData);
            return false;
        }

        const aggregationMap = voteAggregationRef.current;
        const existingVote = aggregationMap.get(userId);
        
        // Conflict resolution: later timestamp wins
        if (existingVote && new Date(existingVote.timestamp) > new Date(timestamp)) {
            console.log('🔄 Ignoring older vote from user:', userId);
            return false;
        }

        // Store the vote with metadata
        aggregationMap.set(userId, {
            userId,
            votes,
            timestamp,
            processed: true,
            conflicts: existingVote ? (existingVote.conflicts || 0) + 1 : 0
        });

        return true;
    }, [sessionId]);

    // 🎯 ENHANCED: Kahoot-style member status tracking
    const updateMemberStatus = useCallback((members, votedUserIds) => {
        const updatedMembers = members.map(member => {
            const hasVoted = votedUserIds.includes(member.id);
            const voteData = voteAggregationRef.current.get(member.id);
            
            return {
                ...member,
                hasVoted,
                status: hasVoted ? 'voted' : 'pending',
                voteTime: voteData?.timestamp || null,
                voteCount: voteData?.votes?.length || 0,
                conflicts: voteData?.conflicts || 0
            };
        });

        const votedCount = votedUserIds.length;
        const totalCount = members.length;
        const progress = totalCount > 0 ? (votedCount / totalCount) * 100 : 0;
        const allComplete = progress >= 100;

        setVotingState(prev => ({
            ...prev,
            members: updatedMembers,
            votedUsers: updatedMembers.filter(m => m.hasVoted),
            pendingUsers: updatedMembers.filter(m => !m.hasVoted),
            progress,
            allVotesComplete: allComplete,
            lastUpdate: new Date().toISOString()
        }));

        // Trigger completion callback
        if (allComplete && !votingState.allVotesComplete) {
            console.log('🎉 All votes complete!');
            onAllVotesComplete?.({
                results: Array.from(voteAggregationRef.current.values()),
                completedAt: new Date().toISOString(),
                autoNavigate: autoNavigateOnComplete,
                totalVotes: votedCount,
                conflicts: Array.from(voteAggregationRef.current.values())
                    .reduce((sum, vote) => sum + (vote.conflicts || 0), 0)
            });
        }

        return { updatedMembers, progress, allComplete };
    }, [votingState.allVotesComplete, onAllVotesComplete, autoNavigateOnComplete]);

    // 🎯 ENHANCED: SSE Connection with comprehensive error handling
    const connectToVotingStream = useCallback(() => {
        if (!sessionId || eventSourceRef.current) return;

        const token = authService.getAccessToken();
        if (!token) {
            setVotingState(prev => ({ ...prev, error: { error: 'Authentication required', code: 'AUTH_REQUIRED' } }));
            return;
        }

        console.log(`🔗 Connecting to live voting stream for session: ${sessionId}`);
        
        const url = `${apiUrl}/api/live-voting/sessions/${sessionId}/live-stream?token=${encodeURIComponent(token)}`;
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        // Connection opened
        eventSource.onopen = () => {
            console.log('✅ Live voting stream connected');
            setVotingState(prev => ({
                ...prev,
                isConnected: true,
                isReconnecting: false,
                error: null
            }));
            setConnectionState(prev => ({
                ...prev,
                attempts: 0,
                lastConnected: new Date().toISOString()
            }));

            // Start heartbeat monitoring
            if (heartbeatInterval > 0) {
                heartbeatRef.current = setInterval(() => {
                    // Send ping or check connection health
                    console.log('💓 Voting stream heartbeat check');
                }, heartbeatInterval);
            }
        };

        // Message received
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('📡 Live voting message:', data.type, data);

                switch (data.type) {
                    case 'heartbeat':
                        // Update last seen heartbeat
                        setVotingState(prev => ({ ...prev, lastUpdate: new Date().toISOString() }));
                        break;

                    case 'session_started':
                    case 'voting_started':
                        console.log('🚀 Voting session started');
                        setVotingState(prev => ({
                            ...prev,
                            isActive: true,
                            sessionData: data.session || data,
                            members: data.members || prev.members
                        }));
                        // Clear previous vote aggregation
                        voteAggregationRef.current.clear();
                        break;

                    case 'vote_submitted':
                    case 'vote_update':
                        console.log('🗳️ Vote received from user:', data.user_id || data.userId);
                        
                        // Aggregate the vote with conflict resolution
                        const voteAccepted = aggregateVotes({
                            userId: data.user_id || data.userId,
                            votes: data.votes || data.game_votes,
                            timestamp: data.timestamp || new Date().toISOString(),
                            sessionId: data.session_id || sessionId
                        });

                        if (voteAccepted) {
                            // Update member statuses
                            const votedUserIds = Array.from(voteAggregationRef.current.keys());
                            updateMemberStatus(votingState.members, votedUserIds);
                            
                            // Notify parent components
                            onVoteUpdate?.({
                                userId: data.user_id || data.userId,
                                votes: data.votes || data.game_votes,
                                timestamp: data.timestamp,
                                status: 'voted'
                            });
                        }
                        break;

                    case 'member_joined':
                    case 'member_left':
                        console.log('👥 Member update:', data.type, data.username);
                        
                        if (data.type === 'member_joined') {
                            setVotingState(prev => ({
                                ...prev,
                                members: [...prev.members, {
                                    id: data.user_id || data.userId,
                                    username: data.username,
                                    avatar_url: data.avatar_url,
                                    hasVoted: false,
                                    status: 'pending'
                                }]
                            }));
                        } else {
                            setVotingState(prev => ({
                                ...prev,
                                members: prev.members.filter(m => m.id !== (data.user_id || data.userId))
                            }));
                        }

                        onMemberUpdate?.({
                            action: data.type === 'member_joined' ? 'joined' : 'left',
                            userId: data.user_id || data.userId,
                            username: data.username,
                            members: votingState.members
                        });
                        break;

                    case 'voting_completed':
                    case 'session_ended':
                        console.log('🏁 Voting session completed');
                        setVotingState(prev => ({
                            ...prev,
                            isActive: false,
                            allVotesComplete: true
                        }));

                        onAllVotesComplete?.({
                            results: data.results || Array.from(voteAggregationRef.current.values()),
                            completedAt: data.completed_at || new Date().toISOString(),
                            autoNavigate: autoNavigateOnComplete,
                            finalResults: data.final_results,
                            winner: data.winner
                        });
                        break;

                    case 'error':
                        console.error('❌ Voting stream error:', data.error);
                        setVotingState(prev => ({
                            ...prev,
                            error: {
                                error: data.error,
                                code: data.code || 'STREAM_ERROR',
                                details: data.details
                            }
                        }));
                        onError?.(data);
                        break;

                    default:
                        console.log('🔍 Unknown voting message type:', data.type);
                }
            } catch (parseError) {
                console.error('❌ Failed to parse voting stream message:', parseError);
                setVotingState(prev => ({
                    ...prev,
                    error: {
                        error: 'Message parsing failed',
                        code: 'PARSE_ERROR',
                        details: parseError.message
                    }
                }));
            }
        };

        // Connection error
        eventSource.onerror = (error) => {
            console.error('❌ Live voting stream error:', error);
            setVotingState(prev => ({
                ...prev,
                isConnected: false,
                error: {
                    error: 'Connection lost',
                    code: 'CONNECTION_ERROR',
                    details: 'SSE connection failed'
                }
            }));

            // Attempt reconnection if enabled
            if (enableAutoReconnect && connectionState.attempts < maxReconnectAttempts) {
                setConnectionState(prev => ({ ...prev, attempts: prev.attempts + 1 }));
                setVotingState(prev => ({ ...prev, isReconnecting: true }));
                
                const delay = Math.min(1000 * Math.pow(2, connectionState.attempts), 30000);
                console.log(`🔄 Reconnecting in ${delay}ms (attempt ${connectionState.attempts + 1})`);
                
                reconnectTimeoutRef.current = setTimeout(() => {
                    disconnect();
                    connectToVotingStream();
                }, delay);
            }
        };

    }, [sessionId, enableAutoReconnect, connectionState.attempts, maxReconnectAttempts, heartbeatInterval, updateMemberStatus, onVoteUpdate, onMemberUpdate, onAllVotesComplete, onError, autoNavigateOnComplete, aggregateVotes, votingState.members]);

    // Disconnect from stream
    const disconnect = useCallback(() => {
        console.log('🔌 Disconnecting from live voting stream');
        
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
        }

        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        setVotingState(prev => ({
            ...prev,
            isConnected: false,
            isReconnecting: false
        }));
    }, []);

    // 🎯 NEW: Start voting session
    const startVotingSession = useCallback((members, sessionConfig = {}) => {
        console.log('🚀 Starting voting session with members:', members.length);
        
        setVotingState(prev => ({
            ...prev,
            isActive: true,
            members: members.map(member => ({
                ...member,
                hasVoted: false,
                status: 'pending',
                voteTime: null,
                voteCount: 0
            })),
            sessionData: sessionConfig,
            votedUsers: [],
            pendingUsers: members,
            progress: 0,
            allVotesComplete: false,
            error: null
        }));

        // Clear vote aggregation
        voteAggregationRef.current.clear();

        // Connect to stream if not already connected
        if (!votingState.isConnected) {
            connectToVotingStream();
        }
    }, [votingState.isConnected, connectToVotingStream]);

    // 🎯 NEW: End voting session
    const endVotingSession = useCallback((reason = 'manual') => {
        console.log(`🏁 Ending voting session: ${reason}`);
        
        setVotingState(prev => ({
            ...prev,
            isActive: false,
            allVotesComplete: true
        }));

        // Keep connection open for result streaming
        // disconnect(); // Uncomment if you want to close connection immediately
    }, []);

    // 🎯 NEW: Manual vote submission (for testing or manual entry)
    const submitVote = useCallback(async (userId, votes) => {
        try {
            const voteData = {
                userId,
                votes,
                timestamp: new Date().toISOString(),
                sessionId
            };

            // Add to local aggregation immediately for responsiveness
            const accepted = aggregateVotes(voteData);
            
            if (accepted) {
                const votedUserIds = Array.from(voteAggregationRef.current.keys());
                updateMemberStatus(votingState.members, votedUserIds);
            }

            return { success: true, accepted };
        } catch (error) {
            console.error('❌ Manual vote submission failed:', error);
            return { success: false, error: error.message };
        }
    }, [sessionId, aggregateVotes, updateMemberStatus, votingState.members]);

    // Initialize connection on mount
    useEffect(() => {
        if (sessionId) {
            connectToVotingStream();
        }

        return () => {
            disconnect();
        };
    }, [sessionId, connectToVotingStream, disconnect]);

    // 🎯 ENHANCED: Computed values and helpers
    const computedValues = {
        // User status helpers
        isUserVoted: (userId) => voteAggregationRef.current.has(userId),
        isUserCurrentVoter: (userId) => votingState.pendingUsers.some(u => u.id === userId),
        getUserStatus: (userId) => {
            if (voteAggregationRef.current.has(userId)) return 'voted';
            return votingState.isActive ? 'pending' : 'waiting';
        },
        
        // Member status helpers
        getMemberStatusIcon: (userId) => {
            const status = computedValues.getUserStatus(userId);
            switch (status) {
                case 'voted': return '✅';
                case 'pending': return '⏳';
                default: return '⭕';
            }
        },
        getMemberStatusColor: (userId) => {
            const status = computedValues.getUserStatus(userId);
            switch (status) {
                case 'voted': return 'text-green-400 bg-green-500/20 border-green-500';
                case 'pending': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500';
                default: return 'text-gray-400 bg-gray-500/20 border-gray-500';
            }
        },

        // Progress helpers
        getProgressPercentage: () => Math.round(votingState.progress),
        votedCount: votingState.votedUsers.length,
        totalCount: votingState.members.length,
        pendingCount: votingState.pendingUsers.length,

        // Vote data helpers
        getVoteConflicts: () => Array.from(voteAggregationRef.current.values())
            .reduce((sum, vote) => sum + (vote.conflicts || 0), 0),
        getAllVotes: () => Array.from(voteAggregationRef.current.values()),
        getVoteByUser: (userId) => voteAggregationRef.current.get(userId)
    };

    // Return comprehensive hook interface
    return {
        // Core state
        ...votingState,
        
        // Connection management
        connectionState,
        reconnect: connectToVotingStream,
        disconnect,
        
        // Session control
        startVotingSession,
        endVotingSession,
        submitVote,
        
        // Computed values and helpers
        ...computedValues,
        
        // Aggregated vote data
        voteAggregation: voteAggregationRef.current,
        
        // Debugging (dev only)
        ...(process.env.NODE_ENV === 'development' && {
            debug: {
                clearVotes: () => voteAggregationRef.current.clear(),
                simulateVote: (userId, votes) => submitVote(userId, votes),
                getInternalState: () => ({
                    aggregation: Array.from(voteAggregationRef.current.entries()),
                    connectionAttempts: connectionState.attempts,
                    lastUpdate: votingState.lastUpdate
                })
            }
        })
    };
};

export default useLiveVoting;