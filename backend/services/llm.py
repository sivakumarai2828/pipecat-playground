from pipecat.services.openai.llm import OpenAILLMService

def get_llm_service(api_key: str):
    return OpenAILLMService(
        api_key=api_key,
        model="gpt-4o-mini",
    )
