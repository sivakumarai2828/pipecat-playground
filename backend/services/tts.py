from pipecat.services.cartesia.tts import CartesiaTTSService

def get_tts_service(api_key: str):
    return CartesiaTTSService(
        api_key=api_key,
        voice_id="829ccd10-f8b3-43cd-b8a0-4aeaa81f3b30",
        model="sonic-english",
        sample_rate=16000,
    )
