import os
import io
import chess
import chess.pgn
import chess.engine
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
from openai import OpenAI
from dotenv import load_dotenv

# Load system environment variables from .env file
load_dotenv()

app = FastAPI()

# Configure CORS middleware to connect securely with the Vite Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PGNRequest(BaseModel):
    pgn_text: str
    user_color: str 

@app.post("/analyze")
async def analyze_game(request: PGNRequest):
    stockfish_path = "/usr/bin/stockfish"
    
    if not os.path.exists(stockfish_path):
        print(f"CRITICAL ERROR: Stockfish binary not found at {stockfish_path}")
        raise HTTPException(status_code=500, detail="Stockfish engine binary missing from server repository.")

    engine = None
    try:
        # 1. MATHEMATICAL PGN PROCESSING & STOCKFISH ENGINE INITIALIZATION
        pgn_io = io.StringIO(request.pgn_text)
        game = chess.pgn.read_game(pgn_io)
        
        if game is None:
            raise HTTPException(status_code=400, detail="Invalid or malformed PGN text.")

        engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)

        chess_steps: List[Dict[str, Any]] = []
        move_telemetry_logs: List[str] = []
        board = game.board()
        
        previous_eval_score = 35 

        # Using absolute move_index (1, 2, 3, 4...) for stable tag alignment
        for move_index, move in enumerate(game.mainline_moves(), start=1):
            turn_number = (move_index + 1) // 2
            player_color = "White" if board.turn == chess.WHITE else "Black"
            
            piece_at_square = board.piece_at(move.from_square)
            piece_type = chess.piece_name(piece_at_square.piece_type).upper() if piece_at_square else "PIECE"
            
            is_capture = board.is_capture(move)
            captured_piece_str = ""
            if is_capture:
                target_piece = board.piece_at(move.to_square)
                if target_piece:
                    captured_piece_str = f" capturing a Black {chess.piece_name(target_piece.piece_type).upper()}" if player_color == "White" else f" capturing a White {chess.piece_name(target_piece.piece_type).upper()}"

            san = board.san(move)
            uci = move.uci()
            
            board.push(move)
            
            # Stockfish real-time analysis engine iteration loop
            analysis_info = engine.analyse(board, chess.engine.Limit(time=0.05))
            for_white_score = analysis_info["score"].white()
            
            raw_score = for_white_score.score()
            current_eval_score = raw_score if raw_score is not None else previous_eval_score
            
            score_drop = abs(current_eval_score - previous_eval_score)
            classification = "Excellent"
            
            if for_white_score.is_mate():
                classification = "FORCED MATE THREAT"
            elif score_drop >= 150:
                classification = "CRITICAL BLUNDER"
            elif score_drop >= 80:
                classification = "MISTAKE"
            elif score_drop >= 30:
                classification = "INACCURACY"
                
            score_string = f"Mate in {for_white_score.mate()}" if for_white_score.is_mate() else f"{current_eval_score / 100:+.2f}"
            previous_eval_score = current_eval_score

            is_checkmate = board.is_checkmate()
            is_check = board.is_check() and not is_checkmate
            status_flags = " [CHECKMATE - GAME OVER]" if is_checkmate else (" [CHECK]" if is_check else "")
            
            # Absolute sequential tag marker instantiation
            step_tag = f"MOVE_{move_index}"
            
            telemetry_line = (
                f"[{step_tag}]\n"
                f"Absolute Move {move_index} (Turn {turn_number}) by {player_color}: {piece_type} played `{san}`{captured_piece_str}{status_flags}.\n"
                f"Engine Eval: {score_string} | Classification: {classification}.\n"
                f"[/{step_tag}]"
            )
            move_telemetry_logs.append(telemetry_line)

            chess_steps.append({
                "move_played_san": san,
                "move_played_uci": uci,
                "tag_key": step_tag
            })

        game_ended_in_mate = board.is_checkmate()
        absolute_winner = "White" if (len(chess_steps) % 2 != 0 and game_ended_in_mate) else ("Black" if game_ended_in_mate else "None")
        absolute_loser = "Black" if absolute_winner == "White" else ("White" if absolute_winner == "Black" else "None")

        print(f"LOG: Dispatching payload to Groq. Target perspective color is: {request.user_color.upper()}")
        
        groq_client = OpenAI(
            base_url="https://api.groq.com/openai/v1",
            api_key=os.getenv("GROQ_API_KEY")
        )

        telemetry_payload_string = "\n".join(move_telemetry_logs)
        
        # Reinforced instruction prompt template with absolute structural boundaries
        prompt = (
            f"You are a professional chess grandmaster and an encouraging, highly educational chess coach analyzing a user's match.\n\n"
            f"USER PERSPECTIVE CONTEXT:\n"
            f"* The user played this match explicitly as the {request.user_color.upper()} pieces.\n\n"
            f"FACTUAL MATCH TELEMETRY GENERATED BY STOCKFISH:\n"
            f"{telemetry_payload_string}\n\n"
            f"MATCH OUTCOME DATA:\n"
            f"* Game Ended in Checkmate: {game_ended_in_mate}\n"
            f"* Absolute Match Winner: {absolute_winner}\n"
            f"* Absolute Match Loser: {absolute_loser}\n\n"
            f"STRICT OUTPUT ARCHITECTURE INSTRUCTIONS:\n"
            f"Your output must contain ONLY the explicit tagged blocks requested below. Do NOT include any introduction, conversational filler, greeting, or friendly preamble outside of these tags. Start directly with the [OVERVIEW] tag.\n\n"
            f"[OVERVIEW]\n"
            f"### Match Overview\n"
            f"Provide a clear, respectful, and educational executive summary of the match. Address the user directly based on the 'USER PERSPECTIVE CONTEXT' as the {request.user_color.upper()} player. "
            f"Explain the critical turning points of the game, highlighting strategic themes and core areas for technical improvement.\n"
            f"[/OVERVIEW]\n\n"
            f"For every single move block present in the telemetry above (from MOVE_1 up to MOVE_{len(chess_steps)}), you MUST generate a corresponding review block using its exact tag.\n"
            f"Example format:\n"
            f"[MOVE_1]\n"
            f"### Move 1 Analysis\n"
            f"* **Evaluation Details:** Analysis of the score adjustment...\n"
            f"* **Grandmaster Advice:** Educational advice tailored precisely to the user's chosen perspective...\n"
            f"[/MOVE_1]\n\n"
            f"STRICT FORMATTING RULE: Only use standard markdown `###` for headers and `*` for bullet points. Do NOT use `+` or `-` characters as list bullet designators."
        )

        try:
            response = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {"role": "system", "content": "You are an automated chess coaching engine. You must ONLY output the strictly requested tagged blocks ([OVERVIEW], [MOVE_1], etc.). Do NOT write any introductory or concluding text outside these tags. Inside the tags, maintain a respectful, grandmaster-level educational tone."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2, 
                stream=False
            )
            
            coach_text = response.choices[0].message.content

            return {
                "status": "success",
                "coach_feedback_raw": coach_text,
                "data": chess_steps
            }

        except Exception as groq_err:
            print(f"ERROR: Cloud gateway connection error: {groq_err}")
            return {
                "status": "error",
                "coach_feedback_raw": "### 📴 Service Interruption\n\nUnable to fetch cloud commentary.",
                "data": chess_steps
            }

    except Exception as e:
        print(f"CRITICAL: Server exception intercepted: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        
    finally:
        if engine is not None:
            engine.quit()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
