import os
import io
import json
import re  # Importação vital para o sanitizador de expressões regulares
import chess
import chess.pgn
import chess.engine
import chromadb
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
from groq import Groq
from dotenv import load_dotenv

# Carrega as variáveis do .env na memória do sistema global
load_dotenv()

app = FastAPI(title="Chess AI Coach Real Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PGNRequest(BaseModel):
    pgn_text: str
    user_color: str 

def lookup_deterministic_opening(board_state: chess.Board) -> str:
    """
    TRACK 1: Volta a partida lance por lance e busca no eco.json compilado
    comparando APENAS o mosaico de peças (1º bloco da FEN) para evitar erros de roque.
    """
    json_path = os.path.join(os.path.dirname(__file__), "openings.json")
    if not os.path.exists(json_path):
        return "Custom Position / Middlegame"
        
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            openings_db = json.load(f)
            
        test_board = board_state.copy()
        cleaned_dict = {dict_fen.split()[0]: name for dict_fen, name in openings_db.items()}
        
        while test_board.move_stack:
            pure_piece_layout = test_board.fen().split()[0]
            if pure_piece_layout in cleaned_dict:
                return cleaned_dict[pure_piece_layout]
            test_board.pop() 
            
        start_layout = test_board.fen().split()[0]
        if start_layout in cleaned_dict:
            return cleaned_dict[start_layout]
            
    except Exception as err:
        print(f"⚠️ Erro ao processar dicionário de aberturas: {err}")
        
    return "Custom Position / Middlegame"

@app.post("/analyze")
async def analyze_game(request: PGNRequest):
    stockfish_path = "/usr/bin/stockfish"
    if not os.path.exists(stockfish_path):
        raise HTTPException(status_code=500, detail="Binário do Stockfish não encontrado no servidor.")

    engine = None
    try:
        pgn_io = io.StringIO(request.pgn_text)
        game = chess.pgn.read_game(pgn_io)
        if game is None:
            raise HTTPException(status_code=400, detail="Formato PGN inválido.")

        engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)
        chess_steps: List[Dict[str, Any]] = []
        move_telemetry_logs: List[str] = []
        board = game.board()
        previous_eval_score = 35 

        for move_index, move in enumerate(game.mainline_moves(), start=1):
            player_color = "White" if board.turn == chess.WHITE else "Black"
            san = board.san(move)
            piece_at_square = board.piece_at(move.from_square)
            piece_type = chess.piece_name(piece_at_square.piece_type).upper() if piece_at_square else "PIECE"
            
            is_capture = board.is_capture(move)
            captured_piece_str = " capturing a piece" if is_capture else ""

            board.push(move)
            
            analysis_info = engine.analyse(board, chess.engine.Limit(depth=20))
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

            step_tag = f"MOVE_{move_index}"
            telemetry_line = f"{player_color} {piece_type} played `{san}`{captured_piece_str}. Eval: {score_string} | State: {classification}."
            move_telemetry_logs.append(f"Move {move_index}: {telemetry_line}")

            chess_steps.append({
                "move_played_san": san,
                "move_played_uci": move.uci(),
                "tag_key": step_tag,
                "eval_cp": current_eval_score if not for_white_score.is_mate() else (450 if for_white_score.mate() > 0 else -450),
                "is_mate": for_white_score.is_mate(),
                "mate_turns": for_white_score.mate() if for_white_score.is_mate() else None
            })

        # TRACK 1: NOMINAÇÃO DETERMINÍSTICA DA ABERTURA
        detected_opening_name = lookup_deterministic_opening(board)

        # TRACK 2: CONSULTA VETORIAL CONCEITUAL
        critical_errors = [log for log in move_telemetry_logs if "BLUNDER" in log or "MISTAKE" in log]
        search_context_nodes = critical_errors if critical_errors else move_telemetry_logs[-2:]
        semantic_search_phrase = f"{detected_opening_name} chess strategy. " + " | ".join(search_context_nodes)

        retrieved_context_books = ""
        active_citation_label = "General Chess Principles Handbook"

        try:
            db_path = os.path.join(os.path.dirname(__file__), "chroma_db")
            chroma_client = chromadb.PersistentClient(path=db_path)
            collection = chroma_client.get_collection(name="chess_grandmaster_library")
            
            db_results = collection.query(query_texts=[semantic_search_phrase], n_results=1)
            
            if db_results and db_results["documents"] and db_results["documents"][0]:
                retrieved_context_books = db_results["documents"][0][0]
                if db_results["metadatas"] and db_results["metadatas"][0]:
                    active_citation_label = str(db_results["metadatas"][0][0]["source"])
            print(f"✅ RAG Match: {active_citation_label}")
        except Exception as chroma_err:
            print(f"⚠️ Fallback do Chroma ativado: {chroma_err}")

        # Inicialização segura do cliente Groq
        groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

        telemetry_payload_string = "\n\n".join(move_telemetry_logs)
        mandatory_tags_list = ["[OVERVIEW]"] + [f"[MOVE_{i}]" for i in range(1, len(chess_steps) + 1)]
        checklist_string = ", ".join(mandatory_tags_list)

        prompt = (
            f"You are a professional chess grandmaster and coach analyzing a match from the {request.user_color.upper()} perspective.\n\n"
            f"MATCH OPENING IDENTIFIED STATE:\n"
            f"* Characterization: {detected_opening_name}\n\n"
            f"VERIFIED HISTORICAL LITERATURE CONTEXT (RAG BOOKS):\n"
            f"{retrieved_context_books if retrieved_context_books else 'No explicit book excerpt available.'}\n\n"
            f"FACTUAL MATCH TELEMETRY GENERATED BY STOCKFISH:\n"
            f"{telemetry_payload_string}\n\n"
            f"STRICT ARCHITECTURE COMPLIANCE CHECKLIST:\n"
            f"Your response MUST contain exactly these structural tag blocks, in order, without any modifications. "
            f"Do NOT output any greetings or preambles outside of these tags. Start directly with the [OVERVIEW] block.\n\n"
            f"REQUIRED TAGS ENVELOPE: {checklist_string}\n\n"
            f"BLOCK FORMAT SPECIFICATIONS:\n"
            f"[OVERVIEW]\n"
            f"### Match Overview\n"
            f"Provide an executive summary of the match for the {request.user_color.upper()} player.\n"
            f"[/OVERVIEW]\n\n"
            f"Followed by each individual move block. Example format:\n"
            f"[MOVE_1]\n"
            f"### Move 1 Analysis\n"
            f"* **Evaluation Details:** Description...\n"
            f"* **Grandmaster Advice:** Coaching feedback combining book concepts with Stockfish statistics.\n"
            f"[/MOVE_1]\n\n"
            f"STRICT CITATION PROHIBITION: Do NOT include any lines mentioning 'Literature Reference' or 'Source Matrix' inside the blocks. Focus 100% on chess coaching strategy."
        )

        try:
            response = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {
                        "role": "system", 
                        "content": f"You are a chess coach backend script. You MUST wrap text exactly inside the requested structural blocks in sequence. Use exactly the underscore notation like [MOVE_1], [MOVE_2]."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1, 
                stream=False
            )
            
            coach_text = response.choices[0].message.content

            # =========================================================================
            # 🛡️ THE BULLETPROOF SANITIZER MATRIX (CORREÇÃO DE ESPAÇOS E CAIXA DO LLM)
            # =========================================================================
            # Converte qualquer variação como [Move 1] ou [move 1] para [MOVE_1]
            coach_text = re.sub(r'\[[mM][oO][vV][eE]\s+(\d+)\]', r'[MOVE_\1]', coach_text)
            # Converte qualquer variação de fechamento como [/Move 1] ou [/move 1] para [/MOVE_1]
            coach_text = re.sub(r'\[\/[mM][oO][vV][eE]\s+(\d+)\]', r'[/MOVE_\1]', coach_text)
            # Corrige falhas onde o modelo usa o nome mas esquece o underline, ex: [MOVE 1]
            coach_text = re.sub(r'\[[mM][oO][vV][eE]_(?!\d)', r'[MOVE_', coach_text)
            # =========================================================================

            return {
                "status": "success",
                "opening_name": detected_opening_name,
                "literature_source": active_citation_label,
                "coach_feedback_raw": coach_text,
                "data": chess_steps
            }
            
        except Exception as groq_err:
            print(f"❌ Falha no LLM: {groq_err}")
            return {"status": "error", "coach_feedback_raw": "[OVERVIEW]\n### 📴 Service Interruption\n[/OVERVIEW]", "data": chess_steps}
            
    finally:
        if engine is not None:
            engine.quit()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
