import os
import json
import urllib.request
import urllib.error

def verify_api_key():
    # Try to read from .env file
    api_key = None
    if os.path.exists('.env'):
        with open('.env', 'r') as f:
            for line in f:
                if line.startswith('GEMINI_API_KEY='):
                    api_key = line.split('=')[1].strip().strip("'").strip('"')
                    break
    
    if not api_key:
        print("Error: GEMINI_API_KEY not found in .env file.")
        print("Please add 'GEMINI_API_KEY=your_actual_key' to your .env file.")
        return

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={api_key}"
    headers = {'Content-Type': 'application/json'}
    data = {"contents": [{"parts": [{"text": "Hello, Gemini!"}]}]}
    body = json.dumps(data).encode('utf-8')

    req = urllib.request.Request(url, data=body, headers=headers, method='POST')

    try:
        with urllib.request.urlopen(req) as response:
            res_content = response.read().decode('utf-8')
            res_json = json.loads(res_content)
            if 'candidates' in res_json:
                print("Success! The API key is working.")
                print("Response:", res_json['candidates'][0]['content']['parts'][0]['text'])
            else:
                print("Error: Unexpected response format.")
                print("Full Response:", res_json)
    except urllib.error.HTTPError as e:
        print(f"Error: API call failed with status code {e.code}")
        print("Response:", e.read().decode('utf-8'))
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    verify_api_key()
