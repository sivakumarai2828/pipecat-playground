# Pipecat Playground

A high-performance real-time voice AI playground built with Pipecat, Daily, Speechmatics, OpenAI, and Cartesia.

## Features
- **Low Latency**: Optimized for real-time conversational AI.
- **Adaptive Turn Detection**: Using Speechmatics native VAD.
- **Speaker Diarization**: Optional speaker tags (Speaker S1/S2).
- **Rich UI**: Live transcripts, metrics visualization, and event logs.
- **Barge-in Support**: Seamless interruptions.

## Setup

### 1. Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Add your API keys to .env
uvicorn main:app --reload --port 7860
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

## Environment Variables
Ensure you have the following keys in `backend/.env`:
- `DAILY_API_KEY`: For room management (if automated).
- `DAILY_ROOM_URL`: The URL of your Daily room.
- `SPEECHMATICS_API_KEY`: For real-time STT.
- `CARTESIA_API_KEY`: For ultra-low latency TTS.
- `OPENAI_API_KEY`: For LLM brains (gpt-4o-mini).
