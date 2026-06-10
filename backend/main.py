import io
import chess.pgn
import chess.engine
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Chess AI Coach API")

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
        
        # Evaluate the starting position before any moves are made
        initial_info = engine.analyse(board, chess.engine.Limit(depth=10))
        previous_score = initial_info["score"].white().score(mate_score=10000) / 100.0

        for move in game.mainline_moves():
            is_white_turn = board.turn  # True if White is about to move
            
            # Extract player color and turn number BEFORE pushing the move
            player_color = "white" if is_white_turn else "black"
            turn_number = board.fullmove_number
            
            # 1. Ask engine for the best move BEFORE the human plays
            info_before = engine.analyse(board, chess.engine.Limit(depth=10))
            best_move = info_before.get("pv", [None])[0]
            best_move_uci = best_move.uci() if best_move else None

            # 2. Make the human move
            board.push(move)
            
            # 3. Analyze the new position AFTER the human move
            info_after = engine.analyse(board, chess.engine.Limit(depth=10))
            pov_score = info_after["score"].white()
            
            current_eval_number = pov_score.score(mate_score=10000) / 100.0
            
            # 4. Calculate Delta from the perspective of the player who just moved
            if is_white_turn:
                delta = current_eval_number - previous_score
            else:
                delta = previous_score - current_eval_number
                
            # 5. Semantic Classification based on Delta
            classification = "normal"
            if delta <= -2.0:
                classification = "blunder"
            elif delta <= -1.0:
                classification = "mistake"
            elif delta <= -0.5:
                classification = "inaccuracy"

            # Prepare clean JSON output
            score_val = pov_score.score() / 100.0 if not pov_score.is_mate() else None
            mate_val = pov_score.mate() if pov_score.is_mate() else None

            analysis_results.append({
                "turn_number": turn_number,
                "player": player_color,
                "move_played": move.uci(),
                "best_move_engine": best_move_uci,
                "score_after": score_val,
                "mate": mate_val,
                "delta": round(delta, 2),
                "classification": classification
            })

            # The current score becomes the previous score for the next iteration
            previous_score = current_eval_number

        engine.quit()
        return {"status": "success", "data": analysis_results}

    except Exception as e:
        if 'engine' in locals():
            engine.quit()
        raise HTTPException(status_code=500, detail=str(e))
