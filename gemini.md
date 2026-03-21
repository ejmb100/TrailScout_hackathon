# Gemini Setup

## Project Context
TrailScout_hackathon is an intent-based outdoor planning and hiking project. We use Gemini to interpret user natural language descriptions, assist with planning logic, and power intelligent app workflows to match hikers with their ideal trails.

## Overview
This guide covers how to connect this project to the Google Gemini API for local development.

## Prerequisites
- A Google AI Studio account.
- A Gemini API Key from [AI Studio](https://aistudio.google.com/).
- Node.js installed for the main application.
- Python 3 installed for utility scripts.

## Environment Variables
The project uses a `.env` file at the root to manage secrets. Ensure this file exists and is correctly populated before running the app.

Example `.env` entry:
```env
GEMINI_API_KEY=your_key_here
```

## Where to place the API key
1. Copy `.env.example` to `.env`.
2. Paste your actual API key into the `GEMINI_API_KEY` field.
3. Save the file.

## Local Development Workflow
1. **Install dependencies**: `npm install`
2. **Start the app**: `npm run dev`
3. **Verify Setup**: Use the provided utility scripts to test connectivity.

## Security Notes
> [!IMPORTANT]
> The Gemini API key must **never** be hardcoded in source files.
- Ensure `.env` is listed in your `.gitignore` (it is by default in this project) to prevent leaking secrets to version control.

## Troubleshooting
- **Invalid Key**: Use `python3 verify_api_key.py` to validate your key locally. If you see a 400 error, double-check that the key was copied correctly and doesn't contain extra spaces.
- **Model List**: Run `python3 list_models.py` to see which models are available for your key.
- **Project Structure**: If `models.json` exists, it may be a local reference. Only rely on it if the application explicitly loads it for model listing.

## Quick Setup Checklist
- [ ] Create `.env` from `.env.example`
- [ ] Add your `GEMINI_API_KEY` to `.env`
- [ ] Run `python3 verify_api_key.py` to confirm access
- [ ] Run `npm install` and `npm run dev` to start the app
