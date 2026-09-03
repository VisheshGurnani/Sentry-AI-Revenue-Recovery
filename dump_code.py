import os

IGNORE_DIRS = {'venv', 'node_modules', '.git', '__pycache__', 'dist', 'build', '.vite'}
ALLOWED_EXTENSIONS = {'.py', '.js', '.jsx', '.ts', '.tsx', '.json', '.env'}

def dump_codebase():
    with open('codebase_dump.txt', 'w', encoding='utf-8') as outfile:
        for root, dirs, files in os.walk('.'):
            # Prune ignored directories from the walk
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            
            for file in files:
                ext = os.path.splitext(file)[1]
                if ext in ALLOWED_EXTENSIONS or file == 'Dockerfile':
                    filepath = os.path.join(root, file)
                    outfile.write(f"\n{'='*80}\n")
                    outfile.write(f"FILE: {filepath}\n")
                    outfile.write(f"{'='*80}\n\n")
                    try:
                        with open(filepath, 'r', encoding='utf-8') as infile:
                            outfile.write(infile.read())
                    except Exception as e:
                        outfile.write(f"<Error reading file: {e}>\n")

if __name__ == "__main__":
    dump_codebase()
    print("Codebase consolidated successfully into codebase_dump.txt")