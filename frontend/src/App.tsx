import { useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

interface ChessStep {
  move_played_san: string;
  move_played_uci: string;
}

export default function App() {
  const [game, setGame] = useState(() => new Chess());
  const [pgnInput, setPgnInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [coachFeedback, setCoachFeedback] = useState('');
  
  // New state variables to track move history navigation
  const [moveHistory, setMoveHistory] = useState<ChessStep[]>([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState<number>(-1); // -1 means starting position

  // Native regex text analyzer to interpret Markdown markup without external dependencies
  function parseBoldText(text: string) {
    const parts = text.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) => 
      i % 2 === 1 ? <strong key={i} className="text-emerald-300 font-semibold">{part}</strong> : part
    );
  }

  function renderCoachFeedback(rawText: string) {
    if (!rawText) return null;

    return rawText.split('\n').map((line, index) => {
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('###')) {
        return (
          <h3 key={index} className="text-base font-bold text-emerald-400 mt-4 mb-2 border-b border-zinc-800 pb-1">
            {parseBoldText(trimmedLine.replace('###', '').trim())}
          </h3>
        );
      }

      if (trimmedLine.startsWith('*') || trimmedLine.startsWith('-')) {
        return (
          <li key={index} className="list-disc pl-2 ml-4 text-zinc-300 mb-1 leading-relaxed">
            {parseBoldText(trimmedLine.substring(1).trim())}
          </li>
        );
      }

      if (trimmedLine === '---') {
        return <hr key={index} className="border-zinc-800 my-4" />;
      }

      if (trimmedLine.length > 0) {
        return (
          <p key={index} className="text-zinc-300 mb-3 leading-relaxed">
            {parseBoldText(trimmedLine)}
          </p>
        );
      }

      return <div key={index} className="h-2" />;
    });
  }

  // Replays the game from the absolute beginning up to a specific move index
  function pgnReplayToPosition(history: ChessStep[], targetIndex: number) {
    const newGame = new Chess();
    
    for (let i = 0; i <= targetIndex; i++) {
      const step = history[i];
      try {
        newGame.move(step.move_played_san);
      } catch {
        try {
          const uci = step.move_played_uci;
          newGame.move({
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            promotion: 'q',
          });
        } catch (err) {
          console.error('❌ Error executing step replay on matrix:', err);
        }
      }
    }
    
    setGame(newGame);
    setCurrentMoveIndex(targetIndex);
  }

  // Navigation Control Handlers
  function handleJumpToStart() {
    if (moveHistory.length === 0) return;
    pgnReplayToPosition(moveHistory, -1);
  }

  function handlePreviousMove() {
    if (currentMoveIndex > -1) {
      pgnReplayToPosition(moveHistory, currentMoveIndex - 1);
    }
  }

  function handleNextMove() {
    if (currentMoveIndex < moveHistory.length - 1) {
      pgnReplayToPosition(moveHistory, currentMoveIndex + 1);
    }
  }

  function handleJumpToEnd() {
    if (moveHistory.length === 0) return;
    pgnReplayToPosition(moveHistory, moveHistory.length - 1);
  }

  // Intercepts user piece interaction smoothly
  function onDrop(sourceSquare: string, targetSquare: string) {
    // Disable manual moving if we are actively analyzing a loaded PGN history sequence
    if (moveHistory.length > 0) return false;

    const gameCopy = new Chess(game.fen());
    try {
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });

      if (move) {
        setGame(gameCopy);
        return true;
      }
    } catch (error) {
      console.warn('Invalid move attempted by user:', error);
    }
    return false;
  }

  // Dispatches current input text state to backend endpoints
  async function handleAnalyze() {
    if (!pgnInput.trim()) {
      alert('Please paste a valid PGN string before running analysis.');
      return;
    }

    setLoading(true);
    setCoachFeedback('');
    setMoveHistory([]);
    setCurrentMoveIndex(-1);

    console.log('🚀 Analysis started. Sending PGN to server...');

    try {
      const response = await fetch('http://localhost:8000/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pgn_text: pgnInput }),
      });

      const result = await response.json();
      console.log('📥 Server response received:', result);

      if (response.ok && result.status === 'success') {
        setCoachFeedback(String(result.coach_feedback));
        
        const backendMoves = result.data || [];
        setMoveHistory(backendMoves);

        // Sync the board directly to the final move position upon loading completion
        if (backendMoves.length > 0) {
          pgnReplayToPosition(backendMoves, backendMoves.length - 1);
        } else {
          setGame(new Chess());
        }
        console.log('✅ Board successfully synchronized to final position.');
      } else {
        const errorDetail = result.detail || result.message || 'Processing engine fault.';
        setCoachFeedback(
          `### 📴 Analysis Failure\n\nThe server processed the structural move chain, but could not compile coach notes.\n\n**Details:** ${typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail}`
        );
      }
    } catch (error) {
      console.error('💥 Critical Network Error:', error);
      setCoachFeedback(
        '### ❌ Connection Fault\n\nCould not communicate with the backend application environment.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-zinc-950 text-zinc-100 font-sans">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-emerald-400 mb-2">
          Chess AI Coach
        </h1>
        <p className="text-gray-400">
          Paste a PGN block to run an evaluation and replay the match step-by-step
        </p>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Board Container Column */}
        <div className="md:col-span-2 flex flex-col items-center bg-zinc-900 p-6 rounded-xl border border-zinc-800 shadow-xl gap-4">
          <div className="w-full max-w-[480px]">
            <Chessboard
              position={game.fen()}
              onPieceDrop={onDrop}
              arePiecesDraggable={moveHistory.length === 0} // Lock dragging if reviewing a PGN match
            />
          </div>

          {/* Interactive Navigation Control Bar */}
          {moveHistory.length > 0 && (
            <div className="flex flex-col items-center gap-2 w-full max-w-[480px] bg-zinc-950 p-3 rounded-lg border border-zinc-800">
              <div className="flex justify-between items-center w-full gap-2">
                <button onClick={handleJumpToStart} disabled={currentMoveIndex === -1} className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs font-bold py-2 rounded transition-colors">« Start</button>
                <button onClick={handlePreviousMove} disabled={currentMoveIndex === -1} className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs font-bold py-2 rounded transition-colors">‹ Back</button>
                <button onClick={handleNextMove} disabled={currentMoveIndex === moveHistory.length - 1} className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs font-bold py-2 rounded transition-colors">Next ›</button>
                <button onClick={handleJumpToEnd} disabled={currentMoveIndex === moveHistory.length - 1} className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs font-bold py-2 rounded transition-colors">End »</button>
              </div>
              <div className="text-xs text-zinc-400 mt-1 font-mono">
                Move: <span className="text-emerald-400 font-bold">{currentMoveIndex + 1}</span> / {moveHistory.length} 
                {currentMoveIndex >= 0 && ` (${moveHistory[currentMoveIndex].move_played_san})`}
              </div>
            </div>
          )}
        </div>

        {/* Evaluation Control Panel Sidebar Area */}
        <div className="flex flex-col gap-4 bg-zinc-900 p-6 rounded-xl border border-zinc-800 shadow-xl h-fit">
          <h2 className="text-xl font-semibold text-zinc-200">
            Game Analysis
          </h2>

          <textarea
            className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500 resize-none"
            placeholder="Paste your game PGN metadata block here..."
            value={pgnInput}
            onChange={(e) => setPgnInput(e.target.value)}
            disabled={loading}
          />

          <button
            onClick={handleAnalyze}
            disabled={loading}
            className={`w-full font-bold py-3 px-4 rounded-lg transition-colors shadow-md ${
              loading
                ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                : 'bg-emerald-500 hover:bg-emerald-600 text-zinc-950'
            }`}
          >
            {loading ? 'Processing Match Context...' : 'Analyze Match'}
          </button>

          {coachFeedback && (
            <div className="mt-4 p-4 bg-zinc-950 border border-zinc-800 rounded-lg max-h-80 overflow-y-auto">
              <strong className="text-emerald-400 block mb-3 text-base">
                Coach Verdict:
              </strong>
              <div className="text-sm text-zinc-300">
                {renderCoachFeedback(coachFeedback)}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
