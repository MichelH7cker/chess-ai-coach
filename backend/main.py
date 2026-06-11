import os
import io
import chess
import chess.pgn
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

@app.post("/analyze")
async def analyze_game(request: PGNRequest):
    try:
        # 1. MATHEMATICAL PGN PROCESSING (python-chess)
        pgn_io = io.StringIO(request.pgn_text)
        game = chess.pgn.read_game(pgn_io)
        
        if game is None:
            raise HTTPException(status_code=400, detail="Invalid or malformed PGN text.")

        chess_steps: List[Dict[str, Any]] = []
        board = game.board()
        
        # Populate move sequence for chessboard synchronization
        for move in game.mainline_moves():
            chess_steps.append({
                "move_played_san": board.san(move),
                "move_played_uci": move.uci()
            })
            board.push(move)

        # 2. DEV ENVIRONMENT MOCK CHECK
        use_mock_env = os.getenv("USE_MOCK", "False").lower() == "true"
        if use_mock_env:
            print("LOG: Mock mode active. Disbursing static development layout response.")
            is_checkmate = board.is_checkmate()
            last_move = chess_steps[-1]['move_played_san'] if chess_steps else 'None'
            
            mock_feedback = (
                f"### 🎯 Coach Analysis (Development Mode)\n\n"
                f"Your PGN was successfully validated by the local engine. The match ended in "
                f"{'**Checkmate**' if is_checkmate else 'ongoing status'} on move `{last_move}`.\n\n"
                f"---\n"
                f"💡 *Dev Note: The `USE_MOCK=True` toggle is active in your `.env` file.*"
            )
            return {
                "status": "success",
                "coach_feedback": mock_feedback,
                "data": chess_steps
            }

        # 3. LIVE CLOUD GROQ API OPERATION
        print("LOG: Initiating Groq cloud request using llama-3.1-8b-instant...")
        
        groq_client = OpenAI(
            base_url="https://api.groq.com/openai/v1",
            api_key=os.getenv("GROQ_API_KEY")
        )

        # Reinforced structured prompt to avoid perspective shifting hallucinations
        prompt = (
            f"You are a chess grandmaster and a highly sarcastic, witty chess coach analyzing a user's match.\n\n"
            f"STRICT LOGICAL RULES:\n"
            f"1. Identify the winner correctly. If the game ends in '#' (checkmate), the player who made the last move WON instantly. Do not give generic advice on piece development or structural weaknesses to the side that successfully delivered checkmate.\n"
            f"2. Direct your remarks clearly to the player who lost, mocking their tactical blindness. Praise the winner's brutal efficiency.\n"
            f"3. Strictly base your feedback on actual pieces on the squares. Do not mention pieces or moves not present in the sequence.\n\n"
            f"Format your response cleanly using Markdown (### for headers and * for bullet points).\n"
            f"Clean PGN input sequence to evaluate: {request.pgn_text}"
        )

        try:
            response = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {"role": "system", "content": "You are a professional chess coach delivering sharp tactical and positional performance reviews."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.6,
                stream=False
            )
            
            coach_text = response.choices[0].message.content

            return {
                "status": "success",
                "coach_feedback": coach_text,
                "data": chess_steps
            }

        except Exception as groq_err:
            print(f"ERROR: Failed communication loop with Groq endpoints: {groq_err}")
            return {
                "status": "error",
                "coach_feedback": (
                    "### 📴 Service Interruption\n\n"
                    "Unable to fetch cloud commentary. Please verify your internet connection and `GROQ_API_KEY` status."
                ),
                "data": chess_steps
            }

    except Exception as e:
        print(f"CRITICAL: Server runtime exception intercepted: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
