// src/front/pages/GroupPage.jsx - ENHANCED with Live Voting & Steam Integration
// Addresses all phases: Complete integration of live voting, Steam, and real-time features

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

// Enhanced imports
import useGlobalReducer from '../hooks/useGlobalReducer';
import { useLiveVoting } from '../hooks/useLiveVoting';
import authService from '../store/authService';
import steamService from '../services/steamService';

// Components
import LoadingState from '../components/LoadingState';
import GroupActionButtons from '../components/GroupActionButtons';
import VotingStatusPanel from '../components/VotingStatusPanel';
import QuickVote from '../components/QuickVote';
import VotingReminders, { useVotingReminders } from '../components/VotingReminders';
import EnhancedSteamFeatures from '../components/Steam/EnhancedSteamFeatures';
import GroupGamingTab from '../components/GroupGamingTab';
import GroupMembersTab from '../components/GroupMembersTab';
import { LazyLiveVotingSession } from '../components/LazyComponents';

const EnhancedGroupPage = () => {
    const { groupId } = useParams();
    const navigate = useNavigate();
    const { store, dispatch } = useGlobalReducer();
    const user = store?.user;

    // Core group state
    const [group, setGroup] = useState(null);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    // Enhanced voting state
    const [votingSession, setVotingSession] = useState(null);
    const [userVotes, setUserVotes] = useState([]);
    const [availableGames, setAvailableGames] = useState([]);

    // Steam integration state
    const [steamStatus, setSteamStatus] = useState({
        connected_members: 0,
        total_members: 0,
        coverage_percentage: 0,
        common_games_count: 0,
        ready_for_voting: false
    });

    // Performance tracking
    const [performanceMetrics, setPerformanceMetrics] = useState({
        loadTime: null,
        lastUpdate: null,
        steamSyncTime: null,
        votingLatency: null
    });

    // 🎯 ENHANCED: Live voting integration
    const liveVoting = useLiveVoting(votingSession?.id, {
        onAllVotesComplete: (data) => {
            console.log('🎉 All votes complete:', data);
            toast.success('All members have voted! Calculating results...');
            
            // Navigate to results if auto-navigation enabled
            if (data.autoNavigate && votingSession?.id) {
                setTimeout(() => {
                    navigate(`/voting/${votingSession.id}/results`);
                }, 2000);
            }
        },
        onVoteUpdate: (update) => {
            console.log('🗳️ Vote update:', update);
            // Update local state if needed
        },
        onMemberUpdate: (memberUpdate) => {
            console.log('👥 Member update:', memberUpdate);
            // Update members list
            if (memberUpdate.members) {
                setMembers(memberUpdate.members);
            }
        },
        onError: (error) => {
            console.error('❌ Live voting error:', error);
            toast.error(`Voting error: ${error.error}`);
        },
        enableAutoReconnect: true,
        autoNavigateOnComplete: false
    });

    // 🎯 ENHANCED: Voting reminders
    const votingReminders = useVotingReminders(votingSession, liveVoting.isUserVoted?.(user?.id));

    // 🎯 ENHANCED: Load group data with comprehensive error handling
    const loadGroupData = useCallback(async () => {
        const startTime = performance.now();
        
        try {
            setLoading(true);
            setError(null);

            const backendUrl = import.meta.env.VITE_BACKEND_URL;
            const response = await authService.authenticatedFetch(`${backendUrl}/api/gaming/groups/${groupId}`);
            
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Group data loaded:', data);

                setGroup(data.group);
                setMembers(data.group.members || []);
                
                // Update performance metrics
                const loadTime = performance.now() - startTime;
                setPerformanceMetrics(prev => ({
                    ...prev,
                    loadTime,
                    lastUpdate: new Date().toISOString()
                }));

                // Load Steam status
                await updateSteamStatus(data.group.members || []);

                // Check for active voting session
                if (data.group.active_voting_session) {
                    setVotingSession(data.group.active_voting_session);
                    
                    // Load user's votes if any
                    await loadUserVotes(data.group.active_voting_session.id);
                }

                // Load available games for voting
                await loadAvailableGames();

            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Error loading group:', error);
            setError(error.message);
            
            // Handle specific error cases
            if (error.message.includes('404')) {
                toast.error('Group not found');
                navigate('/dashboard');
            } else if (error.message.includes('403')) {
                toast.error('Access denied to this group');
                navigate('/dashboard');
            } else {
                toast.error('Failed to load group data');
            }
        } finally {
            setLoading(false);
        }
    }, [groupId, navigate]);

    // 🎯 ENHANCED: Update Steam status with real-time data
    const updateSteamStatus = useCallback(async (groupMembers = members) => {
        try {
            const steamConnected = groupMembers.filter(m => m.steam_connected || m.is_steam_connected);
            const coverage = groupMembers.length > 0 ? (steamConnected.length / groupMembers.length) * 100 : 0;

            // Get common games count
            let commonGamesCount = 0;
            if (steamConnected.length >= 2) {
                const commonGamesResult = await steamService.getCommonGames(groupId);
                if (commonGamesResult.success) {
                    commonGamesCount = commonGamesResult.games?.length || 0;
                }
            }

            const newSteamStatus = {
                connected_members: steamConnected.length,
                total_members: groupMembers.length,
                coverage_percentage: coverage,
                common_games_count: commonGamesCount,
                ready_for_voting: steamConnected.length >= 2 && commonGamesCount > 0
            };

            setSteamStatus(newSteamStatus);
            
            console.log('🎮 Steam status updated:', newSteamStatus);
            
        } catch (error) {
            console.error('❌ Failed to update Steam status:', error);
        }
    }, [groupId, members]);

    // 🎯 ENHANCED: Load user votes for active session
    const loadUserVotes = useCallback(async (sessionId) => {
        try {
            const backendUrl = import.meta.env.VITE_BACKEND_URL;
            const response = await authService.authenticatedFetch(`${backendUrl}/api/live-voting/sessions/${sessionId}/user-votes`);
            
            if (response.ok) {
                const data = await response.json();
                setUserVotes(data.votes || []);
            }
        } catch (error) {
            console.error('❌ Failed to load user votes:', error);
        }
    }, []);

    // 🎯 ENHANCED: Load available games for voting
    const loadAvailableGames = useCallback(async () => {
        try {
            if (steamStatus.common_games_count === 0) return;

            const commonGamesResult = await steamService.getCommonGames(groupId, {
                include_multiplayer: true,
                min_players: 2
            });

            if (commonGamesResult.success) {
                setAvailableGames(commonGamesResult.games || []);
            }
        } catch (error) {
            console.error('❌ Failed to load available games:', error);
        }
    }, [groupId, steamStatus.common_games_count]);

    // 🎯 ENHANCED: Start voting session with validation
    const startVotingSession = useCallback(async () => {
        try {
            // Validate prerequisites
            if (!steamStatus.ready_for_voting) {
                toast.error('Cannot start voting: Need at least 2 Steam-connected members with common games');
                return;
            }

            if (availableGames.length === 0) {
                toast.error('No games available for voting. Sync Steam libraries first.');
                return;
            }

            const backendUrl = import.meta.env.VITE_BACKEND_URL;
            const response = await authService.authenticatedFetch(`${backendUrl}/api/live-voting/sessions`, {
                method: 'POST',
                body: JSON.stringify({
                    group_id: groupId,
                    session_name: `${group.name} Gaming Session`,
                    voting_settings: {
                        max_choices: 3,
                        time_limit: 300, // 5 minutes
                        auto_complete: true
                    }
                })
            });

            if (response.ok) {
                const data = await response.json();
                setVotingSession(data.session);
                
                // Start live voting hook
                liveVoting.startVotingSession(members, {
                    gameTitle: `${group.name} Gaming Session`,
                    votableGames: availableGames,
                    maxChoices: 3
                });

                toast.success('Voting session started!');
                setActiveTab('voting');
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to start voting');
            }
        } catch (error) {
            console.error('❌ Failed to start voting:', error);
            toast.error(`Failed to start voting: ${error.message}`);
        }
    }, [steamStatus.ready_for_voting, availableGames, groupId, group?.name, members, liveVoting]);

    // 🎯 ENHANCED: Submit votes with real-time updates
    const handleVoteSubmit = useCallback(async (gameVotes) => {
        try {
            if (!votingSession) {
                throw new Error('No active voting session');
            }

            const backendUrl = import.meta.env.VITE_BACKEND_URL;
            const response = await authService.authenticatedFetch(`${backendUrl}/api/live-voting/sessions/${votingSession.id}/submit-vote`, {
                method: 'POST',
                body: JSON.stringify({ game_votes: gameVotes })
            });

            if (response.ok) {
                const data = await response.json();
                setUserVotes(gameVotes);
                
                // Update voting metrics
                setPerformanceMetrics(prev => ({
                    ...prev,
                    votingLatency: performance.now() - (prev.voteStartTime || 0)
                }));

                toast.success('Vote submitted successfully!');
                return { success: true, data };
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to submit vote');
            }
        } catch (error) {
            console.error('❌ Vote submission failed:', error);
            toast.error(`Vote failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }, [votingSession]);

    // 🎯 ENHANCED: Handle group updates with real-time sync
    const handleGroupUpdate = useCallback((action, deleted, data) => {
        console.log('🔄 Group update:', action, deleted, data);

        if (deleted) {
            toast.info('Group was deleted. Redirecting to dashboard...');
            setTimeout(() => navigate('/dashboard'), 2000);
            return;
        }

        switch (action) {
            case 'member_kicked':
                setMembers(prev => prev.filter(m => m.id !== data.kickedMemberId));
                updateSteamStatus();
                break;
            case 'ownership_transferred':
                toast.info(`Group ownership transferred to ${data.newCreatorUsername}`);
                loadGroupData(); // Reload to get updated permissions
                break;
            case 'refreshed':
                if (data && typeof data === 'object' && data.id) {
                    setGroup(data);
                }
                break;
            default:
                // Reload data for unknown actions
                loadGroupData();
        }
    }, [navigate, loadGroupData, updateSteamStatus]);

    // 🎯 ENHANCED: Tab management with lazy loading
    const tabConfig = useMemo(() => ({
        overview: {
            label: 'Overview',
            icon: '🏠',
            component: OverviewTab,
            preload: true
        },
        gaming: {
            label: 'Gaming',
            icon: '🎮',
            component: GroupGamingTab,
            preload: steamStatus.connected_members > 0
        },
        voting: {
            label: 'Voting',
            icon: '🗳️',
            component: VotingTab,
            preload: !!votingSession,
            disabled: !steamStatus.ready_for_voting && !votingSession
        },
        members: {
            label: 'Members',
            icon: '👥',
            component: GroupMembersTab,
            preload: true
        }
    }), [steamStatus, votingSession]);

    // Load data on mount and tab changes
    useEffect(() => {
        if (groupId) {
            loadGroupData();
        }
    }, [groupId, loadGroupData]);

    // Update Steam status when members change
    useEffect(() => {
        if (members.length > 0) {
            updateSteamStatus(members);
        }
    }, [members, updateSteamStatus]);

    // Auto-refresh data periodically
    useEffect(() => {
        const interval = setInterval(() => {
            if (!loading && group) {
                loadGroupData();
            }
        }, 60000); // Refresh every minute

        return () => clearInterval(interval);
    }, [loading, group, loadGroupData]);

    if (loading) {
        return <LoadingState message={`Loading ${groupId ? 'group' : 'data'}...`} />;
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 pt-24 px-4 flex items-center justify-center">
                <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8 text-center max-w-md">
                    <div className="text-6xl mb-4">⚠️</div>
                    <h2 className="text-2xl font-bold text-white mb-4">Error Loading Group</h2>
                    <p className="text-white/70 mb-6">{error}</p>
                    <div className="space-x-4">
                        <button
                            onClick={loadGroupData}
                            className="px-6 py-3 bg-coral-500 hover:bg-coral-600 text-white font-semibold rounded-xl transition-colors duration-200"
                        >
                            Try Again
                        </button>
                        <button
                            onClick={() => navigate('/dashboard')}
                            className="px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-medium rounded-xl transition-colors duration-200"
                        >
                            Back to Dashboard
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!group) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 pt-24 px-4 flex items-center justify-center">
                <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8 text-center">
                    <div className="text-6xl mb-4">🔍</div>
                    <h2 className="text-2xl font-bold text-white mb-4">Group Not Found</h2>
                    <p className="text-white/70 mb-6">The group you're looking for doesn't exist or you don't have access to it.</p>
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="px-6 py-3 bg-coral-500 hover:bg-coral-600 text-white font-semibold rounded-xl transition-colors duration-200"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 pt-24 px-4 pb-12">
            <div className="max-w-7xl mx-auto">
                
                {/* 🎯 ENHANCED: Group Header with Live Status */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8 mb-8"
                >
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                        <div className="flex-1">
                            <div className="flex items-center space-x-4 mb-4">
                                <h1 className="text-4xl font-bold text-white">{group.name}</h1>
                                
                                {/* Live status indicators */}
                                <div className="flex items-center space-x-2">
                                    {liveVoting.isConnected && (
                                        <div className="flex items-center space-x-1 px-2 py-1 bg-green-500/20 border border-green-500/30 rounded-lg">
                                            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                            <span className="text-green-400 text-xs font-medium">Live</span>
                                        </div>
                                    )}
                                    
                                    {steamStatus.ready_for_voting && (
                                        <div className="flex items-center space-x-1 px-2 py-1 bg-blue-500/20 border border-blue-500/30 rounded-lg">
                                            <span className="text-blue-400 text-xs">🎮</span>
                                            <span className="text-blue-400 text-xs font-medium">Steam Ready</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {group.description && (
                                <p className="text-white/70 mb-4">{group.description}</p>
                            )}
                            
                            {/* Group stats */}
                            <div className="flex flex-wrap gap-4 text-sm">
                                <div className="flex items-center space-x-2">
                                    <span className="text-white/60">👥</span>
                                    <span className="text-white">{members.length} members</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <span className="text-white/60">🎮</span>
                                    <span className="text-white">{steamStatus.connected_members} Steam connected</span>
                                </div>
                                {steamStatus.common_games_count > 0 && (
                                    <div className="flex items-center space-x-2">
                                        <span className="text-white/60">🎯</span>
                                        <span className="text-white">{steamStatus.common_games_count} common games</span>
                                    </div>
                                )}
                                <div className="flex items-center space-x-2">
                                    <span className="text-white/60">👑</span>
                                    <span className="text-white">{group.creator?.username || 'Unknown'}</span>
                                </div>
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col lg:flex-row gap-3">
                            {/* Start voting button */}
                            {!votingSession && steamStatus.ready_for_voting && group.creator?.id === user?.id && (
                                <button
                                    onClick={startVotingSession}
                                    className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors duration-200 flex items-center space-x-2"
                                >
                                    <span>🚀</span>
                                    <span>Start Voting</span>
                                </button>
                            )}
                            
                            {/* Live voting session indicator */}
                            {votingSession && (
                                <button
                                    onClick={() => setActiveTab('voting')}
                                    className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors duration-200 flex items-center space-x-2 animate-pulse"
                                >
                                    <span>🗳️</span>
                                    <span>Live Voting</span>
                                </button>
                            )}
                            
                            {/* Group management */}
                            <GroupActionButtons
                                group={group}
                                user={user}
                                onGroupUpdate={handleGroupUpdate}
                            />
                        </div>
                    </div>
                </motion.div>

                {/* 🎯 ENHANCED: Voting reminders */}
                <VotingReminders
                    session={votingSession}
                    userHasVoted={liveVoting.isUserVoted?.(user?.id)}
                    timeRemaining={votingReminders.timeRemaining}
                    onVoteNow={() => setActiveTab('voting')}
                    onDismiss={votingReminders.hideReminder}
                />

                {/* 🎯 ENHANCED: Tab Navigation */}
                <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-2 mb-8">
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(tabConfig).map(([tabKey, tab]) => (
                            <button
                                key={tabKey}
                                onClick={() => !tab.disabled && setActiveTab(tabKey)}
                                disabled={tab.disabled}
                                className={`
                                    px-4 py-2 rounded-xl font-medium transition-all duration-200 flex items-center space-x-2
                                    ${activeTab === tabKey
                                        ? 'bg-coral-500 text-white shadow-lg'
                                        : tab.disabled
                                        ? 'text-white/40 cursor-not-allowed'
                                        : 'text-white/70 hover:text-white hover:bg-white/10'
                                    }
                                `}
                                title={tab.disabled ? 'Steam setup required' : ''}
                            >
                                <span>{tab.icon}</span>
                                <span>{tab.label}</span>
                                
                                {/* Tab indicators */}
                                {tabKey === 'voting' && votingSession && (
                                    <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse"></div>
                                )}
                                {tabKey === 'gaming' && steamStatus.connected_members > 0 && (
                                    <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 🎯 ENHANCED: Tab Content with Lazy Loading */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.2 }}
                    >
                        {activeTab === 'overview' && (
                            <OverviewTab
                                group={group}
                                members={members}
                                steamStatus={steamStatus}
                                votingSession={votingSession}
                                liveVoting={liveVoting}
                                user={user}
                                onStartVoting={startVotingSession}
                                performanceMetrics={performanceMetrics}
                            />
                        )}

                        {activeTab === 'gaming' && (
                            <GroupGamingTab
                                group={group}
                                members={members}
                                user={user}
                            />
                        )}

                        {activeTab === 'voting' && (
                            <VotingTab
                                group={group}
                                votingSession={votingSession}
                                availableGames={availableGames}
                                userVotes={userVotes}
                                onVoteSubmit={handleVoteSubmit}
                                liveVoting={liveVoting}
                                user={user}
                                steamStatus={steamStatus}
                            />
                        )}

                        {activeTab === 'members' && (
                            <GroupMembersTab
                                group={group}
                                user={user}
                                onGroupUpdate={handleGroupUpdate}
                            />
                        )}
                    </motion.div>
                </AnimatePresence>

                {/* 🎯 ENHANCED: Performance Debug Panel (Dev only) */}
                {process.env.NODE_ENV === 'development' && (
                    <PerformanceDebugPanel
                        metrics={performanceMetrics}
                        steamStatus={steamStatus}
                        liveVoting={liveVoting}
                        group={group}
                    />
                )}
            </div>
        </div>
    );
};

// 🎯 ENHANCED: Overview Tab Component
const OverviewTab = ({ 
    group, 
    members, 
    steamStatus, 
    votingSession, 
    liveVoting, 
    user, 
    onStartVoting,
    performanceMetrics 
}) => {
    return (
        <div className="space-y-6">
            {/* Steam Dashboard */}
            <EnhancedSteamFeatures 
                groupMembers={members} 
                groupId={group.id}
                variant="dashboard-only"
            />

            {/* Live Voting Status */}
            {votingSession && (
                <VotingStatusPanel
                    sessionId={votingSession.id}
                    groupMembers={members}
                    variant="compact"
                    showProgress={true}
                    showRecentActivity={true}
                    showMemberList={false}
                />
            )}

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Start Voting */}
                {!votingSession && steamStatus.ready_for_voting && group.creator?.id === user?.id && (
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onStartVoting}
                        className="p-6 bg-gradient-to-r from-green-500/20 to-blue-500/20 border border-green-500/30 rounded-xl hover:border-green-500/50 transition-all"
                    >
                        <div className="text-center">
                            <div className="text-3xl mb-2">🚀</div>
                            <h3 className="text-lg font-bold text-white mb-1">Start Voting</h3>
                            <p className="text-white/70 text-sm">Begin a game voting session</p>
                        </div>
                    </motion.button>
                )}

                {/* Steam Sync */}
                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => window.location.href = '/profile'}
                    className="p-6 bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 rounded-xl hover:border-blue-500/50 transition-all"
                >
                    <div className="text-center">
                        <div className="text-3xl mb-2">🎮</div>
                        <h3 className="text-lg font-bold text-white mb-1">Steam Profile</h3>
                        <p className="text-white/70 text-sm">Manage Steam integration</p>
                    </div>
                </motion.button>

                {/* Group Settings */}
                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => alert('Group settings coming soon!')}
                    className="p-6 bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 rounded-xl hover:border-purple-500/50 transition-all"
                >
                    <div className="text-center">
                        <div className="text-3xl mb-2">⚙️</div>
                        <h3 className="text-lg font-bold text-white mb-1">Settings</h3>
                        <p className="text-white/70 text-sm">Configure group options</p>
                    </div>
                </motion.button>
            </div>

            {/* Group Activity Feed (Future feature) */}
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center">
                    <span className="mr-2">📈</span>
                    Recent Activity
                </h3>
                <div className="text-center py-8">
                    <div className="text-4xl mb-4">🔄</div>
                    <h4 className="text-lg font-bold text-white mb-2">Activity Feed Coming Soon</h4>
                    <p className="text-white/60">
                        Track member joins, game sessions, votes, and more
                    </p>
                </div>
            </div>
        </div>
    );
};

// 🎯 ENHANCED: Voting Tab Component
const VotingTab = ({ 
    group, 
    votingSession, 
    availableGames, 
    userVotes, 
    onVoteSubmit, 
    liveVoting, 
    user, 
    steamStatus 
}) => {
    if (!votingSession) {
        return (
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-12 text-center">
                <div className="text-6xl mb-4">🗳️</div>
                <h3 className="text-2xl font-bold text-white mb-4">No Active Voting Session</h3>
                <p className="text-white/70 mb-6">
                    {steamStatus.ready_for_voting 
                        ? 'Ready to start voting! Ask the group creator to begin a session.'
                        : 'Steam setup required before voting can begin.'
                    }
                </p>
                
                {!steamStatus.ready_for_voting && (
                    <div className="space-y-2 text-yellow-300 text-sm">
                        <p>Setup needed:</p>
                        {steamStatus.connected_members < 2 && (
                            <p>• At least 2 members need Steam connected</p>
                        )}
                        {steamStatus.common_games_count === 0 && steamStatus.connected_members >= 2 && (
                            <p>• Members need to sync their Steam libraries</p>
                        )}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Live Voting Status */}
            <VotingStatusPanel
                sessionId={votingSession.id}
                groupMembers={liveVoting.members}
                variant="full"
                showProgress={true}
                showRecentActivity={true}
                showMemberList={true}
            />

            {/* Quick Vote Interface */}
            <QuickVote
                session={votingSession}
                games={availableGames}
                onVoteSubmit={onVoteSubmit}
                userVotes={userVotes}
                maxChoices={votingSession.voting_settings?.max_choices || 3}
            />

            {/* Live Session Link */}
            {votingSession && (
                <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 text-center">
                    <h3 className="text-lg font-bold text-white mb-4">
                        🔗 Live Voting Session
                    </h3>
                    <p className="text-white/70 mb-4">
                        Join the live voting experience with real-time updates
                    </p>
                    <button
                        onClick={() => window.open(`/live-voting/${votingSession.id}`, '_blank')}
                        className="px-6 py-3 bg-gradient-to-r from-coral-500 to-orange-500 hover:from-coral-600 hover:to-orange-600 text-white font-semibold rounded-xl transition-all duration-200"
                    >
                        Open Live Session
                    </button>
                </div>
            )}
        </div>
    );
};

// 🎯 ENHANCED: Performance Debug Panel
const PerformanceDebugPanel = ({ metrics, steamStatus, liveVoting, group }) => {
    const [showDebug, setShowDebug] = useState(false);

    if (!showDebug) {
        return (
            <div className="fixed bottom-4 right-4 z-50">
                <button
                    onClick={() => setShowDebug(true)}
                    className="px-3 py-2 bg-black/80 text-white text-xs rounded-lg border border-white/20"
                >
                    🔧 Debug
                </button>
            </div>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-50 bg-black/90 border border-white/20 rounded-lg p-4 text-xs text-white max-w-sm">
            <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-yellow-400">🔧 Performance Debug</h4>
                <button
                    onClick={() => setShowDebug(false)}
                    className="text-white/60 hover:text-white"
                >
                    ✕
                </button>
            </div>
            
            <div className="space-y-2">
                <div className="flex justify-between">
                    <span>Load Time:</span>
                    <span className="text-cyan-400">
                        {metrics.loadTime ? `${metrics.loadTime.toFixed(0)}ms` : 'N/A'}
                    </span>
                </div>
                
                <div className="flex justify-between">
                    <span>Live Voting:</span>
                    <span className={liveVoting.isConnected ? 'text-green-400' : 'text-red-400'}>
                        {liveVoting.isConnected ? 'Connected' : 'Disconnected'}
                    </span>
                </div>
                
                <div className="flex justify-between">
                    <span>Steam Coverage:</span>
                    <span className="text-purple-400">
                        {Math.round(steamStatus.coverage_percentage)}%
                    </span>
                </div>
                
                <div className="flex justify-between">
                    <span>Common Games:</span>
                    <span className="text-blue-400">{steamStatus.common_games_count}</span>
                </div>
                
                {liveVoting.isActive && (
                    <div className="flex justify-between">
                        <span>Vote Progress:</span>
                        <span className="text-green-400">{liveVoting.getProgressPercentage()}%</span>
                    </div>
                )}
                
                <div className="flex justify-between">
                    <span>Members:</span>
                    <span className="text-white">{group?.members?.length || 0}</span>
                </div>
                
                {metrics.lastUpdate && (
                    <div className="pt-2 border-t border-white/20 text-white/60">
                        Updated: {new Date(metrics.lastUpdate).toLocaleTimeString()}
                    </div>
                )}
            </div>
        </div>
    );
};

export default EnhancedGroupPage;