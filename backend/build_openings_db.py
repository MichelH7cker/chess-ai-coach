import os
import json
import requests

def clean_fen_key(fen_str: str) -> str:
    """
    Extracts ONLY the piece placement grid (1st block of the FEN string).
    This aligns perfectly with the layout-only lookup logic in main.py.
    """
    parts = fen_str.strip().split()
    return parts[0] if parts else ""

def compile_eco_database():
    print("📥 Fetching and compilation process initiated for 12,000+ ECO openings...")
    
    compiled_map = {}
    letters = ['A', 'B', 'C', 'D', 'E']
    
    for letter in letters:
        url = f"https://raw.githubusercontent.com/hayatbiralem/eco.json/master/eco{letter}.json"
        print(f"📡 Downloading eco{letter}.json from remote GitHub storage...")
        
        try:
            response = requests.get(url, timeout=15)
            response.raise_for_status()
            data = response.json()
            
            # Since the structure is Record<FEN, Opening>, we iterate over key-value pairs directly
            if isinstance(data, dict):
                for raw_fen, item in data.items():
                    if isinstance(item, dict) and "name" in item:
                        opening_name = item["name"]
                        
                        # Extract only the piece positioning grid part
                        standard_key = clean_fen_key(raw_fen)
                        if standard_key:
                            compiled_map[standard_key] = opening_name
                            
        except Exception as e:
            print(f"❌ Failed to process slice category {letter}: {e}")
            return

    # Write out the clean dictionary file to serve fast O(1) lookups
    output_path = os.path.join(os.path.dirname(__file__), "openings.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(compiled_map, f, indent=2, ensure_ascii=False)
        
    print(f"✅ Compilation complete! Generated optimized dictionary containing {len(compiled_map)} unique layout positions.")

if __name__ == "__main__":
    compile_eco_database()
