import os
import asyncio
from dotenv import load_dotenv
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.frames.frames import TextFrame, AudioRawFrame

load_dotenv()

async def test_tts():
    api_key = os.getenv("CARTESIA_API_KEY")
    voice_id = "829ccd10-f8b3-43cd-b8a0-4aeaa81f3b30"
    model = "sonic-2"
    
    print(f"Testing TTS with voice_id: {voice_id}, model: {model}")
    
    tts = CartesiaTTSService(
        api_key=api_key,
        voice_id=voice_id,
        model=model,
    )
    
    async def frame_handler(frame):
        if isinstance(frame, AudioRawFrame):
            print(f"Received audio frame: {len(frame.audio)} bytes")
        else:
            print(f"Received frame: {type(frame)}")

    # We need to set a push_frame handler
    tts.push_frame = frame_handler
    
    await tts.process_frame(TextFrame("Hello, I am testing the text to speech service."))
    print("Done processing frame.")

if __name__ == "__main__":
    asyncio.run(test_tts())
