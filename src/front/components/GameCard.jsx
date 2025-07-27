import React from 'react';

export const GameCard = ({ game }) => {
    return (
        <div className="bg-gray-800 rounded-lg overflow-hidden shadow-lg hover:shadow-neon-cyan transition-shadow duration-300">
            <img src={game.header_image} alt={game.name} className="w-full h-48 object-cover" />
            <div className="p-4">
                <h3 className="text-lg font-bold text-white">{game.name}</h3>
                <p className="text-sm text-gray-400">Playtime: {Math.round(game.playtime_forever / 60)} hours</p>
            </div>
        </div>
    );
};


