from pipecat.services.speechmatics.stt import (
    SpeechmaticsSTTService,
    TurnDetectionMode
)

def get_stt_service(api_key: str, diarization: bool = False):
    return SpeechmaticsSTTService(
        api_key=api_key,
        params=SpeechmaticsSTTService.InputParams(
            turn_detection_mode=TurnDetectionMode.ADAPTIVE,
            enable_speaker_diarization=diarization,
        )
    )
