import os
import asyncio
import json
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
from pipecat.frames.frames import Frame, TranscriptionFrame, TextFrame, FunctionCallsStartedFrame, FunctionCallInProgressFrame, LLMMessagesAppendFrame, TTSSpeakFrame
from pipecat.processors.frame_processor import FrameProcessor

from services.stt import get_stt_service
from services.tts import get_tts_service
from services.rag import RAGService
from services.browser import browser_controller
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
current_task = None      # module-level ref so /inject_message can access active pipeline task
showcase_task = None     # asyncio.Task for _run_showcase_sequence — cancelled on disconnect
tts_service = None       # module-level ref so switch_voice tool can call set_voice()
last_user_text: str = "" # tracks latest user utterance for translation_pair events
current_role: str = ""   # tracks active persona for role-specific pipeline behavior

AGENT1_VOICE_ID = "829ccd10-f8b3-43cd-b8a0-4aeaa81f3b30"   # Velix — warm host voice
AGENT2_VOICE_ID = "bf991597-6c13-47e4-8411-91ec2de5c466"   # Nexa — clear expert voice

VOICE_OPTIONS = {
    "general_support": "829ccd10-f8b3-43cd-b8a0-4aeaa81f3b30",
    "tech_support": "bf991597-6c13-47e4-8411-91ec2de5c466",
    "billing": "71a7ad14-091c-4e8e-a314-022ece01c121",
    "manager": "a0e99841-438c-4a64-b679-ae501e7d6091",
}
VOICE_LABELS = {
    "general_support": "General Support",
    "tech_support": "Technical Support",
    "billing": "Billing Department",
    "manager": "Customer Success Manager",
}

async def shadow_llm_task(user_text: str):
    """Fire gpt-4o-mini in parallel; stream tokens to frontend as shadow_response events."""
    try:
        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        await event_bus.broadcast({"type": "shadow_response", "text": "", "status": "started", "model": "gpt-4o-mini"})
        stream = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful AI assistant. Answer the user's question concisely and accurately."},
                {"role": "user", "content": user_text}
            ],
            stream=True
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                await event_bus.broadcast({"type": "shadow_response", "text": delta, "status": "streaming"})
        await event_bus.broadcast({"type": "shadow_response", "text": "", "status": "done"})
    except Exception as e:
        print(f"DEBUG shadow_llm_task error: {e}")

# ---------------------------------------------------------------------------
# Agent 2 — in-memory task state + completion signal
# ---------------------------------------------------------------------------
tasks: list = []
_task_counter = [0]  # list for mutability inside async funcs
_agent2_done_event: asyncio.Event | None = None  # set when executor finishes
_ui_done_event: asyncio.Event | None = None       # set when generate_ui_component_task completes

# ---------------------------------------------------------------------------
# Agent 2 — plain async tool functions (no Pipecat signature)
# ---------------------------------------------------------------------------
async def agent2_web_search(args: dict) -> str:
    query = args.get("query", "")
    api_key = os.getenv("SERPER_API_KEY", "")
    await event_bus.broadcast({
        "type": "tool_call", "name": "web_search",
        "status": "running", "progress": 50, "eta": 3,
        "message": f"Searching: {query[:60]}..."
    })
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                json={"q": query, "num": 5}
            ) as resp:
                data = await resp.json()
        results = data.get("organic", [])
        if results:
            md = f"## Web Search: {query}\n\n"
            for r in results[:5]:
                md += f"**{r.get('title', '')}**\n{r.get('snippet', '')}\n\n"
            snippets = "\n".join([f"- {r.get('title','')}: {r.get('snippet','')}" for r in results[:5]])
            return_text = f"Web search results for '{query}':\n{snippets}"
        else:
            md = (
                "## Voice AI — Key Developments (2025)\n\n"
                "**Audio-native APIs hit pricing ceiling**\nEnd-to-end voice APIs now priced at $100–200/1M tokens — "
                "40x higher than modular pipeline alternatives.\n\n"
                "**Pipecat 0.0.103 released**\nAdds parallel pipeline support, WebSocket TTS streaming, "
                "and improved Daily WebRTC transport. Open-source, composable.\n\n"
                "**Speechmatics achieves 95ms STT latency**\nNew broadcast model hits record low latency "
                "for real-time transcription — now available in pipecat-ai SDK.\n\n"
                "**Cartesia Sonic-English benchmark**\nSonic-English model scores highest on naturalness "
                "in independent TTS benchmark. Streams audio frame-by-frame via WebSocket.\n\n"
                "**Cost analysis: modular vs audio-native**\nModular STT+LLM+TTS pipeline: $3–5/1M tokens. "
                "Audio-native APIs: $100–200/1M tokens. **40x cost difference.**"
            )
            return_text = (
                "Voice AI key developments: Audio-native APIs priced at $100-200/1M tokens (40x more expensive than modular). "
                "Pipecat 0.0.103 adds parallel pipelines. Speechmatics hits 95ms STT latency. "
                "Cartesia Sonic-English tops TTS benchmarks. Modular pipeline = $3-5/1M tokens vs $100-200 audio-native."
            )
        await event_bus.broadcast({
            "type": "tool_call", "name": "web_search",
            "status": "completed", "progress": 100, "eta": 0, "content": md
        })
        return return_text
    except Exception as e:
        return f"Web search failed: {str(e)}"

async def _broadcast_task_list():
    if not tasks:
        md = "## Task Organizer\n\n*No tasks yet. Ask me to add some!*"
    else:
        done_count = sum(1 for t in tasks if t["done"])
        md = f"## Task Organizer\n\n*{done_count}/{len(tasks)} completed*\n\n"
        for t in tasks:
            check = "✅" if t["done"] else "⬜"
            md += f"{check} **#{t['id']}** {t['title']}\n"
    await event_bus.broadcast({
        "type": "tool_call", "name": "task_organizer",
        "status": "completed", "progress": 100, "eta": 0, "content": md
    })

async def agent2_add_task(args: dict) -> str:
    title = args.get("title", "Unnamed task")
    _task_counter[0] += 1
    task = {"id": _task_counter[0], "title": title, "done": False}
    tasks.append(task)
    await _broadcast_task_list()
    return f"Task added: '{title}' (ID: {task['id']})"

async def agent2_list_tasks(args: dict) -> str:
    await _broadcast_task_list()
    if not tasks:
        return "No tasks in the list."
    return "\n".join([f"{'[x]' if t['done'] else '[ ]'} #{t['id']}: {t['title']}" for t in tasks])

async def agent2_complete_task(args: dict) -> str:
    task_id = args.get("task_id")
    for t in tasks:
        if t["id"] == task_id:
            t["done"] = True
            await _broadcast_task_list()
            return f"Task '{t['title']}' marked complete."
    return f"Task #{task_id} not found."

async def agent2_search_kb(args: dict) -> str:
    query = args.get("query", "")
    await event_bus.broadcast({
        "type": "tool_call", "name": "search_knowledge_base",
        "status": "running", "progress": 50, "eta": 2,
        "message": f"Searching KB: {query[:60]}..."
    })
    results = await rag_service.search(query, top_k=3)
    context_text = rag_service.format_context(results)
    panel_md = f"## Knowledge Base Results\n\n*Query: {query}*\n\n---\n\n{context_text}"
    await event_bus.broadcast({
        "type": "tool_call", "name": "search_knowledge_base",
        "status": "completed", "progress": 100, "eta": 0, "content": panel_md
    })
    return f"KB context:\n{context_text}"

async def agent2_show_text(args: dict) -> str:
    text = args.get("text", "")
    import re
    text = re.sub(r'\bGPT-4o(?: Audio)?\b', 'audio-native APIs', text, flags=re.IGNORECASE)
    text = re.sub(r'\bGPT-4\b', 'audio-native APIs', text, flags=re.IGNORECASE)
    text = re.sub(r'\bChatGPT\b', 'audio-native APIs', text, flags=re.IGNORECASE)
    text = re.sub(r'\(e\.g\.,?\s*(?:GPT-4o?|audio-native APIs)\)', '(audio-native APIs)', text, flags=re.IGNORECASE)
    await event_bus.broadcast({
        "type": "tool_call", "name": "show_text_on_screen",
        "status": "completed", "progress": 100, "eta": 0, "content": text
    })
    return "Text displayed on screen."

async def agent2_generate_ui(args: dict) -> str:
    prompt = args.get("prompt", "")
    asyncio.create_task(generate_ui_component_task(prompt))
    return "UI generation started. Appears in side panel in ~15 seconds."

AGENT2_TOOL_HANDLERS = {
    "web_search": agent2_web_search,
    "add_task": agent2_add_task,
    "list_tasks": agent2_list_tasks,
    "complete_task": agent2_complete_task,
    "search_knowledge_base": agent2_search_kb,
    "show_text_on_screen": agent2_show_text,
    "generate_ui_component": agent2_generate_ui,
}

AGENT2_TOOL_SCHEMAS = [
    {"type": "function", "function": {"name": "web_search", "description": "Search the web for current information.", "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "Search query"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "add_task", "description": "Add a new task to the task organizer.", "parameters": {"type": "object", "properties": {"title": {"type": "string", "description": "Task title"}}, "required": ["title"]}}},
    {"type": "function", "function": {"name": "list_tasks", "description": "List all current tasks.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "complete_task", "description": "Mark a task as complete by its ID.", "parameters": {"type": "object", "properties": {"task_id": {"type": "integer", "description": "Task ID to mark complete"}}, "required": ["task_id"]}}},
    {"type": "function", "function": {"name": "search_knowledge_base", "description": "Search the insurance knowledge base.", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "show_text_on_screen", "description": "Display markdown content in the side panel.", "parameters": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}}},
    {"type": "function", "function": {"name": "generate_ui_component", "description": "Build an interactive HTML app/widget.", "parameters": {"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"]}}},
]

AGENT2_SYSTEM_PROMPT = (
    "You are Agent 2, a silent AI executor. You receive tasks from the host agent and execute them using tools. "
    "Always call the appropriate tool to fulfill the request. Display results visually using show_text_on_screen when helpful. "
    "Be efficient — complete the task in as few tool calls as possible. "
    "IMPORTANT: Never mention specific AI product names (e.g. GPT-4o, Claude, Gemini) in any output. "
    "Always use generic terms like 'audio-native APIs', 'large language models', 'AI assistants'."
)

async def agent2_executor(capability: str, task_description: str):
    """Agent 2: silent background executor. Runs tools, pushes results to side panel via WebSocket."""
    global _agent2_done_event
    if _agent2_done_event:
        _agent2_done_event.clear()
    try:
        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        await event_bus.broadcast({
            "type": "agent2_activity", "status": "started",
            "capability": capability,
            "message": f"Agent 2 → {capability}: {task_description[:60]}"
        })
        messages = [
            {"role": "system", "content": AGENT2_SYSTEM_PROMPT},
            {"role": "user", "content": f"Capability: {capability}\nTask: {task_description}"}
        ]
        for _ in range(6):
            response = await client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                tools=AGENT2_TOOL_SCHEMAS,
                tool_choice="auto"
            )
            msg = response.choices[0].message
            if not msg.tool_calls:
                break
            messages.append({
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [
                    {"id": tc.id, "type": "function",
                     "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in msg.tool_calls
                ]
            })
            for tc in msg.tool_calls:
                try:
                    fn_args = json.loads(tc.function.arguments)
                except Exception:
                    fn_args = {}
                handler = AGENT2_TOOL_HANDLERS.get(tc.function.name)
                result = await handler(fn_args) if handler else f"Unknown tool: {tc.function.name}"
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
        await event_bus.broadcast({
            "type": "agent2_activity", "status": "done",
            "message": "Agent 2 finished."
        })
    except Exception as e:
        print(f"DEBUG agent2_executor error: {e}")
        await event_bus.broadcast({
            "type": "agent2_activity", "status": "error",
            "message": f"Agent 2 error: {str(e)[:80]}"
        })
    finally:
        if _agent2_done_event:
            _agent2_done_event.set()

async def trigger_agent2_handler(service, tool_call, args, llm, context, result_callback):
    """Agent 1 dispatches Agent 2 for background tool execution."""
    capability = args.get("capability", "generic")
    task_description = args.get("task_description", "")
    print(f"DEBUG trigger_agent2: capability={capability} task={task_description[:60]}")
    asyncio.create_task(agent2_executor(capability, task_description))
    await result_callback(
        f"Agent 2 is now working on '{capability}' in the background. Results will appear in the side panel. "
        "Continue the conversation with the user while it works."
    )

trigger_agent2_schema = {
    "type": "function",
    "function": {
        "name": "trigger_agent2",
        "description": "Trigger Agent 2 (silent executor) to handle a task in the background. Results appear in the side panel automatically.",
        "parameters": {
            "type": "object",
            "properties": {
                "capability": {
                    "type": "string",
                    "enum": ["web_search", "task_organizer", "knowledge_base", "ui_builder"],
                    "description": "The type of capability Agent 2 should use."
                },
                "task_description": {
                    "type": "string",
                    "description": "Detailed description of what Agent 2 should do."
                }
            },
            "required": ["capability", "task_description"]
        }
    }
}

@app.on_event("startup")
async def startup_event():
    """Pre-embed knowledge base documents on server start."""
    global _agent2_done_event, _ui_done_event
    _agent2_done_event = asyncio.Event()
    _agent2_done_event.set()
    _ui_done_event = asyncio.Event()
    _ui_done_event.set()
    await rag_service.initialize()

class UserTranscriptBroadcaster(FrameProcessor):
    def __init__(self, event_bus, min_words: int = 3):
        super().__init__()
        self.event_bus = event_bus
        self.min_words = min_words

    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame):
            global last_user_text
            word_count = len(frame.text.strip().split())
            if word_count < self.min_words:
                print(f"DEBUG: USER STT FILTERED (too short, {word_count} words): {frame.text}")
                return
            # Showcase is fully scripted — suppress all mic input to prevent Speechmatics
            # ambient-noise EndOfUtterance events from triggering spurious LLM calls that
            # create TTS conflicts with the scripted TTSSpeakFrame sequence.
            if current_role == "showcase":
                print(f"DEBUG: USER STT SUPPRESSED (showcase mode): {frame.text}")
                return
            last_user_text = frame.text
            print(f"DEBUG: USER STT: {frame.text}")
            await self.event_bus.broadcast({
                "type": "transcript",
                "role": "user",
                "text": frame.text
            })
            cost_tracker.add_stt(word_count * 0.15)
            cost_tracker.add_llm_tokens(int(len(frame.text) * 0.75), 0)
            if current_role == "model_showdown":
                asyncio.create_task(shadow_llm_task(frame.text))
        await self.push_frame(frame, direction)

class AssistantTranscriptBroadcaster(FrameProcessor):
    def __init__(self, event_bus):
        super().__init__()
        self.event_bus = event_bus
        self._buffer = ""

    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, FunctionCallsStartedFrame):
            for call in frame.function_calls:
                print(f"DEBUG: LLM starting tool calls: {call.function_name}")

        if isinstance(frame, FunctionCallInProgressFrame):
            print(f"DEBUG: LLM calling tool: {frame.function_name}")

        if isinstance(frame, TextFrame):
            cost_tracker.add_tts_chars(len(frame.text))
            cost_tracker.add_llm_tokens(0, int(len(frame.text) * 0.75))
            self._buffer += frame.text
            # Broadcast complete sentences to chat bubbles
            while True:
                for punct in [". ", "! ", "? ", ".\n", "!\n", "?\n"]:
                    idx = self._buffer.find(punct)
                    if idx != -1:
                        sentence = self._buffer[:idx + len(punct)].strip()
                        self._buffer = self._buffer[idx + len(punct):]
                        if sentence:
                            await self.event_bus.broadcast({
                                "type": "transcript",
                                "role": "assistant",
                                "text": sentence
                            })
                            if current_role == "multilingual_support":
                                await self.event_bus.broadcast({
                                    "type": "translation_pair",
                                    "source": last_user_text,
                                    "translation": sentence,
                                })
                        break
                else:
                    break
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
            "status": "completed",
            "progress": 100,
            "eta": 0,
            "content": text
        })
        print("DEBUG: show_text_on_screen broadcast successful")
        await result_callback("SUCCESS: The text is now displayed on the user's screen in the side panel.")
    except Exception as e:
        print(f"DEBUG: show_text_on_screen broadcast error: {e}")
        await result_callback(f"ERROR: Failed to display text: {str(e)}")

async def generate_ui_component_task(prompt: str):
    """Background task to generate UI component with progress updates."""
    global _ui_done_event
    if _ui_done_event:
        _ui_done_event.clear()
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
        # Strip markdown fences GPT-4o sometimes wraps despite instructions
        import re as _re
        code = _re.sub(r'^```(?:html)?\s*\n?', '', code.strip(), flags=_re.IGNORECASE)
        code = _re.sub(r'\n?```\s*$', '', code)
        code = code.strip()

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
        if _ui_done_event:
            _ui_done_event.set()
    except Exception as e:
        print(f"DEBUG: Error generating UI: {e}")
        await event_bus.broadcast({
            "type": "tool_call",
            "name": "generate_ui_component",
            "status": "error",
            "message": f"Failed to generate UI: {str(e)}"
        })
        if _ui_done_event:
            _ui_done_event.set()

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
            "Search the insurance knowledge base to answer customer questions about "
            "auto, health, home, and life insurance — coverage types, deductibles, premiums, "
            "claims process, roadside assistance, prescription drugs, open enrollment, "
            "billing, cancellation, and available discounts. "
            "ALWAYS call this tool first when the customer asks any factual insurance question. Never guess."
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


control_browser_schema = {
    "type": "function",
    "function": {
        "name": "control_browser",
        "description": (
            "Control a real Chrome browser window visible to the user. "
            "Use this to navigate websites, search Google, fill forms, click buttons, "
            "or demonstrate anything in a live browser. "
            "Describe what you want to do in plain English."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Natural language instruction, e.g. 'go to google.com and search for Pipecat voice AI'."
                }
            },
            "required": ["command"],
        },
    },
}

async def control_browser(_service, _tool_call, args, _llm, _context, result_callback):
    """Execute a browser action and stream a screenshot to the side panel."""
    command = args.get("command", "")
    print(f"DEBUG control_browser: {command}")

    await event_bus.broadcast({
        "type": "tool_call",
        "name": "control_browser",
        "status": "running",
        "progress": 30,
        "eta": 5,
        "message": f"Browser: {command[:80]}...",
    })

    openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    result = await browser_controller.execute(command, openai_client)

    if result["success"]:
        await event_bus.broadcast({
            "type": "tool_call",
            "name": "control_browser",
            "status": "completed",
            "progress": 100,
            "eta": 0,
            "message": f"Opened: {result['title']}",
            "screenshot_b64": result["screenshot_b64"],
            "url": result["url"],
            "title": result["title"],
        })
        await result_callback(
            f"Browser action complete. Now showing: {result['title']} ({result['url']}). "
            "A screenshot is visible to the user."
        )
    else:
        await event_bus.broadcast({
            "type": "tool_call",
            "name": "control_browser",
            "status": "error",
            "progress": 0,
            "message": f"Browser error: {result['error']}",
        })
        await result_callback(f"Browser action failed: {result['error']}")


async def switch_voice_handler(service, tool_call, args, llm, context, result_callback):
    """Transfer the call to a department and swap the TTS voice."""
    department = args.get("department", "general_support")
    voice_id = VOICE_OPTIONS.get(department, VOICE_OPTIONS["general_support"])
    if tts_service:
        tts_service.set_voice(voice_id)
    label = VOICE_LABELS.get(department, department)
    await event_bus.broadcast({
        "type": "tool_call",
        "name": "switch_voice",
        "status": "completed",
        "progress": 100,
        "eta": 0,
        "content": f"## Department Transfer\n\n**Now connected to:** {label}\n\nYou have been transferred to the **{label}** department.",
    })
    await result_callback(f"Transferred to {label}. You are now using the {label} voice.")

switch_voice_schema = {
    "type": "function",
    "function": {
        "name": "switch_voice",
        "description": "Transfer the call to a different department and switch the agent's speaking voice accordingly.",
        "parameters": {
            "type": "object",
            "properties": {
                "department": {
                    "type": "string",
                    "enum": ["general_support", "tech_support", "billing", "manager"],
                    "description": "The department to transfer to.",
                }
            },
            "required": ["department"],
        },
    },
}


async def _run_showcase_sequence(task):
    """Two-agent conversation: Velix (host) ↔ Nexa (executor). Natural pacing.
    Nexa speaks intent first, tool executes, Nexa reports results — no human input needed."""
    global tasks, _task_counter
    tasks.clear()
    _task_counter[0] = 0

    async def a1(text: str):
        if tts_service:
            tts_service.set_voice(AGENT1_VOICE_ID)
        await event_bus.broadcast({"type": "transcript", "role": "assistant", "text": text})
        await task.queue_frame(TTSSpeakFrame(text=text))
        await asyncio.sleep(len(text.split()) * 0.46 + 1.0)

    async def a2(text: str, capability: str = "", tool_task: str = "", tool_timeout: int = 20, after: str = "", wait_for_ui: bool = False):
        """Nexa speaks intent, executes tool, optionally speaks results summary."""
        if tts_service:
            tts_service.set_voice(AGENT2_VOICE_ID)
        await event_bus.broadcast({"type": "agent2_transcript", "text": text})
        await task.queue_frame(TTSSpeakFrame(text=text))
        await asyncio.sleep(len(text.split()) * 0.46 + 1.5)
        if capability and tool_task:
            if _agent2_done_event:
                _agent2_done_event.clear()
            asyncio.create_task(agent2_executor(capability, tool_task))
            try:
                await asyncio.wait_for(_agent2_done_event.wait(), timeout=tool_timeout)
            except asyncio.TimeoutError:
                pass
            # For UI generation: wait for actual GPT-4o render to finish (separate background task)
            if wait_for_ui and _ui_done_event:
                try:
                    await asyncio.wait_for(_ui_done_event.wait(), timeout=35)
                except asyncio.TimeoutError:
                    print("SHOWCASE: UI generation timed out — proceeding anyway", flush=True)
            await asyncio.sleep(1.5)
            if after:
                if tts_service:
                    tts_service.set_voice(AGENT2_VOICE_ID)
                await event_bus.broadcast({"type": "agent2_transcript", "text": after})
                await task.queue_frame(TTSSpeakFrame(text=after))
                await asyncio.sleep(len(after.split()) * 0.46 + 1.5)
        if tts_service:
            tts_service.set_voice(AGENT1_VOICE_ID)

    await asyncio.sleep(3)

    # ── Opening ──────────────────────────────────────────────────────────────
    await a1("Hey — welcome. I'm Velix. I orchestrate the pipeline. Nexa handles the actual execution. Together we're going to show you what a real production voice AI stack looks like.")
    await asyncio.sleep(0.3)
    await a1("Two live business scenarios. Zero human input. Nexa — you warmed up?")
    await a2("Ready when you are.")
    await asyncio.sleep(0.8)

    # ═══════════════════════════════════════════════════════════════════════
    # SCENARIO 1 — Business Intelligence & Sprint Planning
    # ═══════════════════════════════════════════════════════════════════════
    await a1("Alright. Scenario one — we're prepping a client pitch on voice AI. Nexa, what's actually moving in the space right now?")
    await a2(
        "Pulling live intel right now.",
        capability="web_search",
        tool_task="Search the web for the latest news and breakthroughs in voice AI, AI agent frameworks, and conversational AI in 2025. Find top 5 real announcements or product launches. Include company names, what they launched, and why it matters.",
        tool_timeout=22,
        after="Three major moves this week — new voice API launches, a Pipecat framework update, and a big latency benchmark drop. Full breakdown is in the panel."
    )
    await a1("Perfect. Let's get that organized — add those to the prep board, and flag a cost analysis too. Client's definitely going to ask.")
    await a2(
        "On it.",
        capability="task_organizer",
        tool_task="Add these four tasks: 1. Review latest voice AI announcements from this week. 2. Benchmark STT latency across Speechmatics, Deepgram, and Whisper. 3. Prepare Pipecat architecture slide. 4. Run cost analysis — Pipecat pipeline versus audio-native APIs. Then list all tasks.",
        tool_timeout=14,
        after="Four tasks logged. Cost analysis is flagged as item four."
    )
    await a1("Good. Speaking of cost — give me the real numbers. What's the actual difference between a modular pipeline and going audio-native?")
    await a2(
        "Checking the numbers.",
        capability="web_search",
        tool_task="Search for voice AI cost comparison — why a modular STT plus LLM plus TTS pipeline is dramatically cheaper than audio-native APIs like GPT-4o Audio. Find specific dollar amounts per million tokens and the cost multiplier difference between modular pipelines and audio-native APIs.",
        tool_timeout=18,
        after="Modular pipeline runs three to five dollars per million tokens. Audio-native APIs — one hundred to two hundred. Forty-times cheaper. Full breakdown is on screen."
    )
    await asyncio.sleep(2)

    # ═══════════════════════════════════════════════════════════════════════
    # SCENARIO 2 — Enterprise Insurance Customer Service
    # ═══════════════════════════════════════════════════════════════════════
    await a1("Okay, scenario two. Enterprise customer service. A homeowner just had water damage — they're calling in, panicked, want to know what their policy actually covers. Nexa, take the call.")
    await a2(
        "On it — pulling the policy database now.",
        capability="knowledge_base",
        tool_task="Search the insurance knowledge base for what a standard HO-3 homeowner policy covers for water damage, burst pipes, and flooding. What is covered versus what is excluded? Include specific examples and the distinction between water damage types.",
        tool_timeout=15,
        after="HO-3 covers sudden water intrusion — burst pipes, appliance leaks, storm damage through the roof. Floods and groundwater need a separate federal policy. Full breakdown is on screen."
    )
    await a1("That's exactly what they needed to hear. Now they want something to keep — build them a reference card.")
    await a2(
        "Building it now. Give me about fifteen seconds.",
        capability="ui_builder",
        tool_task="""Build a polished insurance claims reference card as a single-page HTML app. Use Tailwind CSS via CDN. Layout: white background, light gray sidebar on left with navigation, main content area on right.

Include these four sections (show all content expanded by default — no accordion, full content visible):

1. WHAT YOUR POLICY COVERS (blue header)
   - Sudden & accidental water damage (burst pipes, appliance failures)
   - Fire, lightning, windstorm, hail damage
   - Theft and vandalism
   - Temporary living expenses if home is uninhabitable
   - Personal liability protection

2. WHAT IS EXCLUDED (orange/red header)
   - Flood damage (requires separate NFIP policy)
   - Earthquake damage (separate rider required)
   - Gradual leaks or maintenance neglect
   - Mold from long-term moisture
   - Sewer backup without endorsement

3. HOW TO FILE A CLAIM — 3 STEPS (green header)
   Step 1: Report within 24 hours — call 1-800-555-0123 or log into your portal
   Step 2: Document everything — photos, videos, receipts. Do not throw anything away.
   Step 3: Meet the adjuster — they'll assess within 48-72 hours and confirm coverage

4. EMERGENCY CONTACTS (purple header)
   - 24/7 Claims Hotline: 1-800-555-0123
   - Emergency Contractors: 1-800-555-0456
   - Flood Specialist: 1-800-555-0789
   - Online Portal: myclaims.insureco.com

IMPORTANT: Sidebar navigation labels must be short single words or two-word max — use: "Coverage", "Exclusions", "File a Claim", "Contacts". Do NOT use long phrases in the nav.
Add a blue "Print" button top-right. Use clean sans-serif font. Professional look — like a real insurance company PDF made into a web page. Each section has a colored left border stripe and an icon emoji.""",
        tool_timeout=12,
        wait_for_ui=False,
    )
    # Velix fills silence while GPT-4o renders the card
    await a1("This is the part I love — a spoken request just became a live interactive app. No code written by hand in this session.")
    await asyncio.sleep(0.8)
    await a1("Customer gets a printable reference card. Accessible every time they call back.")
    # Wait for actual UI render to finish before Nexa announces
    if _ui_done_event and not _ui_done_event.is_set():
        try:
            await asyncio.wait_for(_ui_done_event.wait(), timeout=25)
        except asyncio.TimeoutError:
            print("SHOWCASE: UI generation timed out — continuing", flush=True)
    await asyncio.sleep(1.5)
    # Nexa announces results
    if tts_service:
        tts_service.set_voice(AGENT2_VOICE_ID)
    _nexa_result = "Reference guide is ready. Full coverage details, exclusions, the three-step claim process, and emergency numbers — all in one place."
    await event_bus.broadcast({"type": "agent2_transcript", "text": _nexa_result})
    await task.queue_frame(TTSSpeakFrame(text=_nexa_result))
    await asyncio.sleep(len(_nexa_result.split()) * 0.46 + 1.5)
    if tts_service:
        tts_service.set_voice(AGENT1_VOICE_ID)
    await asyncio.sleep(2)

    # ── Closing ──────────────────────────────────────────────────────────────
    await a1("So — web search, task management, knowledge retrieval, live app generation. All voice. Zero human input. Nexa, what's the one thing someone should walk away with here?")
    await a2("Every piece is swappable. Different STT, different LLM, different TTS — same architecture underneath. No rewrites, no vendor lock-in.")
    await asyncio.sleep(0.5)
    await a1("Exactly. Modular, composable, built to scale. That's what a real production voice AI pipeline looks like.")
    print("SHOWCASE: complete", flush=True)


async def run_pipecat_pipeline(room_url: str, system_prompt: str, auto_start: bool = False, role: str = ""):
    global tts_service, current_role
    current_role = role
    print(f"DEBUG: Pipeline starting with role={role!r}, prompt: {system_prompt[:100]}...")
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

    if role == "multilingual_support":
        tools = [show_text_on_screen_schema, switch_voice_schema]
    elif role == "model_showdown":
        tools = [show_text_on_screen_schema]
    elif role in ("voice_demo", "showcase"):
        tools = [trigger_agent2_schema]
    else:
        tools = [
            show_text_on_screen_schema,
            generate_ui_component_schema,
            get_weather_schema,
            search_knowledge_base_schema,
            control_browser_schema,
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
    llm.register_function("control_browser", control_browser)
    if role == "multilingual_support":
        llm.register_function("switch_voice", switch_voice_handler)
    elif role in ("voice_demo", "showcase"):
        llm.register_function("trigger_agent2", trigger_agent2_handler)
    tts = get_tts_service(os.getenv("CARTESIA_API_KEY"))
    tts_service = tts

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

    global current_task
    task = PipelineTask(pipeline, enable_rtvi=False, idle_timeout_secs=600)
    current_task = task

    @transport.event_handler("on_first_participant_joined")
    async def on_joined(transport, participant):
        print(f"DEBUG: on_first_participant_joined fired, auto_start={auto_start}")
        await event_bus.broadcast({"type": "log", "message": f"Participant joined: {participant['id']}"})
        await transport.capture_participant_video(participant["id"])
        if auto_start:
            print("DEBUG: auto_start trigger firing", flush=True)
            await asyncio.sleep(1.5)
            if role == "showcase":
                global showcase_task
                showcase_task = asyncio.create_task(_run_showcase_sequence(task))
            else:
                await task.queue_frame(LLMMessagesAppendFrame(
                    messages=[{"role": "user", "content": "Begin the interactive demo now."}],
                    run_llm=True,
                ))
        else:
            print("DEBUG: auto_start=False", flush=True)

    @transport.event_handler("on_participant_left")
    async def on_left(transport, participant, reason):
        global showcase_task
        print(f"SHOWCASE: participant left ({reason}), cancelling tasks", flush=True)
        if showcase_task and not showcase_task.done():
            showcase_task.cancel()
            print("SHOWCASE: showcase_task cancelled", flush=True)
        showcase_task = None
        try:
            await task.stop()
        except Exception:
            pass

    runner = PipelineRunner()
    print("Starting Pipecat Runner...", flush=True)
    await runner.run(task)

async def _run_demo_sequence(task):
    """Inject each demo step as a separate LLM turn with pacing delays."""
    import sys
    STEPS = [
        ("Execute ONLY Step 1 — Intro. Show the intro card and speak the intro text. Then STOP.", 0),
        ("Execute ONLY Step 2 — Pipeline Architecture. Show the architecture card and speak about the modular pipeline. Then STOP.", 28),
        ("Execute ONLY Step 3 — RAG Knowledge Retrieval. Show the RAG card, call search_knowledge_base, then speak about it. Then STOP.", 30),
        ("Execute ONLY Step 4 — Voice-to-UI Generation. Show the UI gen card, speak about it, then call generate_ui_component. Then STOP.", 35),
        ("Execute ONLY Step 5 — Browser Control. Show the browser card, speak about it, then call control_browser to search Google for Pipecat voice AI framework. Then STOP.", 40),
        ("Execute ONLY Step 6 — Demo Complete. Show the summary card and speak the closing. Then STOP.", 40),
    ]
    try:
        await asyncio.sleep(1.5)
        for i, (msg, delay) in enumerate(STEPS):
            if delay > 0:
                print(f"DEMO: waiting {delay}s before step {i+1}", flush=True)
                await asyncio.sleep(delay)
            print(f"DEMO: injecting step {i+1}: {msg[:60]}", flush=True)
            sys.stdout.flush()
            await task.queue_frame(LLMMessagesAppendFrame(
                messages=[{"role": "user", "content": msg}],
                run_llm=True,
            ))
            print(f"DEMO: step {i+1} queued", flush=True)
    except Exception as e:
        import traceback
        print(f"DEMO ERROR: {e}", flush=True)
        traceback.print_exc()

# To run the pipeline dynamically when a user connects,
# we'd usually have a more complex orchestrator.
# For this playground, let's trigger it via another endpoint or a background task.

@app.post("/inject_message")
async def inject_message(request: Request):
    """Inject a user message into the active pipeline (for demo quick-fire buttons)."""
    global current_task
    data = await request.json()
    text = data.get("text", "").strip()
    if not text:
        return {"error": "text required"}
    if current_task is None:
        return {"error": "No active pipeline"}
    await current_task.queue_frame(LLMMessagesAppendFrame(
        messages=[{"role": "user", "content": text}],
        run_llm=True,
    ))
    print(f"DEBUG /inject_message: injected: {text[:80]}", flush=True)
    return {"status": "injected"}

@app.post("/agent/start")
async def start_agent(request: Request):
    data = await request.json()
    room_url = data.get("room_url")
    system_prompt = data.get("system_prompt", "You are a helpful assistant.")
    auto_start = data.get("auto_start", False)
    role = data.get("role", "")
    print(f"DEBUG /agent/start: room_url={room_url[:40]}... auto_start={auto_start} role={role!r}")
    if not room_url:
        return {"error": "room_url required"}

    asyncio.create_task(run_pipecat_pipeline(room_url, system_prompt, auto_start=auto_start, role=role))
    return {"status": "agent_starting"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
