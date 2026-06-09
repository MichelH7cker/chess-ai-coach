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

        for move in game.mainline_moves():
            board.push(move)
            info = engine.analyse(board, chess.engine.Limit(depth=10))
            
            pov_score = info["score"].white()
            
            score_val = None
            mate_val = None
            
            if pov_score.is_mate():
                mate_val = pov_score.mate()
            else:
                score_val = pov_score.score() / 100.0
                
            analysis_results.append({
                "move": move.uci(),
                "fen": board.fen(),
                "score": score_val,
                "mate": mate_val
            })

        engine.quit()
        return {"status": "success", "data": analysis_results}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
