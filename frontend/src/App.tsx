import { useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

export default function App() {
  const [game, setGame] = useState(() => new Chess());
  const [pgnInput, setPgnInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [coachFeedback, setCoachFeedback] = useState('');

  // Micro-parser nativo para converter marcações de negrito (**) em JSX
  function parseBoldText(text: string) {
    const parts = text.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) => 
      i % 2 === 1 ? <strong key={i} className="text-emerald-300 font-semibold">{part}</strong> : part
    );
  }

  // Renderizador nativo de Markdown - Totalmente imune a crashes de objetos
  function renderCoachFeedback(rawText: string) {
    if (!rawText) return null;

    return rawText.split('\n').map((line, index) => {
      const trimmedLine = line.trim();

      // 1. Renderiza Títulos (###)
      if (trimmedLine.startsWith('###')) {
        return (
          <h3 key={index} className="text-base font-bold text-emerald-400 mt-4 mb-2 border-b border-zinc-800 pb-1">
            {parseBoldText(trimmedLine.replace('###', '').trim())}
          </h3>
        );
      }

      // 2. Renderiza Listas / Tópicos (*)
      if (trimmedLine.startsWith('*') || trimmedLine.startsWith('-')) {
        return (
          <li key={index} className="list-disc pl-2 ml-4 text-zinc-300 mb-1 leading-relaxed">
            {parseBoldText(trimmedLine.substring(1).trim())}
          </li>
        );
      }

      // 3. Renderiza Linhas Divisórias (---)
      if (trimmedLine === '---') {
        return <hr key={index} className="border-zinc-800 my-4" />;
      }

      // 4. Renderiza Parágrafos normais (ignora linhas vazias estruturais)
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

  // Captura o movimento do mouse de forma reativa e segura
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
      console.warn('Lance inválido tentado pelo usuário:', error);
    }

    return false;
  }

  // Envia o PGN para o servidor FastAPI
  async function handleAnalyze() {
    if (!pgnInput.trim()) {
      alert('Por favor, cole um PGN válido primeiro.');
      return;
    }

    setLoading(true);
    setCoachFeedback('');

    console.log('🚀 Iniciando análise. Enviando PGN para o servidor...');

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
      console.log('📥 Resposta recebida do servidor backend:', result);

      if (response.ok && result.status === 'success') {
        setCoachFeedback(String(result.coach_feedback));

        const newGame = new Chess();

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
                console.error('❌ Erro ao reproduzir lance no motor local:', err);
              }
            }
          }
        }

        setGame(newGame);
        console.log('✅ Tabuleiro sincronizado com sucesso para a posição final.');
      } else {
        const errorDetail = result.detail || result.message || 'Falha no processamento.';
        console.error('⚠️ O backend rejeitou a análise:', errorDetail);
        setCoachFeedback(
          `### 📴 IA Indisponível (Limite de Cota)\n\nO servidor processou a matemática dos lances, mas o relatório textual não pôde ser gerado pelo Gemini.\n\n**Detalhes:** ${typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail}`
        );
      }
    } catch (error) {
      console.error('💥 Erro Crítico de Rede/Conexão:', error);
      setCoachFeedback(
        '### ❌ Erro de Conexão\n\nNão foi possível conectar ao backend. Verifique se o Uvicorn está rodando.'
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
          Mova as peças para testar ou cole um PGN para analisar
        </p>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Container do Tabuleiro */}
        <div className="md:col-span-2 flex justify-center items-center bg-zinc-900 p-4 rounded-xl border border-zinc-800 shadow-xl">
          <div className="w-full max-w-[480px]">
            <Chessboard
              position={game.fen()}
              onPieceDrop={onDrop}
            />
          </div>
        </div>

        {/* Barra Lateral de Controles e Feedback */}
        <div className="flex flex-col gap-4 bg-zinc-900 p-6 rounded-xl border border-zinc-800 shadow-xl h-fit">
          <h2 className="text-xl font-semibold text-zinc-200">
            Análise da Partida
          </h2>

          <textarea
            className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500 resize-none"
            placeholder="Cole o texto do seu PGN aqui..."
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
              ? 'Analisando com Stockfish & Gemini...'
              : 'Analisar Partida'}
          </button>

          {/* Renderização Segura e Customizada */}
          {coachFeedback && (
            <div className="mt-4 p-4 bg-zinc-950 border border-zinc-800 rounded-lg max-h-80 overflow-y-auto">
              <strong className="text-emerald-400 block mb-3 text-base">
                Veredito do Coach:
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
