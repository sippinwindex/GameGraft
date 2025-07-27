import React, { useEffect, useState } from 'react';
import useSteamConnection from '../hooks/useSteamConnection';
import { GameCard } from '../components/GameCard';
import SteamManagerCORS from '../components/SteamManagerCORS';
import LoadingState from '../components/LoadingState';

export const GameLibrary = () => {
    const {
        loading: isLoading,
        error,
        isConnected,
        steamUsername,
        totalGames,
        getOwnedGames,
        needsAttention
    } = useSteamConnection();

    const [searchTerm, setSearchTerm] = useState('');
    const [games, setGames] = useState([]);
    const [filteredGames, setFilteredGames] = useState([]);
    const [gamesLoading, setGamesLoading] = useState(false);
    const [gamesError, setGamesError] = useState(null);

    // Load games when connected
    useEffect(() => {
        if (isConnected && !gamesLoading) {
            loadGames();
        }
    }, [isConnected]);

    // Filter games based on search term
    useEffect(() => {
        if (games) {
            const lowercasedFilter = searchTerm.toLowerCase();
            const filtered = games.filter(game =>
                game.name.toLowerCase().includes(lowercasedFilter)
            );
            setFilteredGames(filtered);
        }
    }, [searchTerm, games]);

    const loadGames = async () => {
        setGamesLoading(true);
        setGamesError(null);
        
        try {
            const result = await getOwnedGames();
            if (result.success) {
                setGames(result.games || []);
            } else {
                setGamesError(result.error || 'Failed to load games');
            }
        } catch (err) {
            setGamesError('Failed to load games');
            console.error('Error loading games:', err);
        } finally {
            setGamesLoading(false);
        }
    };

    // Show loading state during initial connection check
    if (isLoading) {
        return <LoadingState message="Loading your game library..." />;
    }

    // Show error if there's a connection error
    if (error) {
        return (
            <div className="text-center text-red-500 p-8">
                <h2 className="text-2xl font-bold mb-4">Error Loading Library</h2>
                <p>{error}</p>
                <SteamManagerCORS />
            </div>
        );
    }

    // Show Steam connection required
    if (!isConnected) {
        return (
            <div className="text-center p-8">
                <h2 className="text-2xl font-bold mb-4">Steam Account Not Connected</h2>
                <p className="mb-4">Please connect your Steam account to see your game library.</p>
                <SteamManagerCORS />
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-4xl font-bold text-white">My Game Library</h1>
                    {steamUsername && (
                        <p className="text-white/70 mt-1">
                            {steamUsername} • {totalGames} games
                        </p>
                    )}
                </div>
                <SteamManagerCORS />
            </div>

            {/* Show attention notice if needed */}
            {needsAttention() && (
                <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-yellow-300">
                        Your Steam connection may need attention. Check the Steam Manager above.
                    </p>
                </div>
            )}

            <div className="mb-6 flex space-x-4">
                <input
                    type="text"
                    placeholder="Search games..."
                    className="flex-1 p-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-neon-cyan"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button
                    onClick={loadGames}
                    disabled={gamesLoading}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 text-white rounded-lg transition-colors"
                >
                    {gamesLoading ? 'Loading...' : 'Refresh Games'}
                </button>
            </div>

            {/* Games loading state */}
            {gamesLoading && (
                <div className="text-center p-8">
                    <LoadingState message="Loading your games..." />
                </div>
            )}

            {/* Games error */}
            {gamesError && (
                <div className="text-center text-red-500 p-8">
                    <h3 className="text-lg font-bold mb-2">Error Loading Games</h3>
                    <p>{gamesError}</p>
                    <button
                        onClick={loadGames}
                        className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                    >
                        Try Again
                    </button>
                </div>
            )}

            {/* Games display */}
            {!gamesLoading && !gamesError && (
                <>
                    {filteredGames.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                            {filteredGames.map(game => (
                                <GameCard key={game.steam_appid || game.appid || game.id} game={game} />
                            ))}
                        </div>
                    ) : games.length > 0 ? (
                        <div className="text-center text-gray-400 p-8">
                            <p>No games match your search "{searchTerm}".</p>
                        </div>
                    ) : (
                        <div className="text-center text-gray-400 p-8">
                            <p>No games found in your library. Try syncing your Steam library above.</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};