import { useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

export default function App() {
  const [game, setGame] = useState(() => new Chess());
  const [pgnInput, setPgnInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [coachFeedback, setCoachFeedback] = useState('');

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

      // 1. Process Level 3 Headers (###)
      if (trimmedLine.startsWith('###')) {
        return (
          <h3 key={index} className="text-base font-bold text-emerald-400 mt-4 mb-2 border-b border-zinc-800 pb-1">
            {parseBoldText(trimmedLine.replace('###', '').trim())}
          </h3>
        );
      }

      // 2. Process Bullet Lists (*)
      if (trimmedLine.startsWith('*') || trimmedLine.startsWith('-')) {
        return (
          <li key={index} className="list-disc pl-2 ml-4 text-zinc-300 mb-1 leading-relaxed">
            {parseBoldText(trimmedLine.substring(1).trim())}
          </li>
        );
      }

      // 3. Process Dividers (---)
      if (trimmedLine === '---') {
        return <hr key={index} className="border-zinc-800 my-4" />;
      }

      // 4. Process Standard Paragraph Text
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

  // Intercepts user piece interaction smoothly
  function onDrop(sourceSquare: string, targetSquare: string) {
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

    console.log('🚀 Analysis started. Sending PGN to server...');

    try {
      const response = await fetch('http://localhost:8000/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pgn_text: pgnInput,
        }),
      });

      const result = await response.json();
      console.log('📥 Server response received:', result);

      if (response.ok && result.status === 'success') {
        setCoachFeedback(String(result.coach_feedback));

        const newGame = new Chess();

        // Sequential step loop to transition the board to its final position
        if (result.data?.length) {
          for (const step of result.data) {
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
                console.error('❌ Error executing step replay on board matrix:', err);
              }
            }
          }
        }

        setGame(newGame);
        console.log('✅ Board successfully synchronized to final position.');
      } else {
        const errorDetail = result.detail || result.message || 'Processing engine fault.';
        console.error('⚠️ Backend rejected the analysis request:', errorDetail);
        setCoachFeedback(
          `### 📴 Analysis Failure\n\nThe server processed the structural move chain, but could not compile coach notes.\n\n**Details:** ${typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail}`
        );
      }
    } catch (error) {
      console.error('💥 Critical Network/Connection Exception intercepted:', error);
      setCoachFeedback(
        '### ❌ Connection Fault\n\nCould not communicate with the backend application environment at `http://localhost:8000`. Please check your Uvicorn terminal status.'
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
          Move pieces manually to test or paste a PGN block to run a complete evaluation
        </p>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Dynamic Matrix Chessboard Wrapper Container */}
        <div className="md:col-span-2 flex justify-center items-center bg-zinc-900 p-4 rounded-xl border border-zinc-800 shadow-xl">
          <div className="w-full max-w-[480px]">
            <Chessboard
              position={game.fen()}
              onPieceDrop={onDrop}
            />
          </div>
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
            {loading
              ? 'Analyzing with Stockfish & Cloud Llama...'
              : 'Analyze Match'}
          </button>

          {/* Secure Live Feedback Interface Panel */}
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
