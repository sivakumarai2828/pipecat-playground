export interface Transcript {
    role: 'user' | 'assistant';
    text: string;
    timestamp: string;
}

export interface Metric {
    llm_ms?: number;
    stt_ms?: number;
    tts_ms?: number;
    timestamp: string;
}

export interface EventLog {
    type: string;
    message: string;
    timestamp: string;
}
