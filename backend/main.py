import os
import asyncio
import time
from fastapi import FastAPI, WebSocket, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import aiohttp
from openai import AsyncOpenAI

from pipecat.transports.daily.transport import DailyTransport, DailyParams
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.frames.frames import Frame, TranscriptionFrame, TextFrame, FunctionCallsStartedFrame, FunctionCallInProgressFrame
from pipecat.processors.frame_processor import FrameProcessor

from services.stt import get_stt_service
from services.tts import get_tts_service
from services.rag import RAGService
from metrics import EventBus, MetricsTracker, CostTracker

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
cost_tracker = CostTracker()
rag_service = RAGService(openai_api_key=os.getenv("OPENAI_API_KEY", ""))

@app.on_event("startup")
async def startup_event():
    """Pre-embed knowledge base documents on server start."""
    await rag_service.initialize()

class UserTranscriptBroadcaster(FrameProcessor):
    def __init__(self, event_bus):
        super().__init__()
        self.event_bus = event_bus

    async def process_frame(self, frame: Frame, direction):
        if isinstance(frame, TranscriptionFrame):
            print(f"DEBUG: USER STT: {frame.text}")
            await self.event_bus.broadcast({
                "type": "transcript",
                "role": "user",
                "text": frame.text
            })
            # Estimate ~0.15 sec of speech per word for cost tracking
            cost_tracker.add_stt(len(frame.text.split()) * 0.15)
            # Estimate LLM input tokens (~0.75 tokens per char)
            cost_tracker.add_llm_tokens(int(len(frame.text) * 0.75), 0)
        await self.push_frame(frame, direction)

class AssistantTranscriptBroadcaster(FrameProcessor):
    def __init__(self, event_bus):
        super().__init__()
        self.event_bus = event_bus

    async def process_frame(self, frame: Frame, direction):
        if isinstance(frame, FunctionCallsStartedFrame):
            for call in frame.function_calls:
                print(f"DEBUG: LLM starting tool calls: {call.function_name}")
                
        if isinstance(frame, FunctionCallInProgressFrame):
            print(f"DEBUG: LLM calling tool: {frame.function_name}")
           
        if isinstance(frame, TextFrame):
            print(f"DEBUG: ASSISTANT TEXT: {frame.text[:50]}...")
            await self.event_bus.broadcast({
                "type": "transcript_partial",
                "role": "assistant",
                "text": frame.text
            })
            # Track TTS chars and LLM output tokens
            cost_tracker.add_tts_chars(len(frame.text))
            cost_tracker.add_llm_tokens(0, int(len(frame.text) * 0.75))
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
async def show_text_on_screen(service, tool_call, args, llm, context, result_callback):
    """Display text on the user's screen."""
    text = args.get("text", "")
    print(f"DEBUG: show_text_on_screen tool handler entering for: {text[:50]}...")
    
    try:
        await event_bus.broadcast({
            "type": "tool_call",
            "name": "show_text_on_screen",
            "content": text
        })
        print("DEBUG: show_text_on_screen broadcast successful")
        await result_callback("SUCCESS: The text is now displayed on the user's screen in the side panel.")
    except Exception as e:
        print(f"DEBUG: show_text_on_screen broadcast error: {e}")
        await result_callback(f"ERROR: Failed to display text: {str(e)}")

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
                {"role": "system", "content": "You are a professional web developer. Generate a COMPLETE, SINGLE-FILE HTML document that fulfills the user's request. Include <!DOCTYPE html>, <html>, <head>, and <body> tags. Use Tailwind CSS via CDN (<script src=\"https://cdn.tailwindcss.com\"></script>) for styling. Ensure the design is premium, modern, and interactive. Output ONLY the code, no markdown blocks, no explanation. Just the raw HTML content."},
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

async def generate_ui_component(service, tool_call, args, llm, context, result_callback):
    """Trigger background UI generation."""
    prompt = args.get("prompt", "")
    print(f"DEBUG: generate_ui_component tool handler entering for: {prompt}")
    
    # Start background task
    asyncio.create_task(generate_ui_component_task(prompt))
    
    # Return immediate acknowledgemnt to LLM
    await result_callback("SUCCESS: I have started building the UI component in the background. It will appear on the user's screen in about 15 seconds. You should inform the user that you are working on it and ask if they have any other questions while they wait.")

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
        "description": "Generate a dynamic, interactive mini-app, widget, or visualization as a standalone HTML page. Use this when the user asks for something visual, interactive, or complex like a dashboard, game, or specialized calculator.",
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

async def get_weather(service, tool_call, args, llm, context, result_callback):
    """Fetch current weather for a location."""
    location = args.get("location", "London")
    print(f"DEBUG: get_weather tool handler entering for: {location}")
    # Mock weather for demo
    weathers = {
        "london": "cloudy, 12°C",
        "new york": "sunny, 22°C",
        "tokyo": "rainy, 18°C",
        "san francisco": "foggy, 15°C",
        "paris": "romantic, 17°C"
    }
    result = weathers.get(location.lower(), f"sunny, 20°C in {location}")
    
    try:
        await event_bus.broadcast({
            "type": "log",
            "message": f"Weather fetched for {location}: {result}"
        })
        await result_callback(f"The current weather in {location} is {result}.")
    except Exception as e:
        await result_callback(f"ERROR: Failed to fetch weather: {str(e)}")

get_weather_schema = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a specific location.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city and country."
                }
            },
            "required": ["location"]
        }
    }
}

# ---------------------------------------------------------------------------
# RAG Tool — search the knowledge base and return grounded context
# ---------------------------------------------------------------------------
async def search_knowledge_base(_service, _tool_call, args, _llm, _context, result_callback):
    """Retrieve relevant documents from the knowledge base to answer the user's question."""
    query = args.get("query", "")
    print(f"DEBUG: search_knowledge_base query: {query[:80]}")

    await event_bus.broadcast({
        "type": "tool_call",
        "name": "search_knowledge_base",
        "status": "running",
        "progress": 50,
        "eta": 2,
        "message": f"Searching knowledge base for: {query[:60]}...",
        "prompt": query,
    })

    results = await rag_service.search(query, top_k=3)
    context_text = rag_service.format_context(results)

    # Track embedding cost (rough estimate: ~10 tokens per word in query)
    cost_tracker.add_embed_tokens(max(1, len(query.split()) * 10))

    # Broadcast cost update
    await event_bus.broadcast(cost_tracker.to_broadcast())

    # Show retrieved chunks in the side panel
    panel_md = f"## Knowledge Base Results\n\n*Query: {query}*\n\n---\n\n{context_text}"
    await event_bus.broadcast({
        "type": "tool_call",
        "name": "search_knowledge_base",
        "status": "completed",
        "progress": 100,
        "eta": 0,
        "message": "Knowledge base search complete",
        "content": panel_md,
    })

    await result_callback(
        f"KNOWLEDGE BASE CONTEXT (use this to answer the user — cite sources):\n\n{context_text}"
    )

search_knowledge_base_schema = {
    "type": "function",
    "function": {
        "name": "search_knowledge_base",
        "description": (
            "Search the company knowledge base to answer questions about pricing, HR policies, "
            "employee benefits, API documentation, integrations, and product features. "
            "ALWAYS call this tool first when the user asks any factual question about the company or product."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A concise search query capturing the user's question."
                }
            },
            "required": ["query"],
        },
    },
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

    cost_tracker.reset()
    stt = get_stt_service(os.getenv("SPEECHMATICS_API_KEY"), os.getenv("ENABLE_DIARIZATION") == "true")
    tools = [
        show_text_on_screen_schema,
        generate_ui_component_schema,
        get_weather_schema,
        search_knowledge_base_schema,
    ]

    llm = OpenAILLMService(
        api_key=os.getenv("OPENAI_API_KEY"),
        model="gpt-4o",
        tools=tools,
    )

    # Register tool handlers
    llm.register_function("show_text_on_screen", show_text_on_screen)
    llm.register_function("generate_ui_component", generate_ui_component)
    llm.register_function("get_weather", get_weather)
    llm.register_function("search_knowledge_base", search_knowledge_base)
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
    async def on_llm_start(_service):
        print("LLM response starting...")
        metrics.start("llm")

    @llm.event_handler("on_llm_response_end")
    async def on_llm_end(_service):
        lat = metrics.end("llm")
        print(f"LLM response finished in {lat}ms")
        await event_bus.broadcast({"type": "metrics", "llm_ms": lat})
        # Rough token estimate from accumulated transcript text (~0.75 tokens/char)
        # Pipecat doesn't expose raw usage counts here, so we estimate conservatively
        await event_bus.broadcast(cost_tracker.to_broadcast())

    # Pipecat 0.0.40+ handles interruptions automatically if configured in pipeline
    @transport.event_handler("on_bot_interruption")
    async def on_interruption(_transport, participant):
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
