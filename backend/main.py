import io
import os
import chess.pgn
import chess.engine
from google import genai
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables from the .env file
load_dotenv()

try:
    client = genai.Client()
except Exception as e:
    print(f"Error initializing Gemini Client: {e}")

app = FastAPI(title="Chess AI Coach API")

# Path to the Stockfish binary on Linux
STOCKFISH_PATH = "/usr/bin/stockfish"

class GameInput(BaseModel):
    pgn_text: str

@app.get("/")
async def root():
    return {"message": "Chess AI Coach API is running!"}

@app.post("/analyze")
async def analyze_game(game_input: GameInput):
    try:
        pgn_io = io.StringIO(game_input.pgn_text)
        game = chess.pgn.read_game(pgn_io)
        
        if game is None:
            raise HTTPException(status_code=400, detail="Invalid PGN format")

        board = game.board()
        engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
        
        analysis_results = []
        
        initial_info = engine.analyse(board, chess.engine.Limit(depth=10))
        previous_score = initial_info["score"].white().score(mate_score=10000) / 100.0

        for move in game.mainline_moves():
            is_white_turn = board.turn
            player_color = "white" if is_white_turn else "black"
            turn_number = board.fullmove_number
            
            human_readable_move = board.san(move)
            
            info_before = engine.analyse(board, chess.engine.Limit(depth=10))
            best_move = info_before.get("pv", [None])[0]
            best_move_uci = best_move.uci() if best_move else None
            best_move_san = board.san(best_move) if best_move else None
            
            board.push(move)
            
            info_after = engine.analyse(board, chess.engine.Limit(depth=10))
            pov_score = info_after["score"].white()
            
            current_eval_number = pov_score.score(mate_score=10000) / 100.0
            
            if is_white_turn:
                delta = current_eval_number - previous_score
            else:
                delta = previous_score - current_eval_number
                
            classification = "normal"
            if delta <= -2.0:
                classification = "blunder"
            elif delta <= -1.0:
                classification = "mistake"
            elif delta <= -0.5:
                classification = "inaccuracy"

            score_val = pov_score.score() / 100.0 if not pov_score.is_mate() else None
            mate_val = pov_score.mate() if pov_score.is_mate() else None

            analysis_results.append({
                "turn_number": turn_number,
                "player": player_color,
                "move_played_uci": move.uci(),
                "move_played_san": human_readable_move,
                "best_move_engine_uci": best_move_uci,
                "best_move_engine_san": best_move_san,
                "score_after": score_val,
                "mate": mate_val,
                "delta": round(delta, 2),
                "classification": classification
            })

            previous_score = current_eval_number

        # 1. First attempt to quit the engine safely after normal analysis
        engine.quit()

        critical_mistakes = [
            res for res in analysis_results 
            if res["classification"] in ["blunder", "mistake"]
        ]

        coach_feedback = "Excellent game! No major mistakes or blunders detected."

        if critical_mistakes:
            prompt = f"""
            Act as an expert chess coach. 
            I have a list of critical mistakes made in a recent game.
            
            For EACH mistake in the list below, you MUST explain:
            1. Why the move played by the human was bad (what did it expose, lose, or miss?).
            2. What the engine suggested instead.
            3. Why the engine's suggested move is mathematically or positionally superior.
            
            Keep the tone encouraging, objective, and highly pedagogical.
            Do not format as a letter, just provide the direct analysis grouped by turn number.
            Output the response entirely in English.
            
            Mistakes data (JSON format):
            {critical_mistakes}
            """
            
            # 2. FIX: Updated the model to the latest standard
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt
            )
            coach_feedback = response.text

        return {
            "status": "success", 
            "coach_feedback": coach_feedback,
            "data": analysis_results
        }

    except Exception as e:
        print(f"Backend Error: {e}")
        # 3. FIX: Idempotent engine shutdown to prevent Cascading Failures
        if 'engine' in locals():
            try:
                engine.quit()
            except Exception:
                pass # Silently ignore if already closed
        raise HTTPException(status_code=500, detail=str(e))
