import os
import json
import urllib.request
import urllib.error

def list_models():
    # Try to read from .env file
    api_key = None
    if os.path.exists('.env'):
        with open('.env', 'r') as f:
            for line in f:
                if line.startswith('GEMINI_API_KEY='):
                    api_key = line.split('=')[1].strip()
                    break
    
    if not api_key:
        print("Error: GEMINI_API_KEY not found in .env file.")
        return

    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    
    try:
        with urllib.request.urlopen(url) as response:
            res_content = response.read().decode('utf-8')
            res_json = json.loads(res_content)
            print(json.dumps(res_json, indent=2))
    except urllib.error.HTTPError as e:
        print(f"Error: API call failed with status code {e.code}")
        print("Response:", e.read().decode('utf-8'))
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    list_models()
