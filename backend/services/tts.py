from pipecat.services.cartesia.tts import CartesiaHttpTTSService

def get_tts_service(api_key: str):
    return CartesiaHttpTTSService(
        api_key=api_key,
        voice_id="829ccd10-f8b3-43cd-b8a0-4aeaa81f3b30",
        model="sonic-2",
    )
