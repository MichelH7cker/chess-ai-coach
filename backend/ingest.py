import os
import re
import glob
import io
import logging
import chess
import chess.pgn
import chromadb

# Silence internal python-chess log warnings to keep terminal outputs pristine
logging.getLogger("chess.pgn").setLevel(logging.CRITICAL)

# Configure persistent ChromaDB local storage client environment
DB_PATH = os.path.join(os.path.dirname(__file__), "chroma_db")
chroma_client = chromadb.PersistentClient(path=DB_PATH)

# Initialize or fetch the specific vector repository collection matrix
collection = chroma_client.get_or_create_collection(name="chess_grandmaster_library")

BOOKS_DIR = os.path.join(os.path.dirname(__file__), "books")

def extract_fen_from_text(text: str) -> str:
    """
    Scans text strings starting from move 1, collecting consecutive chess notation tokens.
    Stops the scanner immediately upon hitting any standard human prose word to avoid contamination.
    """
    # Normalize unspaced notation blocks like "1.e4" or "3.Bc4" into "1. e4", "3. Bc4"
    normalized_text = re.sub(r"(\d+)\.([a-zA-Z])", r"\1. \2", text)
    
    start_idx = normalized_text.find("1.")
    if start_idx == -1:
        return ""
        
    # Strict regex pattern checking if a word string is a valid move number or SAN token
    token_validator = re.compile(r"^(?:\d+\.*|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?)$", re.IGNORECASE)
    
    raw_tokens = normalized_text[start_idx:].split()
    sequential_chess_moves = []
    
    for token in raw_tokens:
        # Strip trailing punctuation marks commonly found attached to words in books
        cleaned_token = token.strip("(),;*[]{}")
        
        if token_validator.match(cleaned_token):
            sequential_chess_moves.append(cleaned_token)
        else:
            # The exact millisecond a human prose text word is hit, break out of the loop
            break
            
    if not sequential_chess_moves:
        return ""
        
    cleaned_pgn_string = " ".join(sequential_chess_moves)
    
    try:
        game = chess.pgn.read_game(io.StringIO(cleaned_pgn_string))
        if game is None:
            return ""
            
        board = game.board()
        for move in game.mainline_moves():
            board.push(move)
            
        return board.fen()
    except Exception:
        return ""

def chunk_text(text: str, chunk_size: int = 1200, overlap: int = 200) -> list:
    """Splits raw book strings into normalized contextual chunks with safe sliding overlap windows."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += (chunk_size - overlap)
    return chunks

def ingest_books():
    print("⚡ Launching automated grandmaster book ingestion pipeline with strict token scanning...")
    
    file_patterns = [
        os.path.join(BOOKS_DIR, "*.pdf"), 
        os.path.join(BOOKS_DIR, "*.txt"),
        os.path.join(BOOKS_DIR, "*.md")
    ]
    
    files_to_process = []
    for pattern in file_patterns:
        files_to_process.extend(glob.glob(pattern))

    if not files_to_process:
        print(f"⚠️ Warning: No source documents found in '{BOOKS_DIR}'. Please add PDF, TXT, or MD logs.")
        return

    global_chunk_counter = 0

    for file_path in files_to_process:
        file_name = os.path.basename(file_path)
        print(f"📖 Processing source document: {file_name}...")
        
        raw_text_blocks = []
        
        # Read raw text buffers if processing standard TXT or MD streams
        if file_path.endswith(".txt") or file_path.endswith(".md"):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    full_text = f.read()
                    if full_text.strip():
                        raw_text_blocks.append((full_text, "full_text"))
            except Exception as e:
                print(f"❌ Error compiling text stream source {file_name}: {e}")
                continue

        # Process sliding tokens chunk formatting allocations and insert to vector layer
        for text_content, source_label in raw_text_blocks:
            chunks = chunk_text(text_content)
            
            documents = []
            metadatas = []
            ids = []
            
            for idx, chunk in enumerate(chunks):
                global_chunk_counter += 1
                chunk_id = f"id_{file_name}_{source_label}_chk_{idx}"
                
                # Replay verification using the new sequential token boundary guardrail
                detected_fen = extract_fen_from_text(chunk)
                
                documents.append(chunk)
                ids.append(chunk_id)
                
                metadata_entry = {
                    "source": file_name, 
                    "location": source_label,
                    "fen": detected_fen if detected_fen else "None"
                }
                metadatas.append(metadata_entry)
            
            # Push elements directly into the local persistent vector DB cluster collection
            if documents:
                collection.add(
                    documents=documents,
                    metadatas=metadatas,
                    ids=ids
                )

    print(f"✅ Ingestion successful! {global_chunk_counter} document blocks populated into local ChromaDB with clean FEN tags.")

if __name__ == "__main__":
    os.makedirs(BOOKS_DIR, exist_ok=True)
    ingest_books()
