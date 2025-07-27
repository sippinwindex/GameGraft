import React from 'react';
import useSteamConnection from '../hooks/useSteamConnection';

export const SteamManager = () => {
    const { 
        isConnected: isSteamConnected,
        loading: isLoading,
        steamUsername,
        steamId,
        connectViaOpenID,
        disconnect
    } = useSteamConnection();

    // Map useSteamConnection methods to match original useSteam API
    const connectSteam = () => connectViaOpenID('/profile');
    const disconnectSteam = () => disconnect();

    if (isLoading) {
        return <div>Loading...</div>;
    }

    return (
        <div>
            {isSteamConnected ? (
                <div className="flex items-center">
                    <p className="mr-4">
                        Connected as {steamUsername || steamId || 'Steam User'}
                    </p>
                    <button 
                        onClick={disconnectSteam} 
                        className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
                    >
                        Disconnect
                    </button>
                </div>
            ) : (
                <button 
                    onClick={connectSteam} 
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                    Connect with Steam
                </button>
            )}
        </div>
    );
};