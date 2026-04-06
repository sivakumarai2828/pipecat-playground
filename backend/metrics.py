import time
import json
from typing import Dict


# ---------------------------------------------------------------------------
# Cost Tracker — compares your Pipecat stack vs OpenAI Realtime API
# ---------------------------------------------------------------------------
class CostTracker:
    """
    Tracks token/character/time usage and computes real-time cost estimates.

    YOUR STACK (Pipecat modular pipeline):
      - STT : Speechmatics streaming  ~$0.0025 / min
      - LLM : GPT-4o (text)           $2.50 / 1M input tokens, $10 / 1M output tokens
      - TTS : Cartesia Sonic-2        $0.065 / 1K characters
      - Embeddings: text-embedding-3-small  $0.02 / 1M tokens (negligible)

    OPENAI REALTIME API (gpt-4o-realtime-preview):
      - Audio input tokens  : $100 / 1M tokens  (~32 audio tokens/sec)
      - Audio output tokens : $200 / 1M tokens  (~32 audio tokens/sec)
      - Text input tokens   : $5   / 1M tokens  (context, system prompt)
      - Text output tokens  : $20  / 1M tokens
    """

    # Prices (USD)
    YOUR_STT_PER_MIN = 0.0025
    YOUR_LLM_IN_PER_1M = 2.50
    YOUR_LLM_OUT_PER_1M = 10.00
    YOUR_TTS_PER_1K_CHARS = 0.065
    YOUR_EMBED_PER_1M = 0.02

    OAI_AUDIO_IN_PER_1M = 100.0
    OAI_AUDIO_OUT_PER_1M = 200.0
    OAI_TEXT_IN_PER_1M = 5.0
    OAI_TEXT_OUT_PER_1M = 20.0

    # Realtime API: ~32 audio tokens per second of audio
    REALTIME_AUDIO_TOKENS_PER_SEC = 32

    def __init__(self):
        self.reset()

    def reset(self):
        self.stt_seconds: float = 0.0
        self.llm_input_tokens: int = 0
        self.llm_output_tokens: int = 0
        self.tts_chars: int = 0
        self.embed_tokens: int = 0

    # ------------------------------------------------------------------
    # Accumulation helpers (called from pipeline event handlers)
    # ------------------------------------------------------------------

    def add_stt(self, seconds: float):
        self.stt_seconds += seconds

    def add_llm_tokens(self, input_tokens: int, output_tokens: int):
        self.llm_input_tokens += input_tokens
        self.llm_output_tokens += output_tokens

    def add_tts_chars(self, char_count: int):
        self.tts_chars += char_count

    def add_embed_tokens(self, token_count: int):
        self.embed_tokens += token_count

    # ------------------------------------------------------------------
    # Cost calculations
    # ------------------------------------------------------------------

    def your_stack_cost(self) -> dict:
        stt = (self.stt_seconds / 60.0) * self.YOUR_STT_PER_MIN
        llm = (
            self.llm_input_tokens / 1_000_000 * self.YOUR_LLM_IN_PER_1M
            + self.llm_output_tokens / 1_000_000 * self.YOUR_LLM_OUT_PER_1M
        )
        tts = (self.tts_chars / 1_000.0) * self.YOUR_TTS_PER_1K_CHARS
        embed = self.embed_tokens / 1_000_000 * self.YOUR_EMBED_PER_1M
        total = stt + llm + tts + embed
        return {
            "stt": round(stt, 6),
            "llm": round(llm, 6),
            "tts": round(tts, 6),
            "embed": round(embed, 6),
            "total": round(total, 6),
        }

    def realtime_api_cost(self) -> dict:
        """Estimate what the same conversation would cost on OpenAI Realtime API."""
        # Audio input: STT seconds worth of audio tokens
        audio_in_tokens = self.stt_seconds * self.REALTIME_AUDIO_TOKENS_PER_SEC
        # Audio output: estimate ~15 chars/sec of speech → TTS chars → audio tokens
        estimated_tts_seconds = self.tts_chars / 15.0
        audio_out_tokens = estimated_tts_seconds * self.REALTIME_AUDIO_TOKENS_PER_SEC
        # Context (system prompt + history) still billed as text tokens
        text_in = self.llm_input_tokens
        text_out = self.llm_output_tokens

        cost = (
            audio_in_tokens / 1_000_000 * self.OAI_AUDIO_IN_PER_1M
            + audio_out_tokens / 1_000_000 * self.OAI_AUDIO_OUT_PER_1M
            + text_in / 1_000_000 * self.OAI_TEXT_IN_PER_1M
            + text_out / 1_000_000 * self.OAI_TEXT_OUT_PER_1M
        )
        return {"total": round(cost, 6)}

    def savings_pct(self) -> float:
        your = self.your_stack_cost()["total"]
        realtime = self.realtime_api_cost()["total"]
        if realtime <= 0:
            return 0.0
        return round(max(0.0, (realtime - your) / realtime * 100), 1)

    def to_broadcast(self) -> dict:
        your = self.your_stack_cost()
        realtime = self.realtime_api_cost()
        return {
            "type": "cost_update",
            "your_stack": your,
            "realtime_api": realtime,
            "savings_pct": self.savings_pct(),
            "stats": {
                "stt_seconds": round(self.stt_seconds, 1),
                "llm_input_tokens": self.llm_input_tokens,
                "llm_output_tokens": self.llm_output_tokens,
                "tts_chars": self.tts_chars,
            },
        }


class EventBus:
    def __init__(self):
        self.subscribers = []

    async def subscribe(self, websocket):
        self.subscribers.append(websocket)

    async def unsubscribe(self, websocket):
        if websocket in self.subscribers:
            self.subscribers.remove(websocket)

    async def broadcast(self, message: Dict):
        payload = json.dumps(message)
        print(f"Broadcasting to {len(self.subscribers)} subscribers: {message.get('type')}")
        for sub in self.subscribers:
            try:
                await sub.send_text(payload)
            except Exception as e:
                print(f"Broadcast error: {e}")
                pass

class MetricsTracker:
    def __init__(self):
        self.start_times = {}

    def start(self, key: str):
        self.start_times[key] = time.perf_counter()

    def end(self, key: str) -> float:
        if key in self.start_times:
            lat = (time.perf_counter() - self.start_times[key]) * 1000
            del self.start_times[key]
            return round(lat, 2)
        return 0.0
