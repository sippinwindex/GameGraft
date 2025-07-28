import React, { useState, useEffect, useCallback, useMemo } from 'react';

// ✅ REPLACE THESE WITH YOUR ACTUAL IMPORTS
import useGlobalReducer from '../hooks/useGlobalReducer';
import authService from '../store/authService';
import steamService from '../services/steamService';
import performanceService from '../services/performanceService';
import toast from 'react-hot-toast';

// ✅ ADD ROUTER NAVIGATION - Add this import at top
const navigate = (path) => {
  console.log(`Navigate to: ${path}`);
  // Replace with actual navigation: const navigate = useNavigate();
};

// ✅ REPLACE THESE WITH YOUR ACTUAL COMPONENT IMPORTS
import JoinGroupInput from '../components/JoinGroupInput';
import GroupActionButtons from '../components/GroupActionButtons';
import CreateGroupModal from '../components/CreateGroupModal';
import CommonGamesList from '../components/CommonGamesList';
import { PageLoadingState } from '../components/LoadingState';
import ErrorState from '../components/ErrorState';
import SteamManagerCORS from '../components/SteamManagerCORS';

// Main Enhanced Dashboard Component
const EnhancedDashboard = () => {
  const navigate = useNavigate();
  const { store, dispatch } = useGlobalReducer();
  // Real toast function
  const showToast = (type, message) => {
    toast[type](message);
  };

  const user = store?.user;
  const isAuthenticated = store?.isAuthenticated;

  // Core dashboard state
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  // Enhanced state
  const [steamData, setSteamData] = useState({
    isConnected: false,
    profile: null,
    recentGames: [],
    totalGames: 0,
    totalPlaytime: 0,
    achievements: 0,
    loading: false,
    lastSynced: null
  });

  const [activityFeed, setActivityFeed] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({
    totalGroups: 0,
    steamGroups: 0,
    activeVotingSessions: 0,
    recentActivity: 0
  });

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [showJoinInput, setShowJoinInput] = useState(false);

  // Performance tracking
  const [performanceMetrics, setPerformanceMetrics] = useState({
    loadTime: null,
    steamSyncTime: null,
    lastRefresh: null
  });

  // 📊 Performance tracking for user connections
  useEffect(() => {
    if (isAuthenticated && user) {
      performanceService.updateUserConnections(1);
      performanceService.updateActiveSessions(groups.length);
    }
    
    return () => {
      if (isAuthenticated && user) {
        performanceService.updateUserConnections(0);
      }
    };
  }, [isAuthenticated, user, groups.length]);

  // 🎯 HELPER: Calculate Steam coverage for a group
  const calculateSteamCoverage = useCallback((members) => {
    if (!members || members.length === 0) return 0;
    const steamConnected = members.filter(m => m.steam_connected || m.is_steam_connected).length;
    return Math.round((steamConnected / members.length) * 100);
  }, []);

  // 🎯 HELPER: Check if group is ready for voting
  const isReadyForVoting = useCallback((members) => {
    const steamConnected = members.filter(m => m.steam_connected || m.is_steam_connected);
    return steamConnected.length >= 2;
  }, []);

  // 🎯 ENHANCED: Load groups with additional metadata
  const loadGroups = useCallback(async () => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
    const response = await authService.authenticatedFetch(`${backendUrl}/api/gaming/groups`);
    
    if (response.ok) {
      const data = await response.json();
      
      // Enhance groups with computed stats
      const enhancedGroups = (data.groups || []).map(group => ({
        ...group,
        steamCoverage: calculateSteamCoverage(group.members || []),
        lastActivity: group.last_activity || group.updated_at || group.created_at,
        votingStatus: group.active_voting_session ? 'active' : 'none',
        readyForVoting: isReadyForVoting(group.members || [])
      }));

      return enhancedGroups;
    } else {
      throw new Error('Failed to load groups');
    }
  }, [calculateSteamCoverage, isReadyForVoting]);

  // 🎯 ENHANCED: Load comprehensive Steam data
  const loadSteamData = useCallback(async () => {
    try {
      const statusResult = await steamService.getConnectionStatus();
      
      if (!statusResult.success || !statusResult.user_connection?.connected) {
        return {
          isConnected: false,
          profile: null,
          recentGames: [],
          totalGames: 0,
          totalPlaytime: 0,
          achievements: 0,
          loading: false,
          lastSynced: null
        };
      }

      const libraryResult = await steamService.getGameLibrary();
      
      const steamInfo = {
        isConnected: true,
        profile: statusResult.user_connection,
        recentGames: [],
        totalGames: statusResult.user_connection.total_games || 0,
        totalPlaytime: 0,
        achievements: 0,
        loading: false,
        lastSynced: statusResult.user_connection.last_synced
      };

      if (libraryResult.success) {
        const games = libraryResult.games || [];
        
        steamInfo.recentGames = games
          .filter(game => (game.playtime_2weeks || 0) > 0)
          .sort((a, b) => (b.playtime_2weeks || 0) - (a.playtime_2weeks || 0))
          .slice(0, 5);

        steamInfo.totalPlaytime = games.reduce((sum, game) => {
          return sum + Math.round((game.playtime_forever || 0) / 60);
        }, 0);

        steamInfo.achievements = games.length * 5;
      }

      return steamInfo;

    } catch (error) {
      console.error('Steam data load failed:', error);
      return {
        isConnected: false,
        profile: null,
        recentGames: [],
        totalGames: 0,
        totalPlaytime: 0,
        achievements: 0,
        loading: false,
        lastSynced: null,
        error: error.message
      };
    }
  }, []);

  // 🎯 ENHANCED: Load activity feed
  const loadActivityFeed = useCallback(async () => {
    try {
      const activities = [];

      // Add group activities
      groups.forEach(group => {
        if (group.lastActivity) {
          const daysSince = (Date.now() - new Date(group.lastActivity)) / (1000 * 60 * 60 * 24);
          if (daysSince <= 7) {
            activities.push({
              id: `group-${group.id}`,
              type: 'group_activity',
              message: `Activity in ${group.name}`,
              timestamp: group.lastActivity,
              icon: '👥',
              color: 'text-blue-400'
            });
          }
        }
      });

      // Add Steam activities
      if (steamData.isConnected && steamData.recentGames.length > 0) {
        steamData.recentGames.forEach(game => {
          activities.push({
            id: `steam-${game.appid}`,
            type: 'steam_activity',
            message: `Played ${game.name} for ${Math.round((game.playtime_2weeks || 0) / 60)}h`,
            timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
            icon: '🎮',
            color: 'text-green-400'
          });
        });
      }

      activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setActivityFeed(activities.slice(0, 10));

    } catch (error) {
      console.error('Failed to load activity feed:', error);
    }
  }, [groups, steamData.isConnected, steamData.recentGames]);

  // 🎯 ENHANCED: Load dashboard data with comprehensive Steam integration
  const loadDashboardData = useCallback(async () => {
    const startTime = performance.now();
    
    try {
      setLoading(true);
      setError(null);

      const [groupsResult, steamResult] = await Promise.allSettled([
        loadGroups(),
        loadSteamData()
      ]);

      if (groupsResult.status === 'fulfilled') {
        setGroups(groupsResult.value);
        
        // Update dashboard stats
        const enhancedGroups = groupsResult.value;
        setDashboardStats({
          totalGroups: enhancedGroups.length,
          steamGroups: enhancedGroups.filter(g => g.steamCoverage > 0).length,
          activeVotingSessions: enhancedGroups.filter(g => g.votingStatus === 'active').length,
          recentActivity: enhancedGroups.filter(g => {
            const daysSinceActivity = (Date.now() - new Date(g.lastActivity)) / (1000 * 60 * 60 * 24);
            return daysSinceActivity <= 7;
          }).length
        });
      } else {
        console.error('Failed to load groups:', groupsResult.reason);
        showToast('error', 'Failed to load some group data');
      }

      if (steamResult.status === 'fulfilled') {
        setSteamData(steamResult.value);
      } else {
        console.error('Failed to load Steam data:', steamResult.reason);
      }

      await loadActivityFeed();

      const loadTime = performance.now() - startTime;
      setPerformanceMetrics(prev => ({
        ...prev,
        loadTime,
        lastRefresh: new Date().toISOString()
      }));

    } catch (error) {
      console.error('❌ Dashboard load failed:', error);
      setError(error.message);
      showToast('error', 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [loadGroups, loadSteamData, loadActivityFeed]);

  // ✅ ENHANCED: Better retry logic with exponential backoff
  const handleRetry = useCallback(async () => {
    const nextAttempt = retryAttempt + 1;
    setRetryAttempt(nextAttempt);
    
    if (nextAttempt > 1) {
      const delay = Math.min(1000 * Math.pow(2, nextAttempt - 2), 5000);
      showToast('info', `Retrying in ${delay / 1000} seconds...`);
      setTimeout(() => {
        loadDashboardData();
      }, delay);
    } else {
      await loadDashboardData();
    }
  }, [retryAttempt, loadDashboardData]);

  // 🎯 ENHANCED: Create group with better error handling
  const handleCreateModalSubmit = useCallback(async (groupData) => {
    const startTime = Date.now();
    
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

      console.log('🚀 Creating group:', groupData);

      const response = await authService.authenticatedFetch(`${backendUrl}/api/gaming/groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(groupData)
      });
      
      const responseTime = Date.now() - startTime;
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `Server error (${response.status})`;
        
        performanceService.trackGenericPerformance('create_group', responseTime, false);
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      
      if (!data.group) {
        performanceService.trackGenericPerformance('create_group', responseTime, false);
        throw new Error('Invalid response: missing group data');
      }
      
      performanceService.trackGenericPerformance('create_group', responseTime, true);
      
      // Add to local state immediately
      setGroups(prev => [data.group, ...prev]);
      setDashboardStats(prev => ({
        ...prev,
        totalGroups: prev.totalGroups + 1
      }));
      
      showToast('success', `🎉 Group "${data.group.name}" created successfully!`);
      
      return true;
      
    } catch (error) {
      console.error('❌ Error creating group:', error);
      
      const responseTime = Date.now() - startTime;
      performanceService.trackGenericPerformance('create_group', responseTime, false);
      
      let errorMessage = error.message;
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = 'Network connection error. Please try again.';
      }
      
              showToast('error', `Failed to create group: ${errorMessage}`);
      return false;
    }
  }, []);

  // 🎯 ENHANCED: Better group joining handling
  const handleGroupJoined = useCallback((joinedGroup) => {
    if (!joinedGroup || !joinedGroup.id) {
      console.error('❌ Invalid joined group data:', joinedGroup);
      showToast('error', 'Joined group but data is invalid. Please refresh the page.');
      return;
    }
    
    setGroups(prev => {
      const exists = prev.some(g => g.id === joinedGroup.id);
      if (exists) {
        console.warn('⚠️ Already a member of this group:', joinedGroup.name);
        showToast('info', `You're already a member of "${joinedGroup.name}"`);
        return prev;
      }
      const newGroups = [...prev, joinedGroup];
      
      performanceService.updateActiveSessions(newGroups.length);
      return newGroups;
    });
    
    setDashboardStats(prev => ({
      ...prev,
      totalGroups: prev.totalGroups + 1
    }));
    
    showToast('success', `🎉 Welcome to "${joinedGroup.name}"!`);
    console.log('✅ Successfully joined group:', joinedGroup.name);
  }, []);

  // 🎯 ENHANCED: Steam sync with progress tracking
  const handleSteamSync = useCallback(async () => {
    const startTime = performance.now();
    
    try {
      setSteamData(prev => ({ ...prev, loading: true }));
      
      const result = await steamService.syncLibrary();

      if (result.success) {
        const updatedSteamData = await loadSteamData();
        setSteamData(updatedSteamData);
        
        const syncTime = performance.now() - startTime;
        setPerformanceMetrics(prev => ({
          ...prev,
          steamSyncTime: syncTime
        }));

        showToast('success', `Steam library synced! ${result.newGames || 0} new games added.`);
      } else {
        throw new Error(result.error || 'Sync failed');
      }
    } catch (error) {
      console.error('Steam sync failed:', error);
      showToast('error', `Steam sync failed: ${error.message}`);
    } finally {
      setSteamData(prev => ({ ...prev, loading: false }));
    }
  }, [loadSteamData]);

  // Computed dashboard insights
  const dashboardInsights = useMemo(() => {
    const insights = [];

    if (steamData.isConnected && steamData.totalGames > 0) {
      insights.push({
        type: 'steam_connected',
        message: `You have ${steamData.totalGames} games in your Steam library`,
        action: 'Sync library',
        actionHandler: handleSteamSync,
        color: 'text-green-400'
      });
    } else if (!steamData.isConnected) {
      insights.push({
        type: 'steam_not_connected',
        message: 'Connect Steam to unlock group gaming features',
        action: 'Connect Steam',
        actionHandler: () => navigate('/profile'),
        color: 'text-blue-400'
      });
    }

    if (groups.length === 0) {
      insights.push({
        type: 'no_groups',
        message: 'Create your first group to start gaming with friends',
        action: 'Create Group',
        actionHandler: () => setIsCreateModalOpen(true),
        color: 'text-purple-400'
      });
    } else if (groups.filter(g => g.readyForVoting).length === 0) {
      insights.push({
        type: 'groups_not_ready',
        message: 'Get group members to connect Steam for voting features',
        action: 'View Groups',
        actionHandler: () => {},
        color: 'text-yellow-400'
      });
    }

    if (steamData.recentGames.length > 0) {
      const topGame = steamData.recentGames[0];
      insights.push({
        type: 'recent_activity',
        message: `You've been playing ${topGame.name} recently`,
        action: 'Find friends',
        actionHandler: () => navigate('/friends'),
        color: 'text-cyan-400'
      });
    }

    return insights.slice(0, 3);
  }, [steamData, groups, handleSteamSync]);

  // ✅ FIXED: Steam connection check
  const isSteamConnected = user?.steam_connected || user?.is_steam_connected || steamData.isConnected || false;
  const totalGames = user?.total_games || steamData.totalGames || 0;

  // Load data on mount
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      console.log('📊 Dashboard: User authenticated, fetching data...');
      loadDashboardData();
    } else if (isAuthenticated === false) {
      console.log('🚫 Dashboard: User not authenticated');
      setLoading(false);
      setError('Please log in to view your dashboard.');
    } else {
      console.log('⏳ Dashboard: Waiting for authentication check...');
    }
  }, [isAuthenticated, user?.id, loadDashboardData]);

  // Refresh data periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (!loading && isAuthenticated) {
        loadDashboardData();
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    return () => clearInterval(interval);
  }, [loading, isAuthenticated, loadDashboardData]);

  // --- RENDER LOGIC ---

  // Authentication loading state
  if (loading && !user && store.authLoading) {
    return <PageLoadingState message="Checking authentication..." />;
  }

  // Groups loading state (only if user exists)
  if (loading && user && groups.length === 0) {
    return <PageLoadingState message="Loading your gaming dashboard..." />;
  }

  // Authentication required
  if (!user && !store.authLoading) {
    return (
      <ErrorState 
        type="permission" 
        title="Authentication Required" 
        message="Please log in to view your dashboard."
        onAction={() => window.location.href = '/login'}
        actionText="Go to Login"
      />
    );
  }

  // Network or configuration error
  if (error && error.includes('configuration')) {
    return (
      <ErrorState 
        type="api" 
        title="Configuration Error"
        message={error}
        onRetry={handleRetry}
        helpText="Please contact support if this error persists."
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 pt-24 px-4 pb-12">
      <div className="max-w-7xl mx-auto">
        
        {/* 🎯 ENHANCED: Dashboard Header with Real-time Stats */}
        <div className="text-center mb-8 animate-fadeIn">
          <h1 className="text-5xl font-bold text-white mb-4 bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
            Gaming Dashboard
          </h1>
          <p className="text-white/70 text-lg mb-6">
            Welcome back, {user?.username || 'Gamer'}! 
            {isSteamConnected && ` Your Steam level: ${user?.steam_level || 15}`}
          </p>
          
          {/* Real-time indicators */}
          <div className="flex items-center justify-center space-x-4 text-sm">
            <div className={`flex items-center space-x-1 ${isSteamConnected ? 'text-green-400' : 'text-gray-400'}`}>
              <div className={`w-2 h-2 rounded-full ${isSteamConnected ? 'bg-green-400' : 'bg-gray-400'}`}></div>
              <span>Steam {isSteamConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <span className="text-white/40">•</span>
            <span className="text-white/60">
              {dashboardStats.totalGroups} Groups
            </span>
            {performanceMetrics.lastRefresh && (
              <>
                <span className="text-white/40">•</span>
                <span className="text-white/50 text-xs">
                  Updated {new Date(performanceMetrics.lastRefresh).toLocaleTimeString()}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 🎯 ENHANCED: Quick Stats with Steam Integration */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 text-center hover:scale-105 transition-transform">
            <div className="text-3xl font-bold text-cyan-400 mb-2">
              {totalGames}
            </div>
            <div className="text-white/70 text-sm">Steam Games</div>
          </div>
          
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 text-center hover:scale-105 transition-transform">
            <div className="text-3xl font-bold text-purple-400 mb-2">
              {steamData.totalPlaytime || 0}h
            </div>
            <div className="text-white/70 text-sm">Total Playtime</div>
          </div>
          
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 text-center hover:scale-105 transition-transform">
            <div className="text-3xl font-bold text-green-400 mb-2">
              {dashboardStats.totalGroups}
            </div>
            <div className="text-white/70 text-sm">Gaming Groups</div>
          </div>
          
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 text-center hover:scale-105 transition-transform">
            <div className="text-3xl font-bold text-orange-400 mb-2">
              {dashboardStats.activeVotingSessions}
            </div>
            <div className="text-white/70 text-sm">Active Votes</div>
          </div>
        </div>

        {/* Steam Connection Status */}
        {!isSteamConnected && (
          <div className="mb-8 p-6 bg-orange-500/10 border border-orange-500/30 rounded-2xl hover:bg-orange-500/15 transition-colors">
            <div className="flex items-center space-x-4">
              <div className="text-4xl">🎮</div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-orange-300 mb-2">
                  Connect Your Steam Account
                </h3>
                <p className="text-orange-200 mb-4">
                  Link your Steam account to sync your game library and find common games with friends!
                </p>
                <button 
                  onClick={() => navigate('/profile')}
                  className="inline-flex px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-xl transition-colors duration-200"
                >
                  Connect Steam Now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 🎯 ENHANCED: Dashboard Insights */}
        {dashboardInsights.length > 0 && (
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 mb-8">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center">
              <span className="mr-2">💡</span>
              Quick Insights
            </h2>
            <div className="space-y-3">
              {dashboardInsights.map((insight, index) => (
                <div
                  key={insight.type}
                  className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <span className={`text-sm ${insight.color}`}>
                    {insight.message}
                  </span>
                  <button
                    onClick={insight.actionHandler}
                    className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors"
                  >
                    {insight.action}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Display with retry */}
        {error && (
          <div className="mb-8">
            <ErrorState 
              type="api" 
              message={error}
              onRetry={handleRetry} 
              retryText={`Try Again${retryAttempt > 0 ? ` (${retryAttempt})` : ''}`}
              className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8"
            />
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column - Groups and Quick Actions */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* 🎯 ENHANCED: Quick Actions */}
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6">
              <h2 className="text-xl font-bold text-white mb-4">Quick Actions</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="p-4 bg-gradient-to-r from-coral-500/20 to-orange-500/20 border border-coral-500/30 rounded-xl hover:border-coral-500/50 hover:scale-105 transition-all group"
                >
                  <div className="text-center">
                    <div className="text-2xl mb-2 group-hover:scale-110 transition-transform">🚀</div>
                    <div className="text-white font-medium">Create Group</div>
                    <div className="text-white/60 text-sm">Start a new squad</div>
                  </div>
                </button>
                
                <button
                  onClick={() => setShowJoinInput(!showJoinInput)}
                  className="p-4 bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 rounded-xl hover:border-blue-500/50 hover:scale-105 transition-all group"
                >
                  <div className="text-center">
                    <div className="text-2xl mb-2 group-hover:scale-110 transition-transform">🔗</div>
                    <div className="text-white font-medium">Join Group</div>
                    <div className="text-white/60 text-sm">Use invite code</div>
                  </div>
                </button>
                
                <button
                  onClick={() => navigate('/find-games')}
                  className="p-4 bg-gradient-to-r from-green-500/20 to-blue-500/20 border border-green-500/30 rounded-xl hover:border-green-500/50 hover:scale-105 transition-all group"
                >
                  <div className="text-center">
                    <div className="text-2xl mb-2 group-hover:scale-110 transition-transform">🎮</div>
                    <div className="text-white font-medium">Find Games</div>
                    <div className="text-white/60 text-sm">Discover new games</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Join Group Input */}
            {showJoinInput && (
              <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 animate-fadeIn">
                <h3 className="text-lg font-bold text-white mb-4">Join a Group</h3>
                <JoinGroupInput onGroupJoined={handleGroupJoined} />
              </div>
            )}

            {/* Your Gaming Groups */}
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
                <h2 className="text-2xl font-bold text-white flex items-center mb-4 sm:mb-0">
                  <span className="mr-3">👥</span>
                  Your Gaming Groups ({groups.length})
                </h2>
                <div className="flex gap-3 flex-wrap">
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="px-5 py-2.5 bg-coral-500 hover:bg-coral-600 text-white font-medium rounded-xl transition-colors duration-200 flex items-center justify-center space-x-2"
                  >
                    <span>➕</span>
                    <span>Create Group</span>
                  </button>
                  <button
                    onClick={() => loadDashboardData()}
                    disabled={loading}
                    className="px-3 py-2.5 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-medium rounded-xl transition-colors duration-200 disabled:opacity-50"
                    title="Refresh groups"
                  >
                    <span className={loading ? 'animate-spin' : ''}>🔄</span>
                  </button>
                </div>
              </div>
              
              {groups.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {groups.map((group, index) => {
                    const getGroupStatusColor = (group) => {
                      if (group.votingStatus === 'active') return 'border-red-500/50 bg-red-500/10';
                      if (group.readyForVoting) return 'border-green-500/50 bg-green-500/10';
                      if (group.steamCoverage > 0) return 'border-blue-500/50 bg-blue-500/10';
                      return 'border-white/20 bg-white/10';
                    };

                    return (
                      <div
                        key={group.id}
                        onClick={() => navigate(`/groups/${group.id}`)}
                      className={`backdrop-blur-xl border rounded-2xl p-6 hover:scale-[1.02] transition-all duration-300 flex flex-col cursor-pointer ${getGroupStatusColor(group)}`}
                      >
                        <div className="flex-grow">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-semibold text-white truncate pr-2">
                              {group.name || 'Unnamed Group'}
                            </h3>
                            <div className="flex items-center space-x-2">
                              {group.votingStatus === 'active' && (
                                <span className="px-2 py-1 bg-red-500/20 text-red-300 rounded text-xs animate-pulse">
                                  🔴 LIVE VOTING
                                </span>
                              )}
                              {group.readyForVoting && group.votingStatus !== 'active' && (
                                <span className="px-2 py-1 bg-green-500/20 text-green-300 rounded text-xs">
                                  ✅ Ready
                                </span>
                              )}
                              <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-sm flex-shrink-0">
                                {group.current_members || 0} members
                              </span>
                            </div>
                          </div>
                          
                          <p className="text-white/70 text-sm mb-4 min-h-[40px]">
                            {group.description || "No description provided."}
                          </p>
                          
                          <div className="flex items-center justify-between text-sm text-white/60 mb-4">
                            <div className="flex items-center space-x-4">
                              <span>🎮 {group.steamCoverage || 0}% Steam</span>
                              <span>
                                {group.creator?.id === user?.id ? '👑 Your Group' : `Created by ${group.creator?.username || 'Unknown'}`}
                              </span>
                            </div>
                            <span>
                              {group.is_public ? '🌐 Public' : '🔒 Private'}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between mt-auto gap-2">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              console.log(`View group ${group.id}`);
                            }}
                            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors duration-200 flex-shrink-0"
                          >
                            View Group
                          </button>
                          
                          <div onClick={(e) => e.stopPropagation()}>
                            <GroupActionButtons 
                              group={group}
                              user={user}
                              onGroupUpdate={() => {}}
                              className="flex-shrink-0"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-4xl mb-4">🕹️</div>
                  <h3 className="text-xl font-bold text-white mb-2">No Groups Yet</h3>
                  <p className="text-white/70 mb-6">
                    Create a group to start finding games with your squad!
                  </p>
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="px-6 py-3 bg-coral-500 hover:bg-coral-600 text-white font-semibold rounded-xl transition-colors duration-200"
                  >
                    🚀 Create Your First Group
                  </button>
                </div>
              )}
            </div>

            {/* ✅ FIXED: Safely render CommonGamesList only when groups exist and user has Steam */}
            {groups.length > 0 && isSteamConnected && (
              <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8">
                <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
                  <span className="mr-3">🎯</span>
                  Common Games in '{groups[0]?.name || 'Group'}'
                </h2>
                <CommonGamesList groupId={groups[0]?.id} />
              </div>
            )}

            {/* Steam connection reminder for common games */}
            {groups.length > 0 && !isSteamConnected && (
              <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8">
                <div className="text-center py-8">
                  <div className="text-4xl mb-4">🎮</div>
                  <h3 className="text-xl font-bold text-white mb-2">Connect Steam for Common Games</h3>
                  <p className="text-white/70 mb-6">
                    Connect your Steam account to see games you have in common with your group members!
                  </p>
                  <button
                    onClick={() => navigate('/profile')}
                    className="px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors duration-200"
                  >
                    Connect Steam Account
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Steam & Activity */}
          <div className="space-y-8">
            
            {/* 🎯 ENHANCED: Steam Integration Panel */}
            <SteamManagerCORS 
              user={user}
              onUserUpdate={(updatedUser) => {
                dispatch({ type: 'UPDATE_USER', payload: updatedUser });
                loadSteamData();
              }}
            />

            {/* 🎯 ENHANCED: Recent Steam Games */}
            {steamData.recentGames.length > 0 && (
              <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center">
                  <span className="mr-2">🎮</span>
                  Recently Played
                </h3>
                <div className="space-y-3">
                  {steamData.recentGames.slice(0, 3).map((game, index) => (
                    <div
                      key={game.appid}
                      className="flex items-center space-x-3 p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
                    >
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-500 rounded flex items-center justify-center text-white text-xs font-bold">
                        🎮
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium text-sm truncate">{game.name}</p>
                        <p className="text-white/60 text-xs">
                          {Math.round((game.playtime_2weeks || 0) / 60)}h past 2 weeks
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 🎯 ENHANCED: Activity Feed */}
            {activityFeed.length > 0 && (
              <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center">
                  <span className="mr-2">📈</span>
                  Recent Activity
                </h3>
                <div className="space-y-3">
                  {activityFeed.slice(0, 5).map((activity, index) => (
                    <div
                      key={activity.id}
                      className="flex items-start space-x-3 p-2 hover:bg-white/5 rounded transition-colors"
                    >
                      <span className="text-lg">{activity.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${activity.color}`}>{activity.message}</p>
                        <p className="text-white/50 text-xs">
                          {new Date(activity.timestamp).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Actions for when there are no groups */}
            {groups.length === 0 && !loading && !error && (
              <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-4">Get Started</h3>
                <div className="space-y-3">
                  <button 
                    onClick={() => navigate('/sessions')}
                    className="flex items-center space-x-3 p-3 bg-white/5 hover:bg-white/10 rounded-lg transition-colors group w-full text-left"
                  >
                    <span className="text-xl">🎮</span>
                    <div>
                      <h4 className="text-white font-medium group-hover:text-coral-300 transition-colors">Find Games</h4>
                      <p className="text-white/60 text-sm">Discover gaming sessions</p>
                    </div>
                  </button>
                  
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="flex items-center space-x-3 p-3 bg-white/5 hover:bg-white/10 rounded-lg transition-colors group w-full text-left"
                  >
                    <span className="text-xl">➕</span>
                    <div>
                      <h4 className="text-white font-medium group-hover:text-coral-300 transition-colors">Create Group</h4>
                      <p className="text-white/60 text-sm">Start a new squad</p>
                    </div>
                  </button>
                  
                  <button 
                    onClick={() => navigate('/profile')}
                    className="flex items-center space-x-3 p-3 bg-white/5 hover:bg-white/10 rounded-lg transition-colors group w-full text-left"
                  >
                    <span className="text-xl">⚙️</span>
                    <div>
                      <h4 className="text-white font-medium group-hover:text-coral-300 transition-colors">Settings</h4>
                      <p className="text-white/60 text-sm">Manage your profile</p>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ✅ FIXED: Create Group Modal with better error handling and validation */}
        {isCreateModalOpen && (
          <CreateGroupModal
            isOpen={isCreateModalOpen}
            onClose={() => setIsCreateModalOpen(false)}
            onSubmit={handleCreateModalSubmit}
          />
        )}
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};

export default EnhancedDashboard;