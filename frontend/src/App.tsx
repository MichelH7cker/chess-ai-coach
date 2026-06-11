import { useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

export default function App() {
  // Initialize chess.js game state
  const [game, setGame] = useState(new Chess());
  const [gameFen, setGameFen] = useState(game.fen());

  // Handle piece drops on the board
  function makeAMove(move: any) {
    try {
      const result = game.move(move);
      if (result) {
        setGameFen(game.fen());
        return true;
      }
    } catch (error) {
      return false; // Illegal move
    }
    return false;
  }

  function onDrop(sourceSquare: string, targetSquare: string) {
    const move = makeAMove({
      from: sourceSquare,
      to: targetSquare,
      promotion: 'q', // Always promote to queen for simplicity in this MVP
    });
    return move;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-emerald-400 mb-2">Chess AI Coach</h1>
        <p className="text-gray-400">Move the pieces or paste a PGN to begin analysis</p>
      </header>

      <main className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left/Center: The Chessboard container */}
        <div className="md:col-span-2 flex justify-center items-center bg-zinc-900 p-4 rounded-xl border border-zinc-800 shadow-xl">
          <div className="w-full max-w-[500px] aspect-square">
            <Chessboard position={gameFen} onPieceDrop={onDrop} boardWidth={500} />
          </div>
        </div>

        {/* Right: The Sidebar for PGN Input and AI Feedback */}
        <div className="flex flex-col gap-4 bg-zinc-900 p-6 rounded-xl border border-zinc-800 shadow-xl">
          <h2 className="text-xl font-semibold text-zinc-200">Analysis Control</h2>
          
          <textarea 
            className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500 resize-none"
            placeholder="Paste your PGN text here..."
          />

          <button className="w-full bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-bold py-3 px-4 rounded-lg transition-colors shadow-md">
            Analyze Game
          </button>
        </div>
      </main>
    </div>
  );
}
