import os
import asyncio
import time
from fastapi import FastAPI, WebSocket, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import aiohttp
import openai
from openai import AsyncOpenAI

from pipecat.transports.services.daily import DailyTransport, DailyParams
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.speechmatics.stt import SpeechmaticsSTTService
from pipecat.services.speechmatics.stt import TurnDetectionMode
from pipecat.frames.frames import Frame, TranscriptionFrame, TextFrame, FunctionCallsStartedFrame, FunctionCallInProgressFrame
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.services.llm_service import FunctionCallParams
from pipecat.adapters.schemas.function_schema import FunctionSchema


from services.stt import get_stt_service
from services.llm import get_llm_service
from services.tts import get_tts_service
from metrics import EventBus, MetricsTracker

load_dotenv(override=True)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

event_bus = EventBus()
metrics = MetricsTracker()

class UserTranscriptBroadcaster(FrameProcessor):
    def __init__(self, event_bus):
        super().__init__()
        self.event_bus = event_bus

    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame):
            print(f"USER STT: {frame.text}")
            await self.event_bus.broadcast({
                "type": "transcript",
                "role": "user",
                "text": frame.text
            })
        await self.push_frame(frame, direction)

class AssistantTranscriptBroadcaster(FrameProcessor):
    def __init__(self, event_bus):
        super().__init__()
        self.event_bus = event_bus

    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)
        # DEBUG: Log frame type
        # print(f"ASSISTANT FRAME: {type(frame).__name__}")
        
        if isinstance(frame, FunctionCallsStartedFrame):
            for call in frame.function_calls:
                print(f"DEBUG: LLM starting tool calls: {call.function_name}")
                
        if isinstance(frame, FunctionCallInProgressFrame):
            print(f"DEBUG: LLM calling tool: {frame.function_name}")
           
        if isinstance(frame, TextFrame):
            # print(f"ASSISTANT TEXT: {frame.text}")
            await self.event_bus.broadcast({
                "type": "transcript_partial",
                "role": "assistant",
                "text": frame.text
            })
        await self.push_frame(frame, direction)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/session/create")
async def create_session(request: Request):
    room_url = os.getenv("DAILY_ROOM_URL")
    # If a URL is provided in .env, use it
    if room_url:
        print(f"Using static room URL from .env: {room_url}")
    
    # If no URL is provided, create one automatically using DAILY_API_KEY
    if not room_url:
        api_key = os.getenv("DAILY_API_KEY")
        if not api_key:
            print("ERROR: Neither DAILY_ROOM_URL nor DAILY_API_KEY set")
            raise HTTPException(status_code=500, detail="Neither DAILY_ROOM_URL nor DAILY_API_KEY set")
        
        try:
            print(f"Creating Daily room with API key starting with: {api_key[:10]}...")
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.daily.co/v1/rooms",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={"properties": {"exp": int(time.time()) + 3600}} 
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        room_url = data["url"]
                        print(f"Successfully created room: {room_url}")
                    else:
                        error_text = await resp.text()
                        print(f"ERROR: Failed to create Daily room. Status: {resp.status}, Response: {error_text}")
                        raise HTTPException(status_code=resp.status, detail=f"Failed to create Daily room: {error_text}")
        except Exception as e:
            if isinstance(e, HTTPException): raise e
            print(f"ERROR: Exception during room creation: {str(e)}")
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(e))
            
    return {"room_url": room_url}

@app.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    await event_bus.subscribe(websocket)
    try:
        while True:
            await websocket.receive_text()
    except:
        await event_bus.unsubscribe(websocket)

# Define tool functions and their schemas
async def show_text_on_screen(llm, frame):
    """Display text on the user's screen."""
    # frame.args contains the tool arguments
    text = frame.args.get("text", "")
    print(f"DEBUG: show_text_on_screen called with: {text[:50]}...")
    
    try:
        await event_bus.broadcast({
            "type": "tool_call",
            "name": "show_text_on_screen",
            "content": text
        })
        print("DEBUG: Broadcast successful")
        return "SUCCESS: The text is now displayed on the user's screen in the side panel."
    except Exception as e:
        print(f"DEBUG: Broadcast error: {e}")
        return f"ERROR: Failed to display text: {str(e)}"

async def generate_ui_component_task(prompt: str):
    """Background task to generate UI component with progress updates."""
    try:
        # Step 1: Initial Thinking
        await event_bus.broadcast({
            "type": "tool_call",
            "name": "generate_ui_component",
            "status": "thinking",
            "progress": 10,
            "eta": 15,
            "message": "Analyzing requirements...",
            "prompt": prompt
        })
        await asyncio.sleep(1.5)

        # Step 2: Designing
        await event_bus.broadcast({
            "type": "tool_call",
            "name": "generate_ui_component",
            "status": "thinking",
            "progress": 30,
            "eta": 12,
            "message": "Designing component architecture...",
            "prompt": prompt
        })
        await asyncio.sleep(1.5)

        # Step 3: Coding
        await event_bus.broadcast({
            "type": "tool_call",
            "name": "generate_ui_component",
            "status": "thinking",
            "progress": 60,
            "eta": 8,
            "message": "Writing React code and styles...",
            "prompt": prompt
        })

        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a professional web developer. Generate a single-page React component (using Tailwind classes for styling if needed) that fulfills the user's request. Output ONLY the code, no markdown blocks, no explanation. Just the JSX/TSX content that can be rendered in an iframe or div."},
                {"role": "user", "content": prompt}
            ]
        )
        code = response.choices[0].message.content

        # Step 4: Finalizing
        await event_bus.broadcast({
            "type": "tool_call",
            "name": "generate_ui_component",
            "status": "thinking",
            "progress": 90,
            "eta": 2,
            "message": "Finalizing UI and preparing for injection...",
            "prompt": prompt
        })
        await asyncio.sleep(1)

        # Step 5: Completed
        await event_bus.broadcast({
            "type": "tool_call",
            "name": "generate_ui_component",
            "status": "completed",
            "progress": 100,
            "eta": 0,
            "message": "Deployment successful",
            "content": code
        })
        print("DEBUG: UI generation and broadcast successful")
    except Exception as e:
        print(f"DEBUG: Error generating UI: {e}")
        await event_bus.broadcast({
            "type": "tool_call",
            "name": "generate_ui_component",
            "status": "error",
            "message": f"Failed to generate UI: {str(e)}"
        })

async def generate_ui_component(llm, frame):
    """Trigger background UI generation."""
    prompt = frame.args.get("prompt", "")
    print(f"DEBUG: generate_ui_component triggered for: {prompt}")
    
    # Start background task
    asyncio.create_task(generate_ui_component_task(prompt))
    
    # Return immediate acknowledgemnt to LLM
    return "SUCCESS: I have started building the UI component in the background. It will appear on the user's screen in about 15 seconds. You should inform the user that you are working on it and ask if they have any other questions while they wait."

show_text_on_screen_schema = {
    "type": "function",
    "function": {
        "name": "show_text_on_screen",
        "description": "Display a rich list, table, or markdown information on the user's screen side panel.",
        "parameters": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The markdown content to display."
                }
            },
            "required": ["text"]
        }
    }
}

generate_ui_component_schema = {
    "type": "function",
    "function": {
        "name": "generate_ui_component",
        "description": "Generate a dynamic, interactive mini-app or UI widget based on a prompt.",
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Detailed description of the UI to build."
                }
            },
            "required": ["prompt"]
        }
    }
}

async def run_pipecat_pipeline(room_url: str, system_prompt: str):
    print(f"DEBUG: Pipeline starting with prompt: {system_prompt[:100]}...")
    transport = DailyTransport(
        room_url,
        None,
        "Pipecat Agent",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_enabled=False, # Using Speechmatics native turn detection
        )
    )

    stt = get_stt_service(os.getenv("SPEECHMATICS_API_KEY"), os.getenv("ENABLE_DIARIZATION") == "true")
    tools = [show_text_on_screen_schema, generate_ui_component_schema]
    
    llm = OpenAILLMService(
        api_key=os.getenv("OPENAI_API_KEY"),
        model="gpt-4o",
        tools=tools
    )
    
    # Register tool handlers explicitly
    llm.register_function("show_text_on_screen", show_text_on_screen)
    llm.register_function("generate_ui_component", generate_ui_component)
    tts = get_tts_service(os.getenv("CARTESIA_API_KEY"))

    context = OpenAILLMContext([
        {"role": "system", "content": system_prompt}
    ], tools=tools)
    context_aggregator = llm.create_context_aggregator(context)

    user_broadcaster = UserTranscriptBroadcaster(event_bus)
    assistant_broadcaster = AssistantTranscriptBroadcaster(event_bus)

    pipeline = Pipeline([
        transport.input(),
        stt,
        user_broadcaster,
        context_aggregator.user(),
        llm,
        assistant_broadcaster,
        tts,
        transport.output(),
        context_aggregator.assistant(),
    ])

    task = PipelineTask(pipeline)

    @transport.event_handler("on_first_participant_joined")
    async def on_joined(transport, participant):
        print(f"First participant joined: {participant['id']}")
        await event_bus.broadcast({"type": "log", "message": f"Participant joined: {participant['id']}"})
        await transport.capture_participant_video(participant["id"])

    @llm.event_handler("on_llm_response_start")
    async def on_llm_start(service):
        print("LLM response starting...")
        metrics.start("llm")

    @llm.event_handler("on_llm_response_end")
    async def on_llm_end(service):
        lat = metrics.end("llm")
        print(f"LLM response finished in {lat}ms")
        await event_bus.broadcast({"type": "metrics", "llm_ms": lat})

    # Pipecat 0.0.40+ handles interruptions automatically if configured in pipeline
    @transport.event_handler("on_bot_interruption")
    async def on_interruption(transport, participant):
        print(f"Bot Interrupted by {participant['id']}!")
        await event_bus.broadcast({"type": "log", "message": f"Bot interrupted by {participant['id']}"})

    runner = PipelineRunner()
    print("Starting Pipecat Runner...")
    await runner.run(task)

# To run the pipeline dynamically when a user connects, 
# we'd usually have a more complex orchestrator.
# For this playground, let's trigger it via another endpoint or a background task.

@app.post("/agent/start")
async def start_agent(request: Request):
    data = await request.json()
    room_url = data.get("room_url")
    system_prompt = data.get("system_prompt", "You are a helpful assistant.")
    if not room_url:
        return {"error": "room_url required"}
    
    # Run in background
    asyncio.create_task(run_pipecat_pipeline(room_url, system_prompt))
    return {"status": "agent_starting"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
