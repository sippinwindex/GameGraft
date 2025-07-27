
import React, { useEffect, useState } from 'react';
import { useSteam } from '../hooks/useSteam';
import { GameCard } from '../components/GameCard';
import { SteamManager } from '../components/SteamManager';
import LoadingState from '../components/LoadingState';

export const GameLibrary = () => {
    const {
        games,
        isLoading,
        error,
        syncStatus,
        actions
    } = useSteam();

    const [searchTerm, setSearchTerm] = useState('');
    const [filteredGames, setFilteredGames] = useState([]);

    useEffect(() => {
        if (games) {
            const lowercasedFilter = searchTerm.toLowerCase();
            const filtered = games.filter(game =>
                game.name.toLowerCase().includes(lowercasedFilter)
            );
            setFilteredGames(filtered);
        }
    }, [searchTerm, games]);

    if (isLoading) {
        return <LoadingState message="Loading your game library..." />;
    }

    if (error) {
        return (
            <div className="text-center text-red-500 p-8">
                <h2 className="text-2xl font-bold mb-4">Error Loading Library</h2>
                <p>{error}</p>
                <SteamManager />
            </div>
        );
    }

    if (!syncStatus.connected) {
        return (
            <div className="text-center p-8">
                <h2 className="text-2xl font-bold mb-4">Steam Account Not Connected</h2>
                <p className="mb-4">Please connect your Steam account to see your game library.</p>
                <SteamManager />
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-4xl font-bold text-white">My Game Library</h1>
                <SteamManager />
            </div>

            <div className="mb-6">
                <input
                    type="text"
                    placeholder="Search games..."
                    className="w-full p-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-neon-cyan"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {filteredGames.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                    {filteredGames.map(game => (
                        <GameCard key={game.steam_appid} game={game} />
                    ))}
                </div>
            ) : (
                <div className="text-center text-gray-400 p-8">
                    <p>No games found in your library.</p>
                </div>
            )}
        </div>
    );
};


