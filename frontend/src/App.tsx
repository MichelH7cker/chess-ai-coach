import { useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

interface ChessStep {
  move_played_san: string;
  move_played_uci: string;
  tag_key: string;
}

export default function App() {
  const [game, setGame] = useState(() => new Chess());
  const [pgnInput, setPgnInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [rawCoachFeedback, setRawCoachFeedback] = useState('');
  const [moveHistory, setMoveHistory] = useState<ChessStep[]>([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState<number>(-1); 
  const [forcingOverviewView, setForcingOverviewView] = useState<boolean>(false);

  // Native regex text analyzer to interpret Markdown markup safely
  function parseBoldText(text: string) {
    const parts = text.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) => 
      i % 2 === 1 ? <strong key={i} className="text-emerald-300 font-semibold">{part}</strong> : part
    );
  }

  function renderMarkdownBlocks(rawText: string) {
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

      return <div key={index} className="h-1" />;
    });
  }

  function extractTagContent(fullText: string, tagName: string): string {
    const escapedTag = tagName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\[${escapedTag}\\]([\\s\\S]*?)\\[\\/${escapedTag}\\]`, 'i');
    const match = fullText.match(regex);
    return match ? match[1].trim() : '';
  }

  function getActiveFeedbackBlock(): string {
    if (!rawCoachFeedback) return '';
    
    if (currentMoveIndex === -1 || forcingOverviewView) {
      const overviewText = extractTagContent(rawCoachFeedback, 'OVERVIEW');
      return overviewText || "### Match Loaded\nUse the navigation controls below the chessboard to step through individual move reviews.";
    }
    
    const currentStep = moveHistory[currentMoveIndex];
    if (currentStep) {
      const stepText = extractTagContent(rawCoachFeedback, currentStep.tag_key);
      return stepText || `### Move ${Math.floor((currentMoveIndex + 2) / 2)} Analysis\n*No explicit errors detected by Stockfish for this position matrix.*`;
    }

    return '';
  }

  // DYNAMIC SQUARE STYLING CALCULATOR
  // Computes overlay highlight markers using raw UCI positional coordinates
  function getCustomSquareStyles() {
    if (currentMoveIndex === -1 || moveHistory.length === 0) return {};

    const currentStep = moveHistory[currentMoveIndex];
    if (!currentStep || !currentStep.move_played_uci) return {};

    const uci = currentStep.move_played_uci;
    const fromSquare = uci.slice(0, 2);
    const toSquare = uci.slice(2, 4);

    // Returns soft, semi-transparent highlight overlays mirroring premium chess clients
    return {
      [fromSquare]: {
        backgroundColor: 'rgba(251, 191, 36, 0.25)', // Smooth ambient amber for origin square
      },
      [toSquare]: {
        backgroundColor: 'rgba(52, 211, 153, 0.35)', // Vibrant emerald tint for target square
      },
    };
  }

  function pgnReplayToPosition(history: ChessStep[], targetIndex: number) {
    setForcingOverviewView(false);

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
          console.error('❌ Error executing step replay on board matrix:', err);
        }
      }
    }
    setGame(newGame);
    setCurrentMoveIndex(targetIndex);
  }

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

  function handleResetAnalysis() {
    setGame(new Chess());
    setPgnInput('');
    setRawCoachFeedback('');
    setMoveHistory([]);
    setCurrentMoveIndex(-1);
    setForcingOverviewView(false);
  }

  function onDrop(sourceSquare: string, targetSquare: string) {
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

  async function handleAnalyze() {
    if (!pgnInput.trim()) {
      alert('Please paste a valid PGN string before running analysis.');
      return;
    }

    setLoading(true);
    setRawCoachFeedback('');
    setMoveHistory([]);
    setCurrentMoveIndex(-1);
    setForcingOverviewView(false);

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
        setRawCoachFeedback(String(result.coach_feedback_raw));
        
        const backendMoves = result.data || [];
        setMoveHistory(backendMoves);

        setGame(new Chess());
        setCurrentMoveIndex(-1);
        console.log('✅ Match loaded successfully into state engine.');
      } else {
        const errorDetail = result.detail || result.message || 'Processing engine fault.';
        setRawCoachFeedback(
          `[OVERVIEW]\n### 📴 Analysis Failure\n\nThe server processed the structural move chain, but could not compile dynamic coach notes.\n\n**Details:** ${typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail}\n[/OVERVIEW]`
        );
      }
    } catch (error) {
      console.error('💥 Critical Network Error:', error);
      setRawCoachFeedback(
        '[OVERVIEW]\n### ❌ Connection Fault\n\nCould not communicate with the backend application environment.\n[/OVERVIEW]'
      );
    } finally {
      setLoading(false);
    }
  }

  const activeFeedbackContent = getActiveFeedbackBlock();
  const hasAnalysisData = moveHistory.length > 0;
  const currentHighlightStyles = getCustomSquareStyles();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-zinc-950 text-zinc-100 font-sans">
      <header className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-emerald-400 mb-1">
          Chess AI Coach
        </h1>
        <p className="text-sm text-gray-400">
          High-accuracy Stockfish evaluations paired with contextual, sarcastic coaching reviews
        </p>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
        {/* Board Container Column Layout wrapper */}
        <div className="md:col-span-2 flex flex-col items-center bg-zinc-900 p-6 rounded-xl border border-zinc-800 shadow-xl gap-4">
          <div className="w-full max-w-[480px]">
            <Chessboard
              position={game.fen()}
              onPieceDrop={onDrop}
              arePiecesDraggable={!hasAnalysisData}
              customSquareStyles={currentHighlightStyles} // Injected dynamic highlight map object
            />
          </div>

          {/* Interactive Navigation Control Bar */}
          {hasAnalysisData && (
            <div className="flex flex-col items-center gap-2 w-full max-w-[480px] bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-inner">
              <div className="flex justify-between items-center w-full gap-2">
                <button onClick={handleJumpToStart} disabled={currentMoveIndex === -1} className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold py-2 rounded transition-colors cursor-pointer">« Start</button>
                <button onClick={handlePreviousMove} disabled={currentMoveIndex === -1} className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold py-2 rounded transition-colors cursor-pointer">‹ Back</button>
                <button onClick={handleNextMove} disabled={currentMoveIndex === moveHistory.length - 1} className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold py-2 rounded transition-colors cursor-pointer">Next ›</button>
                <button onClick={handleJumpToEnd} disabled={currentMoveIndex === moveHistory.length - 1} className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold py-2 rounded transition-colors cursor-pointer">End »</button>
              </div>
              <div className="text-xs text-zinc-400 mt-1 font-mono">
                Position: <span className="text-emerald-400 font-bold">{currentMoveIndex + 1}</span> / {moveHistory.length} 
                {currentMoveIndex >= 0 && ` (${moveHistory[currentMoveIndex].move_played_san})`}
              </div>
            </div>
          )}
        </div>

        {/* Evaluation Control Panel Sidebar Area */}
        <div className="flex flex-col bg-zinc-900 p-6 rounded-xl border border-zinc-800 shadow-xl min-h-[570px] w-full transition-all">
          <div className="flex justify-between items-center mb-4 border-b border-zinc-800 pb-2">
            <h2 className="text-xl font-semibold text-zinc-200">
              {hasAnalysisData ? "Coach Dashboard" : "Game Analysis"}
            </h2>
            {hasAnalysisData && (
              <button 
                onClick={handleResetAnalysis}
                className="text-xs bg-zinc-800 text-zinc-400 hover:bg-red-950 hover:text-red-400 border border-zinc-700 px-2 py-1 rounded transition-all font-semibold cursor-pointer"
              >
                Reset App
              </button>
            )}
          </div>

          {!hasAnalysisData ? (
            <div className="flex flex-col gap-4 flex-1">
              <textarea
                className="w-full h-80 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500 resize-none font-mono"
                placeholder="Paste your game PGN metadata block here..."
                value={pgnInput}
                onChange={(e) => setPgnInput(e.target.value)}
                disabled={loading}
              />

              <button
                onClick={handleAnalyze}
                disabled={loading}
                className={`w-full font-bold py-3 px-4 rounded-lg transition-colors shadow-md cursor-pointer ${
                  loading
                    ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                    : 'bg-emerald-500 hover:bg-emerald-600 text-zinc-950'
                }`}
              >
                {loading ? 'Processing Stockfish Matrix...' : 'Analyze Match'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col flex-1 gap-3 h-full">
              <div className="flex gap-2">
                <button
                  onClick={() => setForcingOverviewView(true)}
                  className={`flex-1 text-xs py-1.5 px-3 rounded font-medium border transition-all cursor-pointer ${
                    forcingOverviewView || currentMoveIndex === -1
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  📋 View Match Overview
                </button>
              </div>

              {activeFeedbackContent && (
                <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg p-4 h-[410px] overflow-y-auto shadow-inner">
                  <strong className="text-emerald-400 block mb-2 text-sm uppercase tracking-wider font-mono">
                    {forcingOverviewView || currentMoveIndex === -1 ? "Overview Verdict:" : "Live Move Verdict:"}
                  </strong>
                  <div className="text-sm text-zinc-300">
                    {renderMarkdownBlocks(activeFeedbackContent)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
