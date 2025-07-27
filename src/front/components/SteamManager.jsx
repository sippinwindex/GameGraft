import React from 'react';
import { useSteam } from '../hooks/useSteam';

export const SteamManager = () => {
    const { steamId, isSteamConnected, isLoading, connectSteam, disconnectSteam } = useSteam();

    if (isLoading) {
        return <div>Loading...</div>;
    }

    return (
        <div>
            {isSteamConnected ? (
                <div className="flex items-center">
                    <p className="mr-4">Connected as {steamId}</p>
                    <button onClick={disconnectSteam} className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">
                        Disconnect
                    </button>
                </div>
            ) : (
                <button onClick={connectSteam} className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                    Connect with Steam
                </button>
            )}
        </div>
    );
};


