// src/front/services/steamService.js - ENHANCED Steam Service
// Addresses Phase 1 priorities: comprehensive Steam API integration with caching

import authService from '../store/authService';

/**
 * Enhanced Steam Service with comprehensive caching and error handling
 * Implements all Steam API operations with proper performance optimization
 */
class SteamService {
    constructor() {
        this.cache = new Map();
        this.cacheTTL = {
            user_profile: 10 * 60 * 1000,    // 10 minutes
            game_library: 30 * 60 * 1000,    // 30 minutes
            common_games: 15 * 60 * 1000,    // 15 minutes
            connection_status: 5 * 60 * 1000, // 5 minutes
            achievements: 60 * 60 * 1000     // 1 hour
        };
        this.requestQueue = new Map();
        this.rateLimiter = {
            requests: 0,
            resetTime: Date.now() + 60000,
            maxRequests: 100
        };
    }

    // 🎯 ENHANCED: Cache management with TTL and smart invalidation
    getCacheKey(operation, params = {}) {
        const sortedParams = Object.keys(params)
            .sort()
            .reduce((result, key) => {
                result[key] = params[key];
                return result;
            }, {});
        return `${operation}_${JSON.stringify(sortedParams)}`;
    }

    getFromCache(key, ttl) {
        const cached = this.cache.get(key);
        if (!cached) return null;

        const { data, timestamp } = cached;
        const age = Date.now() - timestamp;
        
        if (age > ttl) {
            this.cache.delete(key);
            return null;
        }

        return data;
    }

    setCache(key, data, customTTL = null) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl: customTTL || this.cacheTTL.default || 300000
        });
    }

    invalidateCache(pattern = null) {
        if (!pattern) {
            this.cache.clear();
            return;
        }

        for (const [key] of this.cache) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
            }
        }
    }

    // 🎯 ENHANCED: Rate limiting and request deduplication
    checkRateLimit() {
        const now = Date.now();
        
        if (now > this.rateLimiter.resetTime) {
            this.rateLimiter.requests = 0;
            this.rateLimiter.resetTime = now + 60000;
        }

        if (this.rateLimiter.requests >= this.rateLimiter.maxRequests) {
            throw new Error('Rate limit exceeded. Please wait before making more requests.');
        }

        this.rateLimiter.requests++;
    }

    async deduplicateRequest(key, requestFn) {
        // Check if same request is already in progress
        if (this.requestQueue.has(key)) {
            return this.requestQueue.get(key);
        }

        // Create new request
        const promise = requestFn();
        this.requestQueue.set(key, promise);

        try {
            const result = await promise;
            this.requestQueue.delete(key);
            return result;
        } catch (error) {
            this.requestQueue.delete(key);
            throw error;
        }
    }

    // 🎯 ENHANCED: Robust API request wrapper
    async makeRequest(endpoint, options = {}) {
        this.checkRateLimit();

        const backendUrl = import.meta.env.VITE_BACKEND_URL;
        const url = `${backendUrl}${endpoint}`;

        const defaultOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 15000, // 15 second timeout
            ...options
        };

        // Add authentication
        const token = authService.getAccessToken();
        if (token) {
            defaultOptions.headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            // Create timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), defaultOptions.timeout);
            });

            // Make request with timeout
            const requestPromise = fetch(url, defaultOptions);
            const response = await Promise.race([requestPromise, timeoutPromise]);

            // Handle HTTP errors
            if (!response.ok) {
                const errorBody = await response.text();
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                
                try {
                    const errorJson = JSON.parse(errorBody);
                    errorMessage = errorJson.error || errorJson.message || errorMessage;
                } catch {
                    // Use default error message if JSON parsing fails
                }

                throw new Error(errorMessage);
            }

            const data = await response.json();
            return { success: true, data };

        } catch (error) {
            console.error(`Steam API request failed [${endpoint}]:`, error);
            
            // Enhanced error categorization
            let errorType = 'UNKNOWN_ERROR';
            if (error.message.includes('timeout')) errorType = 'TIMEOUT_ERROR';
            else if (error.message.includes('Network')) errorType = 'NETWORK_ERROR';
            else if (error.message.includes('401')) errorType = 'AUTH_ERROR';
            else if (error.message.includes('403')) errorType = 'PERMISSION_ERROR';
            else if (error.message.includes('404')) errorType = 'NOT_FOUND_ERROR';
            else if (error.message.includes('Rate limit')) errorType = 'RATE_LIMIT_ERROR';

            return {
                success: false,
                error: error.message,
                errorType,
                endpoint,
                timestamp: new Date().toISOString()
            };
        }
    }

    // 🎯 ENHANCED: Connection status with comprehensive details
    async getConnectionStatus() {
        const cacheKey = this.getCacheKey('connection_status');
        const cached = this.getFromCache(cacheKey, this.cacheTTL.connection_status);
        
        if (cached) {
            return { success: true, ...cached };
        }

        return this.deduplicateRequest(cacheKey, async () => {
            const result = await this.makeRequest('/api/steam/connection-status');
            
            if (result.success) {
                // Enhance the response with computed fields
                const enhanced = {
                    ...result.data,
                    user_connection: {
                        ...result.data.user_connection,
                        needs_sync: this.needsLibrarySync(result.data.user_connection),
                        sync_health: this.calculateSyncHealth(result.data.user_connection)
                    }
                };
                
                this.setCache(cacheKey, enhanced, this.cacheTTL.connection_status);
                return { success: true, ...enhanced };
            }
            
            return result;
        });
    }

    // 🎯 ENHANCED: OpenID connection with callback handling
    async connectViaOpenID(returnUrl = '/profile') {
        try {
            const result = await this.makeRequest('/api/steam/connect', {
                method: 'POST',
                body: JSON.stringify({ return_url: returnUrl })
            });

            if (result.success && result.data.auth_url) {
                // Invalidate connection cache since we're connecting
                this.invalidateCache('connection_status');
                
                // Redirect to Steam OpenID
                window.location.href = result.data.auth_url;
                return { success: true };
            }

            return {
                success: false,
                error: result.error || 'Failed to get Steam authentication URL'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message || 'Network error connecting to Steam'
            };
        }
    }

    // 🎯 ENHANCED: Disconnect with cleanup
    async disconnect() {
        try {
            const result = await this.makeRequest('/api/steam/disconnect', {
                method: 'POST'
            });

            if (result.success) {
                // Clear all Steam-related cache
                this.invalidateCache('steam');
                this.invalidateCache('connection');
                this.invalidateCache('game_library');
                this.invalidateCache('common_games');
            }

            return result;
        } catch (error) {
            return {
                success: false,
                error: error.message || 'Network error disconnecting Steam'
            };
        }
    }

    // 🎯 ENHANCED: Library sync with progress tracking
    async syncLibrary(progressCallback = null) {
        try {
            // Check sync eligibility first
            const statusResult = await this.getConnectionStatus();
            if (!statusResult.success) {
                throw new Error('Cannot check Steam connection status');
            }

            if (!statusResult.user_connection?.connected) {
                throw new Error('Steam account not connected');
            }

            if (!statusResult.sync_status?.can_sync) {
                const cooldown = statusResult.sync_status?.cooldown_remaining || 0;
                throw new Error(`Sync on cooldown. Wait ${cooldown} seconds.`);
            }

            // Start sync
            const result = await this.makeRequest('/api/steam/sync-library', {
                method: 'POST'
            });

            if (result.success) {
                // Invalidate game-related cache
                this.invalidateCache('game_library');
                this.invalidateCache('common_games');
                this.invalidateCache('connection_status');

                // Track sync progress if callback provided
                if (progressCallback && result.data.sync_id) {
                    this.trackSyncProgress(result.data.sync_id, progressCallback);
                }

                return {
                    success: true,
                    totalGames: result.data.total_games || 0,
                    newGames: result.data.new_games || 0,
                    updatedGames: result.data.updated_games || 0,
                    syncTime: result.data.sync_time || new Date().toISOString(),
                    syncId: result.data.sync_id
                };
            }

            return result;
        } catch (error) {
            return {
                success: false,
                error: error.message || 'Failed to sync Steam library'
            };
        }
    }

    // 🎯 NEW: Track sync progress for large libraries
    async trackSyncProgress(syncId, progressCallback) {
        const maxAttempts = 30; // 30 seconds max
        let attempts = 0;

        const checkProgress = async () => {
            try {
                const result = await this.makeRequest(`/api/steam/sync-progress/${syncId}`);
                
                if (result.success) {
                    progressCallback(result.data);
                    
                    if (result.data.status === 'completed' || result.data.status === 'failed') {
                        return;
                    }
                }

                attempts++;
                if (attempts < maxAttempts) {
                    setTimeout(checkProgress, 1000);
                }
            } catch (error) {
                console.error('Sync progress check failed:', error);
            }
        };

        setTimeout(checkProgress, 1000);
    }

    // 🎯 ENHANCED: Game library with advanced filtering
    async getGameLibrary(userId = null, filters = {}) {
        const cacheKey = this.getCacheKey('game_library', { userId, ...filters });
        const cached = this.getFromCache(cacheKey, this.cacheTTL.game_library);
        
        if (cached) {
            return { success: true, ...cached };
        }

        return this.deduplicateRequest(cacheKey, async () => {
            const params = new URLSearchParams();
            if (userId) params.append('user_id', userId);
            
            // Add filters
            Object.entries(filters).forEach(([key, value]) => {
                if (value !== null && value !== undefined) {
                    params.append(key, value);
                }
            });

            const endpoint = `/api/steam/games${params.toString() ? `?${params.toString()}` : ''}`;
            const result = await this.makeRequest(endpoint);
            
            if (result.success) {
                // Enhance games with computed properties
                const enhancedGames = result.data.games?.map(game => ({
                    ...game,
                    playtime_hours: Math.round((game.playtime_forever || 0) / 60),
                    recent_playtime_hours: Math.round((game.playtime_2weeks || 0) / 60),
                    last_played_date: game.rtime_last_played ? 
                        new Date(game.rtime_last_played * 1000) : null,
                    is_multiplayer: game.multiplayer || game.co_op || false,
                    image_urls: {
                        header: `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
                        capsule: `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/capsule_231x87.jpg`,
                        library: `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/library_600x900.jpg`
                    }
                })) || [];

                const enhanced = {
                    ...result.data,
                    games: enhancedGames,
                    stats: {
                        total_games: enhancedGames.length,
                        total_playtime_hours: enhancedGames.reduce((sum, game) => sum + game.playtime_hours, 0),
                        multiplayer_games: enhancedGames.filter(game => game.is_multiplayer).length,
                        recently_played: enhancedGames.filter(game => game.playtime_2weeks > 0).length
                    }
                };

                this.setCache(cacheKey, enhanced, this.cacheTTL.game_library);
                return { success: true, ...enhanced };
            }
            
            return result;
        });
    }

    // 🎯 ENHANCED: Common games with advanced analysis
    async getCommonGames(groupId, options = {}) {
        const cacheKey = this.getCacheKey('common_games', { groupId, ...options });
        const cached = this.getFromCache(cacheKey, this.cacheTTL.common_games);
        
        if (cached) {
            return { success: true, ...cached };
        }

        return this.deduplicateRequest(cacheKey, async () => {
            const params = new URLSearchParams();
            
            // Add options as query parameters
            Object.entries(options).forEach(([key, value]) => {
                if (value !== null && value !== undefined) {
                    params.append(key, value);
                }
            });

            const endpoint = `/api/gaming/groups/${groupId}/common-games${params.toString() ? `?${params.toString()}` : ''}`;
            const result = await this.makeRequest(endpoint);
            
            if (result.success) {
                // Enhanced analysis
                const games = result.data.games || [];
                const enhanced = {
                    ...result.data,
                    games: games.map(game => ({
                        ...game,
                        recommendation_score: this.calculateRecommendationScore(game),
                        play_compatibility: this.calculatePlayCompatibility(game),
                        genre_diversity: this.calculateGenreDiversity(game)
                    })),
                    analysis: {
                        perfect_matches: games.filter(g => g.ownership_stats?.coverage_percentage === 100).length,
                        good_matches: games.filter(g => g.ownership_stats?.coverage_percentage >= 75).length,
                        total_matches: games.length,
                        avg_coverage: games.length > 0 ? 
                            games.reduce((sum, g) => sum + (g.ownership_stats?.coverage_percentage || 0), 0) / games.length : 0,
                        multiplayer_games: games.filter(g => g.multiplayer).length,
                        coop_games: games.filter(g => g.co_op).length,
                        large_group_games: games.filter(g => (g.max_players || 0) > 4).length
                    },
                    recommendations: this.generateGameRecommendations(games)
                };

                this.setCache(cacheKey, enhanced, this.cacheTTL.common_games);
                return { success: true, ...enhanced };
            }
            
            return result;
        });
    }

    // 🎯 NEW: User achievements with progress tracking
    async getUserAchievements(appId, userId = null) {
        const cacheKey = this.getCacheKey('achievements', { appId, userId });
        const cached = this.getFromCache(cacheKey, this.cacheTTL.achievements);
        
        if (cached) {
            return { success: true, ...cached };
        }

        return this.deduplicateRequest(cacheKey, async () => {
            const params = new URLSearchParams();
            if (userId) params.append('user_id', userId);

            const endpoint = `/api/steam/achievements/${appId}${params.toString() ? `?${params.toString()}` : ''}`;
            const result = await this.makeRequest(endpoint);
            
            if (result.success) {
                // Calculate achievement stats
                const achievements = result.data.achievements || [];
                const enhanced = {
                    ...result.data,
                    stats: {
                        total_achievements: achievements.length,
                        unlocked_achievements: achievements.filter(a => a.achieved).length,
                        completion_percentage: achievements.length > 0 ? 
                            (achievements.filter(a => a.achieved).length / achievements.length) * 100 : 0,
                        rare_achievements: achievements.filter(a => a.percent && a.percent < 5).length
                    }
                };

                this.setCache(cacheKey, enhanced, this.cacheTTL.achievements);
                return { success: true, ...enhanced };
            }
            
            return result;
        });
    }

    // 🎯 HELPER: Calculate recommendation score for games
    calculateRecommendationScore(game) {
        let score = 0;
        
        // Base score from ownership coverage
        const coverage = game.ownership_stats?.coverage_percentage || 0;
        score += coverage;
        
        // Bonus for multiplayer features
        if (game.multiplayer) score += 20;
        if (game.co_op) score += 15;
        if (game.max_players && game.max_players > 4) score += 10;
        
        // Bonus for recent activity
        if (game.recent_players && game.recent_players > 0) score += 10;
        
        // Penalty for very low ownership
        if (coverage < 25) score -= 20;
        
        return Math.max(0, Math.min(100, score));
    }

    // 🎯 HELPER: Calculate play compatibility
    calculatePlayCompatibility(game) {
        const factors = {
            multiplayer: game.multiplayer ? 1 : 0,
            co_op: game.co_op ? 1 : 0,
            large_group: (game.max_players && game.max_players > 4) ? 1 : 0,
            cross_platform: game.cross_platform ? 1 : 0
        };
        
        const score = Object.values(factors).reduce((sum, val) => sum + val, 0);
        const maxScore = Object.keys(factors).length;
        
        return Math.round((score / maxScore) * 100);
    }

    // 🎯 HELPER: Calculate genre diversity
    calculateGenreDiversity(game) {
        const genres = game.genres || [];
        if (genres.length === 0) return 0;
        
        // More genres = higher diversity
        return Math.min(100, (genres.length / 5) * 100);
    }

    // 🎯 HELPER: Generate game recommendations
    generateGameRecommendations(games) {
        if (!games || games.length === 0) return [];

        // Sort by recommendation score
        const sortedGames = [...games].sort((a, b) => 
            (b.recommendation_score || 0) - (a.recommendation_score || 0)
        );

        return {
            top_picks: sortedGames.slice(0, 3),
            multiplayer_focus: sortedGames.filter(g => g.multiplayer).slice(0, 3),
            coop_focus: sortedGames.filter(g => g.co_op).slice(0, 3),
            large_group: sortedGames.filter(g => (g.max_players || 0) > 4).slice(0, 3)
        };
    }

    // 🎯 HELPER: Check if library sync is needed
    needsLibrarySync(connectionData) {
        if (!connectionData || !connectionData.connected) return false;
        if (!connectionData.last_synced) return true;
        
        const lastSync = new Date(connectionData.last_synced);
        const daysSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60 * 24);
        
        return daysSinceSync > 7; // Recommend sync if older than 7 days
    }

    // 🎯 HELPER: Calculate sync health score
    calculateSyncHealth(connectionData) {
        if (!connectionData || !connectionData.connected) return 0;
        
        let score = 50; // Base score for being connected
        
        if (connectionData.last_synced) {
            const lastSync = new Date(connectionData.last_synced);
            const daysSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60 * 24);
            
            if (daysSinceSync < 1) score += 50;        // Very recent
            else if (daysSinceSync < 3) score += 35;   // Recent
            else if (daysSinceSync < 7) score += 20;   // Acceptable
            else if (daysSinceSync < 30) score += 10;  // Old
            // Older than 30 days: no bonus
        }
        
        if (connectionData.total_games > 0) score += 10; // Has games
        
        return Math.min(100, score);
    }

    // 🎯 UTILITY: Clear all cache
    clearCache() {
        this.cache.clear();
        console.log('🧹 Steam service cache cleared');
    }

    // 🎯 UTILITY: Get cache statistics
    getCacheStats() {
        const stats = {
            total_entries: this.cache.size,
            entries_by_type: {},
            memory_usage_estimate: 0
        };

        for (const [key, value] of this.cache) {
            const type = key.split('_')[0];
            stats.entries_by_type[type] = (stats.entries_by_type[type] || 0) + 1;
            stats.memory_usage_estimate += JSON.stringify(value).length;
        }

        return stats;
    }
}

// Export singleton instance
const steamService = new SteamService();
export default steamService;