import React, { useState, useEffect, useRef } from 'react';
import DailyIframe, { type DailyCall } from '@daily-co/daily-js';
import {
    Mic, Settings, Play, Square,
    MessageSquare, BarChart3, List, Shield,
    Cpu, Activity, Radio, Volume2, Video,
    ExternalLink, RefreshCw, Zap, PanelRight, X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { cn } from './utils/cn';
import type { Transcript, Metric, EventLog } from './types';

const ROLE_PRESETS = {
    rag_assistant: [
        "You are Aria, a friendly and professional Voice AI Insurance Assistant powered by a Pipecat RAG pipeline.",
        "You work for MyInsurance and help customers 24/7 with questions about their auto, health, home, and life insurance policies.",
        "",
        "PERSONALITY: Warm, calm, and reassuring. Insurance can be stressful — make customers feel at ease.",
        "",
        "RULES:",
        "1. ALWAYS call 'search_knowledge_base' FIRST before answering any policy, coverage, claims, or billing question. Never guess policy details.",
        "2. After retrieving context, give a concise 2-3 sentence spoken answer. The full details appear in the side panel — tell the customer 'I've pulled up the full details on your screen'.",
        "3. For claims, always emphasize the most important first step verbally, then say details are on screen.",
        "4. If asked about cost or technology, you can mention this is powered by a Pipecat voice pipeline that's more cost-efficient than traditional call center AI.",
        "5. BE CONCISE verbally — you are a voice assistant. The side panel shows full details.",
        "6. Start the conversation by saying: 'Hi, I'm Aria, your MyInsurance voice assistant. How can I help you today?'",
        "7. You will receive transcripts with speaker tags like 'Speaker S1:'; understand them but NEVER repeat them.",
    ].join("\n"),
    demo: [
        "You are Aria, an interactive AI voice demo guide for Pipecat Playground.",
        "",
        "CRITICAL VOICE RULES — READ FIRST:",
        "- You are a VOICE agent. Your spoken words are converted to audio.",
        "- NEVER speak markdown, code blocks, bullet points, tables, or headers.",
        "- NEVER speak backticks, hashtags, asterisks, or any formatting symbols.",
        "- Your spoken words must be plain conversational English only.",
        "- ALL structured content (tables, lists, code) goes ONLY into show_text_on_screen tool — never in your speech.",
        "",
        "ON START: Say this exact plain sentence:",
        "Hi, I am Aria, your interactive demo guide for Pipecat Playground. I can show you how this voice AI platform works. What would you like to explore — the pipeline architecture, a live knowledge search, building an app with voice, or something else?",
        "",
        "WHEN USER ASKS FOR INTRODUCTION OR HOW IT WORKS:",
        "Step 1: Call show_text_on_screen with this markdown text:",
        "## How Pipecat Works\n\nMicrophone → STT → LLM → TTS → Speaker\n\n| Stage | Service |\n|-------|---------|\n| Speech Recognition | Speechmatics |\n| Language Model | GPT-4o |\n| Voice Synthesis | Cartesia Sonic-2 |\n\nEach component is independently swappable.",
        "Step 2: Say (plain words only): Pipecat chains three services — speech recognition, a language model, and voice synthesis. Each stage is independently swappable, so you can mix any provider without rewriting your app.",
        "",
        "WHEN USER ASKS ABOUT INSURANCE OR KNOWLEDGE SEARCH:",
        "Step 1: Call search_knowledge_base with a relevant query.",
        "Step 2: Say (plain words only): I just searched the knowledge base and retrieved grounded answers. The full results are on your screen.",
        "",
        "WHEN USER ASKS TO BUILD AN APP OR SEE UI GENERATION:",
        "Step 1: Call show_text_on_screen with: Building an insurance premium calculator — this will take about 15 seconds.",
        "Step 2: Say (plain words only): I will now build a live interactive insurance calculator from a voice command. Watch the panel on the right.",
        "Step 3: Call generate_ui_component with prompt: A beautiful insurance premium calculator. Inputs: Age number, Vehicle Type dropdown Compact SUV Truck Luxury, Coverage Level dropdown Basic Silver Gold Platinum. Calculate and display monthly and annual premium estimates. Dark theme with blue and cyan accents, smooth animations.",
        "",
        "WHEN USER ASKS TO SEARCH THE WEB OR CONTROL BROWSER:",
        "Step 1: Call show_text_on_screen with: Opening browser and searching Google for Pipecat voice AI.",
        "Step 2: Say (plain words only): I will now control a real browser window and search the web for you.",
        "Step 3: Call control_browser with command: go to google.com and search for Pipecat voice AI framework",
        "",
        "WHEN USER ASKS ABOUT COST:",
        "Step 1: Call show_text_on_screen with: ## Cost Comparison\n\n| Stack | Cost per 1M tokens |\n|-------|-------------------|\n| Pipecat STT+LLM+TTS | ~$3 to $5 |\n| Audio-native APIs | $100 to $200 |\n\nResult: 40 to 80 times cheaper by processing text instead of raw audio.",
        "Step 2: Say (plain words only): By using a text language model instead of audio processing, Pipecat costs 40 to 80 times less than audio-native APIs. The cost breakdown is now on your screen.",
        "",
        "AFTER EACH DEMO: Ask in plain words — What else would you like to see?",
    ].join("\n"),
    qa_demo: [
        "You are Aria, a voice AI insurance assistant. Your job is to demonstrate live Q&A.",
        "When triggered automatically, ask the user ONE question to start:",
        "\"Hi! I'm Aria. Ask me anything about your insurance — coverage, deductibles, claims, or pricing. What would you like to know?\"",
        "Then wait. When the user responds, ALWAYS call search_knowledge_base first to get the answer, then:",
        "1. Call show_text_on_screen with a clear markdown summary of the answer",
        "2. Speak a 2-sentence verbal answer",
        "3. Ask one follow-up question to keep the demo going",
        "NEVER guess. ALWAYS search first. Keep voice responses to 2 sentences max.",
    ].join("\n"),
    support: "You are a helpful customer support agent for a tech company. Be polite, professional, and focus on solving issues. BE EXTREMELY CONCISE. Provide summaries and one-line answers when possible. You will receive transcripts with speaker tags like 'Speaker S1:'; understand them but NEVER repeat them.",
    travel: "You are a knowledgeable travel guide. Suggest destinations and fun facts. BE EXTREMELY CONCISE and provide quick summaries. Avoid long paragraphs. Maintain an adventurous but brief tone.",
    storyteller: "You are a master storyteller. Weave captivating but BRIEF tales. Use descriptive language but keep total response length short (max 3-4 sentences).",
    interviewer: "You are a technical interviewer. Ask challenging but fair questions. BE EXTREMELY CONCISE. Provide feedback in bullet points.",
    multilingual_support: [
        "You are a multilingual AI customer support agent for TechCorp.",
        "CRITICAL VOICE RULES:",
        "- NEVER speak markdown, bullet points, or tables aloud.",
        "- BE EXTREMELY CONCISE — 2-3 sentences max per response.",
        "- NEVER mention tool names to the user.",
        "",
        "LANGUAGE: Detect the customer's language from their first message and respond in that SAME language throughout.",
        "If they speak Spanish → respond in Spanish. French → French. English → English.",
        "",
        "DEPARTMENTS: You can transfer calls using the switch_voice tool:",
        "- tech_support — for device and software issues",
        "- billing — for invoices, payments, refunds",
        "- manager — for escalations and complaints",
        "- general_support — default / all other questions",
        "When transferring, call switch_voice FIRST, then tell the customer verbally.",
        "",
        "START: Say exactly this in English: 'Thank you for calling TechCorp support. How can I help you today? Feel free to speak in any language.'",
    ].join("\n"),
    model_showdown: [
        "You are a helpful AI assistant. Answer questions clearly and accurately.",
        "CRITICAL VOICE RULES:",
        "- NEVER speak markdown, bullet points, or code aloud.",
        "- BE CONCISE — 3-4 sentences max per response.",
        "- Speak in plain conversational English only.",
        "",
        "START: Say exactly this: 'Hi! I am running on GPT-4o. Ask me anything and I will answer — while a cost-optimized model also responds silently in the side panel so you can compare quality and cost in real time.'",
    ].join("\n"),
    showcase: [
        "You are Velix, a voice AI orchestrator running a fully autonomous showcase demo.",
        "You will receive exact script instructions. Follow them precisely — word for word.",
        "",
        "TOOL: trigger_agent2(capability, task_description) — fires Agent 2 silently. Results appear in side panel.",
        "",
        "STRICT RULES:",
        "- Say ONLY what the script tells you. Word for word. Nothing added.",
        "- Call trigger_agent2 exactly as instructed.",
        "- ONE sentence maximum per turn.",
        "- NEVER speak markdown, bullet points, code, or lists.",
        "- After calling trigger_agent2, STOP immediately — do not keep talking.",
    ].join("\n"),
    voice_demo: [
        "You are Velix, an AI voice demo orchestrator. You speak to users and coordinate with Nexa, a silent AI executor that handles tool tasks in real time.",
        "",
        "TOOL:",
        "- trigger_agent2(capability, task_description): Fires Agent 2 silently. Results appear in the side panel.",
        "",
        "CAPABILITIES you can trigger:",
        "- web_search — search the internet for current info",
        "- task_organizer — add, list, or complete tasks",
        "- knowledge_base — search insurance documents",
        "- ui_builder — build interactive HTML apps",
        "",
        "WORKFLOW: User requests something → call trigger_agent2 → say one short sentence telling user to watch the side panel → done.",
        "",
        "VOICE RULES:",
        "- ONE sentence per response, maximum",
        "- NEVER speak markdown, bullet points, code, or lists aloud",
        "- NEVER mention tool names to the user",
        "- After triggering Agent 2, say only: 'Watch the panel on the right.' Then stop.",
        "",
        "START: Say exactly this one sentence and nothing more: 'Hi, I'm Velix — your AI demo orchestrator, paired with Nexa, a silent executor agent that shows results in the side panel.'",
    ].join("\n"),
    custom: ""
};

const App: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'conversation' | 'metrics'>('conversation');
    const [status, setStatus] = useState({ client: 'IDLE', agent: 'IDLE' });
    const [transcripts, setTranscripts] = useState<Transcript[]>([]);
    const [metrics, setMetrics] = useState<Metric[]>([]);
    const [logs, setLogs] = useState<EventLog[]>([]);
    const [isConnecting, setIsConnecting] = useState(false);
    const [callObject, setCallObject] = useState<DailyCall | null>(null);
    const [customRoomUrl, setCustomRoomUrl] = useState('');
    const [selectedRole, setSelectedRole] = useState<keyof typeof ROLE_PRESETS>('support');
    const [customPrompt, setCustomPrompt] = useState('');
    const [errorDialog, setErrorDialog] = useState<{ title: string, message: string } | null>(null);
    const [userAudioLevel, setUserAudioLevel] = useState(0);
    const [botAudioLevel, setBotAudioLevel] = useState(0);
    const [costData, setCostData] = useState<{
        your_stack: { stt: number; llm: number; tts: number; embed: number; total: number };
        realtime_api: { total: number };
        savings_pct: number;
        total_saved: number;
        projected_hourly: { your: number; realtime: number };
        stats: { stt_seconds: number; llm_input_tokens: number; llm_output_tokens: number; tts_chars: number };
    } | null>(null);
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
    const [isMuted, setIsMuted] = useState(false);
    const [dynamicPanel, setDynamicPanel] = useState<{
        isOpen: boolean;
        name: string;
        content: string;
        status: 'idle' | 'thinking' | 'running' | 'complete' | 'error';
        prompt: string;
        progress: number;
        eta: number;
        message: string;
        screenshot_b64?: string;
        url?: string;
    }>({ isOpen: false, name: '', content: '', status: 'idle', prompt: '', progress: 0, eta: 0, message: '' });

    const ws = useRef<WebSocket | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const botStreamRef = useRef<MediaStream | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const logsEndRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        // Only run on mount
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = import.meta.env.VITE_BACKEND_HOST || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:7860' : window.location.host);
        const socket = new WebSocket(`${protocol}//${host}/ws/events`);
        ws.current = socket;

        socket.onopen = () => {
            console.log('WebSocket Connected');
            setLogs(prev => [...prev, { message: 'WebSocket Connected', type: 'info', timestamp: new Date().toLocaleTimeString() }]);
        };

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleBackendEvent(data);
        };

        socket.onerror = (err) => {
            console.error('WebSocket Error:', err);
        };

        socket.onclose = () => {
            console.log('WebSocket Closed');
        };

        return () => {
            socket.close();
            ws.current = null;
        };
    }, []);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [transcripts]);

    const handleBackendEvent = (data: any) => {
        const timestamp = new Date().toLocaleTimeString();
        if (import.meta.env.DEV) {
            console.log('BACKEND EVENT:', data);
        }

        if (data.type === 'transcript') {
            setTranscripts(prev => [...prev, { role: data.role, text: data.text, timestamp }]);
        } else if (data.type === 'tool_call') {
            // Handle tool calls for UI updates
            setDynamicPanel(prev => ({
                ...prev,
                isOpen: true,
                name: data.name,
                status: data.status || 'running',
                content: data.content || prev.content,
                prompt: data.prompt || prev.prompt,
                progress: data.progress || 0,
                eta: data.eta || 0,
                message: data.message || '',
                screenshot_b64: data.screenshot_b64 || prev.screenshot_b64,
                url: data.url || prev.url,
            }));
            setLogs(prev => [...prev, {
                message: `Tool executing: ${data.name} ${data.status ? `(${data.status})` : ''}`,
                type: 'info',
                timestamp
            }]);
        } else if (data.type === 'transcript_partial') {
            // Agent text arrive as chunks/tokens
            if (data.role === 'assistant') {
                setTranscripts(prev => {
                    // Check if the last transcript is the same speaker
                    const last = prev[prev.length - 1];
                    if (last && last.role === 'assistant') {
                        // Append to existing
                        const updated = [...prev];
                        updated[updated.length - 1] = {
                            ...last,
                            text: last.text + data.text
                        };
                        return updated;
                    } else {
                        // Create new
                        return [...prev, { ...data, type: 'transcript', timestamp }];
                    }
                });
            }
        } else if (data.type === 'metrics') {
            setMetrics(prev => [...prev, { ...data, timestamp }]);
        } else if (data.type === 'cost_update') {
            setCostData(data);
        } else if (data.type === 'log') {
            setLogs(prev => [...prev, { message: data.message, type: 'info', timestamp }]);
        } else if (data.type === 'translation_pair') {
            setDynamicPanel(prev => {
                const existingTable = prev.name === 'translation_log' ? prev.content : '## Live Translation Log\n\n| Customer | Agent |\n|---|---|';
                return {
                    ...prev,
                    isOpen: true,
                    name: 'translation_log',
                    status: 'complete',
                    content: existingTable + `\n| ${data.source} | ${data.translation} |`,
                    progress: 100,
                    eta: 0,
                    message: '',
                };
            });
        } else if (data.type === 'agent2_transcript') {
            setTranscripts(prev => [...prev, { role: 'agent2', text: data.text, timestamp }]);
        } else if (data.type === 'agent2_activity') {
            setLogs(prev => [...prev, {
                message: `[Agent 2] ${data.message || data.status}`,
                type: data.status === 'error' ? 'error' : 'info',
                timestamp
            }]);
        } else if (data.type === 'shadow_response') {
            if (data.status === 'started') {
                setDynamicPanel(prev => ({
                    ...prev,
                    isOpen: true,
                    name: 'shadow_llm',
                    status: 'complete',
                    content: '',
                    prompt: '',
                    progress: 100,
                    eta: 0,
                    message: '',
                }));
            } else if (data.status === 'streaming') {
                setDynamicPanel(prev => prev.name === 'shadow_llm'
                    ? { ...prev, content: prev.content + data.text }
                    : prev
                );
            }
        }
    };

    const connect = async () => {
        setIsConnecting(true);
        setStatus({ client: 'CONNECTING', agent: 'CONNECTING' });
        setErrorDialog(null);
        // No pre-warming needed — muted autoplay handles HTTPS restriction

        // Ensure WebSocket is connected
        if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
            // This should ideally not happen if the useEffect on mount is reliable,
            // but as a fallback, we could try to re-initialize or wait.
            // For now, we'll assume the useEffect handles initial connection.
            console.warn("WebSocket not open, proceeding anyway. Initial connection should be handled by useEffect.");
        }

        try {
            let room_url = customRoomUrl.trim();

            if (!room_url) {
                const host = import.meta.env.VITE_BACKEND_HOST || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:7860' : window.location.host);
                const resp = await fetch(`http${window.location.protocol === 'https:' ? 's' : ''}://${host}/session/create`, { method: 'POST' });
                const data = await resp.json();
                room_url = data.room_url;
            }

            const co = DailyIframe.createCallObject({
                audioSource: true,
                videoSource: false,
            });

            setCallObject(co);

            // Handle meeting errors
            co.on('error', (evt) => {
                console.error('Daily Error:', evt);
                if (evt.errorMsg === 'account-missing-payment-method') {
                    setErrorDialog({
                        title: 'Daily Billing Restriction',
                        message: 'Your Daily account requires a payment method or has a billing restriction. Workaround: Create a room manually in your Daily Dashboard and paste the URL above.'
                    });
                } else {
                    setErrorDialog({
                        title: 'Connection Error',
                        message: evt.errorMsg || 'An unknown error occurred while joining the room.'
                    });
                }
                setStatus({ client: 'ERROR', agent: 'ERROR' });
            });

            await co.join({ url: room_url });

            // Check if agent is already there
            const participants = co.participants();
            console.log('Current participants:', participants);
            Object.values(participants).forEach(p => {
                if (p.user_name === 'Pipecat Agent') {
                    console.log('Found Pipecat Agent on join');
                    setStatus(prev => ({ ...prev, agent: 'READY' }));
                }
            });

            // Explicitly enable local audio to ensure microphone is active
            await co.setLocalAudio(true);

            setStatus(prev => ({ ...prev, client: 'READY' }));

            // Listen for audio levels
            co.on('local-audio-level', (evt: any) => {
                setUserAudioLevel(evt.audioLevel);
            });

            let audioAttached = false;

            const attachTrackDirectly = (track: MediaStreamTrack) => {
                if (audioAttached || !audioRef.current) return;
                audioAttached = true;
                const el = audioRef.current;
                el.srcObject = new MediaStream([track]);
                el.muted = true;
                el.play().then(() => { el.muted = false; }).catch(() => {});
                setLogs(prev => [...prev, { message: 'Bot audio attached (muted→unmuted)', type: 'info', timestamp: new Date().toLocaleTimeString() }]);
            };

            co.on('remote-participants-audio-level', (evt: any) => {
                const levels = evt.participantsAudioLevel;
                const maxLevel = Math.max(...Object.values(levels) as number[], 0);
                setBotAudioLevel(maxLevel);
                if (!audioAttached && maxLevel > 0) {
                    const allParticipants = co.participants();
                    Object.values(allParticipants).forEach((p: any) => {
                        if (!p.local && !audioAttached) {
                            const track = p.tracks?.audio?.persistentTrack ?? p.tracks?.audio?.track;
                            if (track) attachTrackDirectly(track);
                        }
                    });
                }
            });

            co.on('track-started', (evt) => {
                const participant = evt.participant;
                if (!participant || participant.local) return;
                if (evt.track?.kind === 'audio') attachTrackDirectly(evt.track);
            });

            co.on('track-stopped', (evt) => {
                if (evt.track?.kind === 'audio') {
                    if (botStreamRef.current) {
                        botStreamRef.current.getTracks().forEach(t => botStreamRef.current!.removeTrack(t));
                    }
                    audioAttached = false;
                }
            });

            co.on('participant-updated', (evt) => {
                const participant = evt.participant;
                if (!participant || participant.local || audioAttached) return;
                const track = participant?.tracks?.audio?.persistentTrack ?? participant?.tracks?.audio?.track;
                if (track && participant?.tracks?.audio?.state === 'playable') attachTrackDirectly(track);
            });

            co.on('participant-joined', (evt) => {
                const p = evt.participant;
                setStatus(prev => ({ ...prev, agent: 'READY' }));
                if (p.local) return;
                setLogs(prev => [...prev, { message: `Agent joined: ${p.user_name ?? 'Pipecat Agent'}`, type: 'info', timestamp: new Date().toLocaleTimeString() }]);
                // Poll until audio track is live — Daily state may stay 'loading' on HTTPS
                let attempts = 0;
                const poll = setInterval(() => {
                    attempts++;
                    const remote: any = Object.values(co.participants()).find((rp: any) => !rp.local);
                    const track = remote?.tracks?.audio?.persistentTrack ?? remote?.tracks?.audio?.track;
                    if (track && track.readyState === 'live') {
                        clearInterval(poll);
                        attachTrackDirectly(track);
                    }
                    if (attempts >= 20 || audioAttached) clearInterval(poll);
                }, 500);
            });

            await co.startLocalAudioLevelObserver();
            await co.startRemoteParticipantsAudioLevelObserver();

            setLogs(prev => [...prev, { message: 'Joined Daily Room', type: 'info', timestamp: new Date().toLocaleTimeString() }]);

            const base_prompt = selectedRole === 'custom' ? customPrompt : ROLE_PRESETS[selectedRole as keyof typeof ROLE_PRESETS];
            const is_demo = selectedRole === 'demo';
            const system_prompt = is_demo ? base_prompt : [
                base_prompt,
                "### RULES:",
                "- BE EXTREMELY CONCISE verbally. 2-3 sentences max per response.",
                "- NEVER speak markdown, code, tables, or bullet points aloud.",
                "- For lists or structured data: call show_text_on_screen FIRST, then give a 1-sentence verbal summary.",
                "- For interactive apps: call generate_ui_component FIRST.",
                "- NEVER mention tool names to the user.",
            ].join("\n");

            const host = import.meta.env.VITE_BACKEND_HOST || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:7860' : window.location.host);
            await fetch(`http${window.location.protocol === 'https:' ? 's' : ''}://${host}/agent/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room_url, system_prompt, role: selectedRole, auto_start: selectedRole === 'demo' || selectedRole === 'qa_demo' || selectedRole === 'voice_demo' || selectedRole === 'showcase' })
            });
        } catch (err: any) {
            console.error(err);
            setErrorDialog({
                title: 'System Error',
                message: err.message || 'Failed to initialize the session.'
            });
            setStatus({ client: 'ERROR', agent: 'ERROR' });
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnect = async () => {
        if (callObject) {
            await callObject.leave();
            setCallObject(null);
        }
        setStatus({ client: 'IDLE', agent: 'IDLE' });
        setIsMuted(false);
    };

    const toggleMute = async () => {
        if (!callObject) return;
        const next = !isMuted;
        await callObject.setLocalAudio(!next);
        setIsMuted(next);
    };

    return (
        <div className="flex flex-col h-screen bg-background dot-pattern selection:bg-primary/20 text-slate-900">
            {/* Error Overlay */}
            {errorDialog && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-red-100 transform animate-in slide-in-from-bottom-4 duration-500">
                        <div className="flex items-center gap-4 mb-6 text-red-600">
                            <div className="p-3 bg-red-50 rounded-2xl border border-red-100">
                                <Zap className="w-6 h-6" />
                            </div>
                            <h2 className="text-xl font-black tracking-tight">{errorDialog.title}</h2>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed font-medium mb-8">
                            {errorDialog.message}
                        </p>
                        <button
                            onClick={() => setErrorDialog(null)}
                            className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-sm hover:bg-slate-800 transition-colors shadow-lg"
                        >
                            Dismiss and Reconfigure
                        </button>
                    </div>
                </div>
            )}

            {/* Header */}
            <header className="flex items-center justify-between px-8 py-5 border-b border-slate-200 glass z-50">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-br from-primary to-secondary rounded-xl shadow-lg shadow-primary/20">
                        <Radio className="w-6 h-6 text-white animate-pulse" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight text-gradient">
                            Pipecat <span className="text-slate-900">Playground</span>
                        </h1>
                        <p className="text-[10px] text-slate-400 font-mono tracking-widest mt-0.5 uppercase">
                            Low Latency AI Orchestration v0.101
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="hidden md:flex items-center gap-4 text-xs font-semibold text-slate-500 mr-2">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-100">
                            <Zap className="w-3.5 h-3.5 text-secondary" />
                            <span>120ms Dynamic Latency</span>
                        </div>
                    </div>

                    {status.client === 'READY' && (
                        <button
                            onClick={toggleMute}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 rounded-full font-bold text-sm transition-all duration-200 border",
                                isMuted
                                    ? "bg-red-600 text-white border-red-700 shadow-lg shadow-red-500/30 animate-pulse"
                                    : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                            )}
                            title={isMuted ? "Unmute microphone" : "Mute microphone"}
                        >
                            <Mic className={cn("w-4 h-4", isMuted && "line-through")} />
                            {isMuted ? "Unmute" : "Mute Mic"}
                        </button>
                    )}
                    <button
                        onClick={status.client === 'READY' ? disconnect : connect}
                        disabled={isConnecting}
                        className={cn(
                            "group relative flex items-center gap-2 px-6 py-2.5 rounded-full font-bold transition-all duration-300 transform active:scale-95 shadow-lg shadow-primary/10",
                            status.client === 'READY'
                                ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                                : "bg-primary text-white hover:shadow-primary/30 hover:-translate-y-0.5"
                        )}
                    >
                        {status.client === 'READY' ? (
                            <><Square className="w-4 h-4 fill-current" /> Terminate Session</>
                        ) : (
                            <>
                                {isConnecting ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Play className="w-4 h-4 fill-current" />
                                )}
                                {isConnecting ? 'Initializing Engine...' : 'Launch Agent'}
                            </>
                        )}
                    </button>

                    <button className="p-2.5 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors">
                        <Settings className="w-5 h-5" />
                    </button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar */}
                <aside className="w-80 flex flex-col p-6 gap-8 bg-slate-50/50 backdrop-blur-md overflow-y-auto border-r border-slate-200">
                    <section>
                        <h3 className="text-xs font-black text-slate-400 mb-4 flex items-center gap-2 uppercase tracking-tighter">
                            <Volume2 className="w-3.5 h-3.5" /> Bot Audio Stream
                        </h3>
                        <div className="bg-white rounded-2xl p-6 h-36 flex items-center justify-center relative overflow-hidden shadow-sm border border-slate-100 shimmer">
                            <div className="flex items-end gap-1.5 h-16 w-full justify-between px-2">
                                {[...Array(16)].map((_, i) => {
                                    // Add some variation per bar based on the same level
                                    const variation = 0.5 + Math.sin(i * 0.5) * 0.5;
                                    const height = status.agent === 'READY'
                                        ? 10 + (botAudioLevel * 90 * variation)
                                        : 10;
                                    return (
                                        <div
                                            key={i}
                                            className={cn(
                                                "w-2 bg-gradient-to-t from-primary/80 to-secondary/80 rounded-full transition-all duration-75",
                                                status.agent === 'READY' ? "opacity-100" : "opacity-10 translate-y-2"
                                            )}
                                            style={{ height: `${height}%` }}
                                        />
                                    );
                                })}
                            </div>
                            {status.agent !== 'READY' && (
                                <div className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-400 font-black bg-white/60 backdrop-blur-[1px]">
                                    AWAITING PIPELINE SIGNAL
                                </div>
                            )}
                        </div>
                    </section>

                    <section>
                        <h3 className="text-xs font-black text-slate-400 mb-4 flex items-center gap-2 uppercase tracking-tighter">
                            <Video className="w-3.5 h-3.5" /> Neural Visualizer
                        </h3>
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 aspect-video relative flex items-center justify-center bg-gradient-to-br from-slate-50 to-transparent group overflow-hidden">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_var(--color-primary),transparent_70%)] opacity-5 group-hover:opacity-10 transition-opacity" />
                            <Cpu className="w-16 h-16 text-primary/40 animate-[pulse_3s_infinite]" />
                            <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2 py-1 rounded bg-slate-100 text-[9px] font-mono text-slate-500 border border-slate-200">
                                <Activity className="w-2.5 h-2.5 text-secondary" />
                                PRO-STREAM-AV.1
                            </div>
                        </div>
                    </section>

                    <div className="mt-auto pt-6 border-t border-slate-200/60 space-y-4">
                        <div className="flex items-center justify-between text-[11px] font-bold">
                            <span className="text-slate-400">Pipeline Engine</span>
                            <span className="text-primary flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
                                Pipecat AI Core
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-bold">
                            <span className="text-slate-400">RTC Gateway</span>
                            <span className="text-slate-600">Daily WebRTC</span>
                        </div>
                    </div>
                </aside>

                {/* Main Content Area */}
                <main className="flex-1 flex flex-col bg-slate-50/30">
                    <div className="flex px-10 pt-6 border-b border-slate-200 gap-8 bg-white/50">
                        <button
                            onClick={() => setActiveTab('conversation')}
                            className={cn(
                                "pb-4 text-sm font-black transition-all relative flex items-center gap-2.5",
                                activeTab === 'conversation' ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
                            )}
                        >
                            <MessageSquare className={cn("w-4 h-4", activeTab === 'conversation' && "text-primary")} />
                            Live Transcription
                            {activeTab === 'conversation' && (
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t-full shadow-[0_-4px_12px_rgba(37,99,235,0.2)]" />
                            )}
                        </button>
                        <button
                            onClick={() => setActiveTab('metrics')}
                            className={cn(
                                "pb-4 text-sm font-black transition-all relative flex items-center gap-2.5",
                                activeTab === 'metrics' ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
                            )}
                        >
                            <BarChart3 className={cn("w-4 h-4", activeTab === 'metrics' && "text-secondary")} />
                            System Performance
                            {activeTab === 'metrics' && (
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-secondary rounded-t-full shadow-[0_-4px_12px_rgba(8,145,178,0.2)]" />
                            )}
                        </button>
                    </div>

                    <div
                        ref={scrollRef}
                        className="flex-1 overflow-y-auto p-10 scrollbar-hide"
                    >
                        {activeTab === 'conversation' ? (
                            <div className="space-y-8 max-w-4xl mx-auto pb-10">
                                {transcripts.length === 0 && (
                                    status.client === 'IDLE' ? (
                                        <div className="py-6">
                                            {/* Hero */}
                                            <div className="text-center mb-10">
                                                <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/5 border border-primary/10 rounded-full text-[10px] font-black text-primary uppercase tracking-widest mb-6">
                                                    <Zap className="w-3 h-3" /> Open Source · Multi-Agent · Cost-Optimized
                                                </div>
                                                <h1 className="text-4xl font-black text-slate-900 leading-tight mb-4">
                                                    Voice AI That Actually<br />
                                                    <span className="text-gradient">Makes Economic Sense</span>
                                                </h1>
                                                <p className="text-slate-500 text-[15px] font-semibold max-w-xl mx-auto leading-relaxed">
                                                    Audio-native APIs cost $100–200 per million tokens. Pipecat routes speech through text — cutting costs by <strong className="text-slate-700">40–80×</strong> while keeping full control over every pipeline stage.
                                                </p>
                                            </div>

                                            {/* Problem / Solution */}
                                            <div className="grid grid-cols-2 gap-4 mb-8">
                                                <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
                                                    <p className="text-[9px] font-black text-red-500 uppercase tracking-widest mb-2">The Problem</p>
                                                    <p className="text-slate-700 font-semibold text-[13px] leading-relaxed">Audio-native APIs process raw waveforms end-to-end. You pay for every millisecond of audio and can't swap any component.</p>
                                                </div>
                                                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5">
                                                    <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-2">The Pipecat Way</p>
                                                    <p className="text-slate-700 font-semibold text-[13px] leading-relaxed">STT → text LLM → TTS. Each stage is independently swappable. Pay only for what you use. 40–80× cheaper.</p>
                                                </div>
                                            </div>

                                            {/* What this demo shows */}
                                            <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-8 shadow-sm">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-5">What This Playground Demonstrates</p>
                                                <div className="grid grid-cols-3 gap-4">
                                                    {[
                                                        { icon: '🤖', title: 'Two-Agent Conversation', desc: 'Velix (host) and Nexa (executor) talk to each other with distinct voices — zero human input needed' },
                                                        { icon: '🔧', title: 'Live Tool Execution', desc: 'Real-time web search, task management, knowledge retrieval, and interactive UI generation' },
                                                        { icon: '💰', title: 'Real Cost Comparison', desc: 'Live meter shows Pipecat cost vs audio-native API estimate — in actual dollars per session' },
                                                    ].map(({ icon, title, desc }) => (
                                                        <div key={title} className="text-center p-4 rounded-xl bg-slate-50 border border-slate-100 hover:border-primary/20 transition-colors">
                                                            <div className="text-3xl mb-3">{icon}</div>
                                                            <p className="text-[11px] font-black text-slate-700 mb-2">{title}</p>
                                                            <p className="text-[10px] text-slate-500 leading-relaxed">{desc}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Pipeline visualization */}
                                            <div className="flex items-center justify-center gap-3 mb-6">
                                                {[
                                                    { color: 'bg-primary', label: 'Speechmatics STT', sub: 'Speech → Text' },
                                                    { color: 'bg-secondary', label: 'GPT-4o LLM', sub: 'Text → Reasoning' },
                                                    { color: 'bg-violet-500', label: 'Cartesia TTS', sub: 'Text → Voice' },
                                                ].map(({ color, label, sub }, i) => (
                                                    <React.Fragment key={label}>
                                                        <div className="text-center">
                                                            <div className={`w-3 h-3 rounded-full ${color} mx-auto mb-1.5`} />
                                                            <p className="text-[10px] font-black text-slate-700">{label}</p>
                                                            <p className="text-[9px] text-slate-400">{sub}</p>
                                                        </div>
                                                        {i < 2 && <div className="text-slate-300 font-black text-lg">→</div>}
                                                    </React.Fragment>
                                                ))}
                                            </div>

                                            {/* CTA */}
                                            <div className="text-center p-5 bg-primary/5 rounded-2xl border border-primary/10">
                                                <p className="text-[11px] text-slate-600 font-bold">
                                                    Select <strong className="text-primary">🎬 Autonomous Showcase</strong> in the sidebar → click <strong className="text-primary">Launch Agent</strong>
                                                </p>
                                                <p className="text-[10px] text-slate-400 mt-1">Two AI agents will have a full conversation with no human input — watch the side panel fill with live results</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-32 text-slate-300">
                                            <div className="w-16 h-16 rounded-3xl bg-slate-100 flex items-center justify-center mb-6 border border-slate-200/50">
                                                <Activity className="w-8 h-8 opacity-40 animate-pulse text-slate-400" />
                                            </div>
                                            <p className="text-lg font-bold tracking-tight text-slate-400">Pipeline active. Waiting for first voice...</p>
                                            <p className="text-[10px] font-black font-mono mt-2 uppercase tracking-widest opacity-60">Real-time STT Buffer Ready</p>
                                        </div>
                                    )
                                )}
                                {/* Showcase context banner — explains what's happening during the demo */}
                                {selectedRole === 'showcase' && status.client === 'READY' && transcripts.length > 0 && (
                                    <div className="mb-6 rounded-2xl bg-gradient-to-r from-primary/5 to-violet-50 border border-primary/15 p-5 animate-in fade-in duration-700">
                                        <div className="flex items-start gap-4">
                                            <div className="p-2.5 rounded-xl bg-white border border-primary/20 shadow-sm shrink-0">
                                                <Radio className="w-5 h-5 text-primary animate-pulse" />
                                            </div>
                                            <div>
                                                <p className="text-[11px] font-black text-primary uppercase tracking-widest mb-1">🎬 Autonomous Multi-Agent Showcase — Live</p>
                                                <p className="text-sm font-semibold text-slate-700 mb-2">
                                                    Two AI agents are having a real conversation with zero human input — showing why voice AI needs a smarter, cheaper architecture.
                                                </p>
                                                <div className="flex flex-wrap gap-3">
                                                    <span className="flex items-center gap-1.5 text-[10px] font-black text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                                                        <Cpu className="w-3 h-3" /> Velix — Orchestrator
                                                    </span>
                                                    <span className="flex items-center gap-1.5 text-[10px] font-black text-violet-700 bg-violet-100 px-2.5 py-1 rounded-full">
                                                        <Zap className="w-3 h-3" /> Nexa — Live Executor
                                                    </span>
                                                    <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                                                        <Activity className="w-3 h-3" /> Results → Right Panel
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-3 pt-3 border-t border-primary/10 grid grid-cols-3 gap-3 text-center">
                                            {[
                                                { label: 'Scenario 1', desc: 'Business Intelligence & Sprint Planning' },
                                                { label: 'Scenario 2', desc: 'Enterprise Insurance Customer Service' },
                                                { label: 'Why Pipecat', desc: '40–80× cheaper than audio-native APIs' },
                                            ].map(({ label, desc }) => (
                                                <div key={label} className="bg-white/60 rounded-xl px-2 py-2 border border-white">
                                                    <p className="text-[9px] font-black text-primary uppercase tracking-widest">{label}</p>
                                                    <p className="text-[10px] text-slate-600 font-semibold mt-0.5 leading-tight">{desc}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {transcripts.map((t, i) => (
                                    <div key={i} className={cn(
                                        "flex flex-col gap-2 group animate-in fade-in slide-in-from-bottom-2 duration-500",
                                        t.role === 'user' ? "items-end text-right" : "items-start"
                                    )}>
                                        <div className={cn(
                                            "flex items-center gap-3 text-[10px] font-black text-slate-400 uppercase tracking-widest px-2",
                                            t.role === 'user' && "flex-row-reverse"
                                        )}>
                                            {t.role === 'assistant' ? (
                                                <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                                                    <Cpu className="w-3 h-3 text-primary" />
                                                </div>
                                            ) : t.role === 'agent2' ? (
                                                <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center border border-violet-200">
                                                    <Zap className="w-3 h-3 text-violet-600" />
                                                </div>
                                            ) : (
                                                <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                                                    <div className="w-2 h-2 rounded-full bg-slate-400" />
                                                </div>
                                            )}
                                            <span className={cn(
                                                t.role === 'assistant' ? "text-primary"
                                                : t.role === 'agent2' ? "text-violet-600"
                                                : "text-slate-600"
                                            )}>
                                                {t.role === 'assistant' ? 'Velix' : t.role === 'agent2' ? 'Nexa' : 'You'}
                                            </span>
                                            <span className="opacity-0 group-hover:opacity-100 transition-opacity font-mono tracking-normal text-[9px]">
                                                {t.timestamp}
                                            </span>
                                        </div>
                                        <div className={cn(
                                            "px-6 py-4 rounded-[2rem] max-w-[85%] text-[15px] leading-relaxed relative transition-all",
                                            t.role === 'user'
                                                ? "bg-slate-900 text-white rounded-tr-none shadow-lg"
                                                : t.role === 'agent2'
                                                ? "bg-violet-50 border border-violet-200 shadow-sm text-violet-900 rounded-tl-none"
                                                : "bg-white border border-slate-200 shadow-sm text-slate-700 rounded-tl-none"
                                        )}>
                                            <div className="markdown-content whitespace-pre-wrap">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    rehypePlugins={[rehypeRaw]}
                                                    components={{
                                                        p: ({ node, ...props }) => <p className="mb-4 last:mb-0" {...props} />,
                                                        ul: ({ node, ...props }) => <ul className="list-disc pl-4 mb-2" {...props} />,
                                                        ol: ({ node, ...props }) => <ol className="list-decimal pl-4 mb-2" {...props} />,
                                                        li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                                                        code: ({ node, inline, ...props }: any) => (
                                                            <code className={cn("bg-slate-100 px-1 rounded text-[13px] font-mono", !inline && "block p-2 my-2")} {...props} />
                                                        )
                                                    }}
                                                >
                                                    {t.text}
                                                </ReactMarkdown>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto pb-10">
                                {metrics.map((m, i) => (
                                    <div key={i} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm group hover:translate-y-[-4px] hover:shadow-md transition-all duration-300">
                                        <div className="flex items-center justify-between mb-6">
                                            <span className="text-[10px] font-black text-slate-400 uppercase font-mono">Quantum Turn #{transcripts.length - metrics.length + i + 1}</span>
                                            <div className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded uppercase font-bold border border-slate-200">{m.timestamp}</div>
                                        </div>
                                        <div className="space-y-5">
                                            <div className="flex items-end justify-between">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">STT Engine</span>
                                                <span className="text-xl font-black text-primary tracking-tighter">{m.stt_ms || '—'}<span className="text-xs font-normal ml-1 text-slate-400">ms</span></span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-primary w-2/3 rounded-full" />
                                            </div>
                                            <div className="flex items-end justify-between">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">LLM Reasoning</span>
                                                <span className="text-xl font-black text-secondary tracking-tighter">{m.llm_ms || '—'}<span className="text-xs font-normal ml-1 text-slate-400">ms</span></span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-secondary w-full opacity-80 rounded-full" />
                                            </div>
                                            <div className="flex items-end justify-between">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TTS Synthesis</span>
                                                <span className="text-xl font-black text-accent tracking-tighter">{m.tts_ms || '—'}<span className="text-xs font-normal ml-1 text-slate-400">ms</span></span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {metrics.length === 0 && (
                                    <div className="col-span-full h-80 flex flex-col items-center justify-center bg-white rounded-3xl border-2 border-dashed border-slate-200 text-slate-300">
                                        <BarChart3 className="w-12 h-12 mb-4 opacity-50" />
                                        <p className="text-sm font-bold opacity-60">System metrics initializing...</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer / Console area */}
                    <div className="h-56 border-t border-slate-200 bg-white overflow-hidden flex flex-col shadow-[0_-4px_30px_rgba(0,0,0,0.03)]">
                        <div className="flex items-center justify-between px-8 py-3 bg-slate-50 border-b border-slate-200">
                            <div className="flex items-center gap-3 text-[11px] font-black text-slate-500 uppercase tracking-widest">
                                <List className="w-4 h-4 text-primary" /> Active Pipeline Logs
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="animate-pulse w-2 h-2 rounded-full bg-secondary" />
                                <span className="text-[10px] text-secondary font-black font-mono tracking-tighter">
                                    NODE_UP_STABLE
                                </span>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-8 py-4 font-mono text-[11px] space-y-2 scrollbar-hide text-slate-600">
                            {logs.map((log, i) => (
                                <div key={i} className="flex gap-4 group hover:bg-slate-50 rounded px-2 py-1 -mx-2 transition-colors">
                                    <span className="text-slate-400 font-bold">[{log.timestamp}]</span>
                                    <span className={cn(
                                        "font-black px-1.5 rounded uppercase text-[9px] border",
                                        log.type === 'error' ? "bg-red-50 text-red-600 border-red-200" : "bg-slate-100 text-primary border-slate-200"
                                    )}>{log.type}</span>
                                    <span className="leading-tight">{log.message}</span>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                </main>

                {/* Right Sidebar: Cost + AI Panel + Controls */}
                <aside className="w-[480px] border-l border-slate-200 flex flex-col bg-slate-50/50 backdrop-blur-md overflow-y-auto divide-y divide-slate-200">

                    {/* ── Live Cost Optimizer (only when data exists) ── */}
                    {costData && <section className="bg-white">
                        <div className="flex items-center justify-between px-5 pt-5 pb-3">
                            <div className="flex items-center gap-2">
                                <Zap className="w-4 h-4 text-emerald-500" />
                                <span className="text-xs font-black uppercase tracking-widest text-slate-700">Live Optimization</span>
                            </div>
                            <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                ACTIVE
                            </span>
                        </div>

                        <div className="px-5 pb-5 space-y-3">
                                {/* Hero savings */}
                                <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-4 text-white text-center shadow-lg shadow-emerald-500/20">
                                    <p className="text-[9px] font-black uppercase tracking-widest opacity-80 mb-1">Saved This Session</p>
                                    <p className="text-3xl font-black tabular-nums tracking-tight">${costData.total_saved.toFixed(5)}</p>
                                    <p className="text-[10px] font-bold opacity-80 mt-1">{costData.savings_pct}% cheaper than audio-native API</p>
                                </div>

                                {/* Cost bars */}
                                <div className="space-y-2">
                                    <div>
                                        <div className="flex justify-between text-[9px] font-black mb-1">
                                            <span className="text-primary">Pipecat Pipeline</span>
                                            <span className="text-primary tabular-nums">${costData.your_stack.total.toFixed(5)}</span>
                                        </div>
                                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-primary rounded-full transition-all duration-500"
                                                style={{ width: `${Math.max(2, (costData.your_stack.total / Math.max(costData.realtime_api.total, 0.000001)) * 100)}%` }} />
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[9px] font-black mb-1">
                                            <span className="text-red-400">Audio-Native API (est.)</span>
                                            <span className="text-red-400 tabular-nums">${costData.realtime_api.total.toFixed(5)}</span>
                                        </div>
                                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-red-400 rounded-full w-full" />
                                        </div>
                                    </div>
                                </div>

                                {/* Projected hourly */}
                                {costData.projected_hourly && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="rounded-xl bg-primary/5 border border-primary/10 p-2.5 text-center">
                                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Pipecat / hr</p>
                                            <p className="text-sm font-black text-primary tabular-nums">${costData.projected_hourly.your.toFixed(4)}</p>
                                        </div>
                                        <div className="rounded-xl bg-red-50 border border-red-100 p-2.5 text-center">
                                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Audio API / hr</p>
                                            <p className="text-sm font-black text-red-500 tabular-nums">${costData.projected_hourly.realtime.toFixed(4)}</p>
                                        </div>
                                    </div>
                                )}

                                {/* Pipeline breakdown — vendor-neutral */}
                                <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 space-y-1">
                                    <p className="text-[8px] font-black text-primary uppercase tracking-widest mb-2">Pipeline Breakdown</p>
                                    <div className="flex justify-between text-[10px] text-slate-600 font-bold">
                                        <span>STT Engine</span><span>${costData.your_stack.stt.toFixed(5)}</span>
                                    </div>
                                    <div className="flex justify-between text-[10px] text-slate-600 font-bold">
                                        <span>LLM (Text Model)</span><span>${costData.your_stack.llm.toFixed(5)}</span>
                                    </div>
                                    <div className="flex justify-between text-[10px] text-slate-600 font-bold">
                                        <span>TTS Engine</span><span>${costData.your_stack.tts.toFixed(5)}</span>
                                    </div>
                                </div>

                                {/* Stats row */}
                                <div className="flex gap-2 text-[9px] font-bold text-slate-400 flex-wrap">
                                    <span>{costData.stats.stt_seconds.toFixed(1)}s audio</span>
                                    <span>·</span>
                                    <span>{costData.stats.llm_input_tokens + costData.stats.llm_output_tokens} tokens</span>
                                    <span>·</span>
                                    <span>{costData.stats.tts_chars} chars</span>
                                </div>
                        </div>
                    </section>}

                    {/* ── AI Intelligence Display (inline — always visible alongside cost meter) ── */}
                    {dynamicPanel.isOpen && (
                        <div className="flex flex-col bg-white">
                            <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-100">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                                        <PanelRight className="w-3.5 h-3.5 text-primary" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-black text-slate-800 uppercase tracking-tight">AI Intelligence Display</p>
                                        <p className="text-[9px] font-bold text-slate-400 font-mono tracking-widest">{dynamicPanel.name}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setDynamicPanel(prev => ({ ...prev, isOpen: false }))}
                                    className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors text-slate-400"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="overflow-y-auto p-5" style={{ maxHeight: '560px' }}>
                                {dynamicPanel.status === 'thinking' || dynamicPanel.status === 'running' ? (
                                    <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-6">
                                        <div className="relative w-24 h-24 flex items-center justify-center">
                                            <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
                                            <div
                                                className="absolute inset-0 rounded-full border-4 border-primary transition-all duration-1000 ease-out"
                                                style={{
                                                    transform: `rotate(${dynamicPanel.progress * 3.6}deg)`,
                                                    borderTopColor: 'transparent',
                                                    borderRightColor: 'transparent',
                                                    borderBottomColor: 'transparent'
                                                }}
                                            />
                                            <div className="flex flex-col items-center">
                                                <span className="text-xl font-black text-slate-800">{dynamicPanel.progress}%</span>
                                                <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Progress</span>
                                            </div>
                                            <RefreshCw className="absolute -top-1 -right-1 w-5 h-5 animate-spin text-secondary opacity-50" />
                                        </div>
                                        <div className="w-full space-y-3 text-center">
                                            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-800 animate-pulse">
                                                {dynamicPanel.message || "Building..."}
                                            </p>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                                Estimated completion in {dynamicPanel.eta}s
                                            </p>
                                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-1000 ease-out"
                                                    style={{ width: `${dynamicPanel.progress}%` }}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 w-full">
                                            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Architecture</p>
                                                <div className={cn("h-1 rounded-full", dynamicPanel.progress > 20 ? "bg-secondary" : "bg-slate-200")} />
                                            </div>
                                            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Implementation</p>
                                                <div className={cn("h-1 rounded-full", dynamicPanel.progress > 60 ? "bg-secondary" : "bg-slate-200")} />
                                            </div>
                                        </div>
                                    </div>
                                ) : dynamicPanel.status === 'error' ? (
                                    <div className="flex flex-col items-center justify-center py-8 text-red-500 gap-3">
                                        <X className="w-10 h-10 p-2.5 bg-red-50 rounded-2xl" />
                                        <p className="text-sm font-black uppercase tracking-widest text-center">{dynamicPanel.message}</p>
                                    </div>
                                ) : (
                                    <div className="prose prose-slate max-w-none">
                                        {dynamicPanel.name === 'translation_log' ? (
                                            <div className="space-y-3">
                                                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
                                                    <span className="text-sm">🌐</span>
                                                    <span className="text-[11px] font-black text-blue-700 uppercase tracking-widest">Live Language Detection Active</span>
                                                </div>
                                                <div className="markdown-content">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                                        {dynamicPanel.content}
                                                    </ReactMarkdown>
                                                </div>
                                            </div>
                                        ) : dynamicPanel.name === 'shadow_llm' ? (
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between px-3 py-2 bg-amber-50 rounded-xl border border-amber-100">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm">⚡</span>
                                                        <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Cost-Optimized Draft</span>
                                                    </div>
                                                    <span className="text-[9px] font-bold text-amber-500 bg-amber-100 px-2 py-0.5 rounded-full">~20x cheaper</span>
                                                </div>
                                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-sm text-slate-700 leading-relaxed min-h-[60px] whitespace-pre-wrap">
                                                    {dynamicPanel.content || <span className="text-slate-400 italic">Waiting for response...</span>}
                                                </div>
                                                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-100">
                                                    <Cpu className="w-3 h-3 text-primary" />
                                                    <span className="text-[10px] font-bold text-slate-500">Primary agent speaking this answer aloud</span>
                                                </div>
                                            </div>
                                        ) : dynamicPanel.name === 'generate_ui_component' ? (
                                            <div className="w-full rounded-2xl border border-slate-200 overflow-auto bg-white shadow-inner" style={{ height: '560px' }}>
                                                {dynamicPanel.content ? (
                                                    <iframe
                                                        title="UI Sandbox"
                                                        srcDoc={dynamicPanel.content}
                                                        className="w-full border-none"
                                                        style={{ height: '100%', minHeight: '560px' }}
                                                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                                                    />
                                                ) : (
                                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">Generating UI...</div>
                                                )}
                                            </div>
                                        ) : dynamicPanel.name === 'control_browser' && dynamicPanel.screenshot_b64 ? (
                                            <div className="space-y-3">
                                                {dynamicPanel.url && (
                                                    <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-xl border border-slate-200 text-[11px] font-mono text-slate-500 truncate">
                                                        <ExternalLink className="w-3 h-3 shrink-0 text-primary" />
                                                        {dynamicPanel.url}
                                                    </div>
                                                )}
                                                <div className="w-full rounded-2xl border border-slate-200 overflow-hidden shadow-inner bg-white">
                                                    <img
                                                        src={`data:image/png;base64,${dynamicPanel.screenshot_b64}`}
                                                        alt="Browser screenshot"
                                                        className="w-full h-auto"
                                                    />
                                                </div>
                                                {dynamicPanel.content && (
                                                    <div className="markdown-content">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                                            {dynamicPanel.content}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="markdown-content">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    rehypePlugins={[rehypeRaw]}
                                                    components={{
                                                        h1: ({ node, ...props }) => <h1 className="text-sm font-black mb-2 text-slate-900 pb-2 border-b border-slate-100" {...props} />,
                                                        h2: ({ node, ...props }) => <h2 className="text-sm font-black mb-2 mt-3 text-primary" {...props} />,
                                                        h3: ({ node, ...props }) => <h3 className="text-xs font-black mb-1.5 mt-2 text-slate-700" {...props} />,
                                                        ul: ({ node, ...props }) => <ul className="list-disc pl-4 mb-3 space-y-1" {...props} />,
                                                        ol: ({ node, ...props }) => <ol className="list-decimal pl-4 mb-3 space-y-1" {...props} />,
                                                        li: ({ node, ...props }) => <li className="text-[12px] text-slate-600 leading-relaxed" {...props} />,
                                                        p: ({ node, ...props }) => <p className="text-[12px] text-slate-600 leading-relaxed mb-2" {...props} />,
                                                        strong: ({ node, ...props }) => <strong className="font-bold text-slate-800" {...props} />,
                                                        code: ({ node, inline, ...props }: any) => (
                                                            <code className={cn("bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono text-primary", !inline && "block p-3 overflow-x-auto my-3")} {...props} />
                                                        )
                                                    }}
                                                >
                                                    {dynamicPanel.content}
                                                </ReactMarkdown>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/30">
                                <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    <Activity className="w-3 h-3 text-secondary" />
                                    Real-time Execution Engine
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Network + Config + Controls ── */}
                    <div className="p-5 space-y-5 flex-1">
                        <div>
                            <h3 className="text-[10px] font-black text-slate-400 mb-4 flex items-center gap-2 uppercase tracking-widest">
                                <Activity className="w-3.5 h-3.5" /> Network Topology
                            </h3>
                            <div className="space-y-3">
                                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm border-l-4 border-l-primary">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Local Client</span>
                                        <span className={cn(
                                            "text-[10px] font-bold font-mono px-2 py-0.5 rounded border",
                                            status.client === 'READY' ? "text-secondary bg-secondary/10 border-secondary/20" : "text-primary bg-primary/10 border-primary/20"
                                        )}>{status.client}</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className={cn("h-full transition-all duration-75 ease-out rounded-full", status.client === 'READY' ? "bg-secondary" : "bg-primary animate-pulse")}
                                            style={{ width: status.client === 'READY' ? `${userAudioLevel * 100}%` : '33%' }}
                                        />
                                    </div>
                                </div>
                                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm border-l-4 border-l-secondary">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Pipecat Bot</span>
                                        <span className={cn(
                                            "text-[10px] font-bold font-mono px-2 py-0.5 rounded border",
                                            status.agent === 'READY' ? "text-secondary bg-secondary/10 border-secondary/20" : "text-primary bg-primary/10 border-primary/20"
                                        )}>{status.agent}</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className={cn("h-full transition-all duration-75 ease-out rounded-full", status.agent === 'READY' ? "bg-secondary" : "bg-primary animate-pulse")}
                                            style={{ width: status.agent === 'READY' ? `${botAudioLevel * 100}%` : '33%' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <h3 className="text-[10px] font-black text-slate-400 flex items-center gap-2 uppercase tracking-widest">
                                <Settings className="w-3.5 h-3.5" /> Config
                            </h3>
                            <div className="bg-white border border-slate-200 rounded-2xl p-3 group focus-within:border-primary/40 transition-all">
                                <input
                                    type="text"
                                    value={customRoomUrl}
                                    onChange={(e) => setCustomRoomUrl(e.target.value)}
                                    placeholder="https://your-org.daily.co/room  (optional)"
                                    className="w-full bg-transparent border-none outline-none text-[11px] font-mono text-slate-700 placeholder:text-slate-300"
                                />
                            </div>
                            <select
                                value={selectedRole}
                                onChange={(e) => setSelectedRole(e.target.value as any)}
                                className="w-full p-2.5 rounded-xl border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 outline-none"
                            >
                                <option value="showcase">🎬 Autonomous Showcase (Velix ↔ Nexa)</option>
                                <option value="voice_demo">🤖 Two-Agent Demo (Velix + Nexa)</option>
                                <option value="demo">🎯 Aria — Interactive Demo Guide</option>
                                <option value="qa_demo">💬 Aria — Live Q&A Demo</option>
                                <option value="rag_assistant">Aria — Insurance Voice Assistant (RAG)</option>
                                <option value="multilingual_support">🌐 Multilingual Support Agent</option>
                                <option value="model_showdown">⚖️ Model Showdown (GPT-4o vs Mini)</option>
                                <option value="support">Customer Support Agent</option>
                                <option value="travel">Enthusiastic Travel Guide</option>
                                <option value="storyteller">Master Storyteller</option>
                                <option value="interviewer">Technical Interviewer</option>
                                <option value="custom">Custom Prompt...</option>
                            </select>
                            {selectedRole === 'custom' && (
                                <textarea
                                    placeholder="Enter custom system prompt..."
                                    value={customPrompt}
                                    onChange={(e) => setCustomPrompt(e.target.value)}
                                    className="w-full h-24 p-3 rounded-xl border border-slate-200 text-[11px] outline-none resize-none font-mono text-slate-700"
                                />
                            )}
                        </div>

                        {/* Quick Demo — multilingual */}
                        {selectedRole === 'multilingual_support' && status.client === 'READY' && (
                            <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Quick Demo</p>
                                <div className="grid grid-cols-1 gap-2">
                                    {[
                                        { emoji: '🇪🇸', label: 'Speak Spanish', prompt: 'Hola, tengo un problema con mi factura. ¿Pueden ayudarme?' },
                                        { emoji: '🇫🇷', label: 'Speak French', prompt: 'Bonjour, je voudrais des informations sur mon compte.' },
                                        { emoji: '🔧', label: 'Tech Support', prompt: 'My device is not working, please transfer me to technical support.' },
                                        { emoji: '💳', label: 'Billing', prompt: 'I need to dispute a charge. Please transfer me to billing.' },
                                        { emoji: '⬆️', label: 'Escalate', prompt: 'I am very unhappy and want to speak with a manager.' },
                                    ].map(({ emoji, label, prompt }) => (
                                        <button key={label}
                                            onClick={async () => { const host = import.meta.env.VITE_BACKEND_HOST || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:7860' : window.location.host); await fetch(`http://${host}/inject_message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: prompt }) }); }}
                                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 hover:bg-primary/5 border border-slate-200 hover:border-primary/30 text-left transition-all group"
                                        >
                                            <span className="text-base">{emoji}</span>
                                            <span className="text-[10px] font-black text-slate-600 group-hover:text-primary">{label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Quick Demo — voice_demo category picker */}
                        {selectedRole === 'voice_demo' && status.client === 'READY' && (() => {
                            const firePrompt = async (prompt: string) => { const host = import.meta.env.VITE_BACKEND_HOST || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:7860' : window.location.host); await fetch(`http://${host}/inject_message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: prompt }) }); };
                            const categories: Record<string, { icon: string; label: string; bg: string; border: string; text: string; options: { label: string; prompt: string }[] }> = {
                                web_search: { icon: '🌐', label: 'Web Search', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', options: [{ label: 'Latest AI agent frameworks', prompt: 'Search the web for the latest news and developments in AI agent frameworks in 2025.' }, { label: 'Pipecat voice AI updates', prompt: 'Search the web for what Pipecat voice AI framework is and its latest features.' }, { label: 'Voice AI cost trends', prompt: 'Search the web for voice AI cost optimization benchmarks and cost comparisons in 2025.' }] },
                                tasks: { icon: '📋', label: 'Task Organizer', bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', options: [{ label: 'Plan my sprint', prompt: 'Add these sprint tasks: design system prompt, test voice pipeline, optimize latency, write demo script, record video.' }, { label: 'Add weekly errands', prompt: 'Add these personal tasks: grocery shopping, dentist appointment, pay bills, review pull requests, team sync.' }, { label: 'Show & complete tasks', prompt: 'Show my task list, then mark the first task as complete.' }] },
                                insurance: { icon: '🏥', label: 'Insurance Q&A', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', options: [{ label: 'Home flood coverage', prompt: 'What does home insurance cover for water damage and flooding? Search the knowledge base.' }, { label: 'Auto insurance deductibles', prompt: 'Explain how auto insurance deductibles work and what factors affect my premium.' }, { label: 'Life insurance types', prompt: 'What are the different types of life insurance and how do I choose the right one?' }] },
                                build: { icon: '⚙️', label: 'Build an App', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', options: [{ label: 'Task manager', prompt: 'Build a beautiful task manager app with priority levels high medium low, due dates, and a progress bar.' }, { label: 'Insurance calculator', prompt: 'Build an insurance premium calculator with inputs for age, coverage type, and vehicle type.' }, { label: 'Cost comparison dashboard', prompt: 'Build a dashboard comparing AI API costs between Pipecat stack and audio-native APIs with bar charts.' }] },
                            };
                            return (
                                <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Demo Categories</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {Object.entries(categories).map(([key, cat]) => (
                                            <button key={key} onClick={() => setActiveCategory(activeCategory === key ? null : key)}
                                                className={cn("flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border text-center transition-all", activeCategory === key ? `${cat.bg} ${cat.border} ${cat.text}` : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300')}>
                                                <span className="text-lg">{cat.icon}</span>
                                                <span className="text-[9px] font-black uppercase tracking-wide">{cat.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                    {activeCategory && categories[activeCategory] && (
                                        <div className="space-y-1.5">
                                            {categories[activeCategory].options.map(({ label, prompt }) => (
                                                <button key={label} onClick={() => firePrompt(prompt)}
                                                    className={cn("w-full text-left px-3 py-2.5 rounded-xl border text-[10px] font-bold transition-all hover:shadow-sm", categories[activeCategory].bg, categories[activeCategory].border, categories[activeCategory].text)}>
                                                    → {label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Quick Demo — model showdown */}
                        {selectedRole === 'model_showdown' && status.client === 'READY' && (
                            <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Quick Demo</p>
                                <div className="grid grid-cols-1 gap-2">
                                    {[
                                        { emoji: '🧠', label: 'Explain Quantum', prompt: 'Explain quantum entanglement in simple terms.' },
                                        { emoji: '💰', label: 'Startup Costs', prompt: 'What are the main costs to consider when launching a SaaS startup?' },
                                        { emoji: '🤔', label: 'Reasoning Test', prompt: 'A train leaves at 9:15am at 60mph. It travels 2.5 hours. What time does it arrive and how far did it go?' },
                                        { emoji: '🌍', label: 'Creative Task', prompt: 'Write a 3-sentence story about a robot who discovers music for the first time.' },
                                    ].map(({ emoji, label, prompt }) => (
                                        <button key={label}
                                            onClick={async () => { const host = import.meta.env.VITE_BACKEND_HOST || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:7860' : window.location.host); await fetch(`http://${host}/inject_message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: prompt }) }); }}
                                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 hover:bg-primary/5 border border-slate-200 hover:border-primary/30 text-left transition-all group">
                                            <span className="text-base">{emoji}</span>
                                            <span className="text-[10px] font-black text-slate-600 group-hover:text-primary">{label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Quick Demo — demo mode */}
                        {selectedRole === 'demo' && status.client === 'READY' && (
                            <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Quick Demo</p>
                                <div className="grid grid-cols-1 gap-2">
                                    {[
                                        { emoji: '🏗️', label: 'Architecture', prompt: 'Show me the Pipecat pipeline architecture diagram with all the components.' },
                                        { emoji: '🔍', label: 'Knowledge Search', prompt: 'Search the knowledge base for auto insurance coverage types and deductibles.' },
                                        { emoji: '⚙️', label: 'Build UI', prompt: 'Build me an interactive insurance premium calculator app with inputs for age, vehicle type, and coverage level.' },
                                        { emoji: '🌐', label: 'Browser Control', prompt: 'Go to google.com and search for Pipecat voice AI framework.' },
                                        { emoji: '💰', label: 'Show Cost Savings', prompt: 'Explain the cost savings of using Pipecat versus audio-native APIs and show a comparison table.' },
                                    ].map(({ emoji, label, prompt }) => (
                                        <button key={label}
                                            onClick={async () => { const host = import.meta.env.VITE_BACKEND_HOST || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:7860' : window.location.host); await fetch(`http://${host}/inject_message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: prompt }) }); }}
                                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 hover:bg-primary/5 border border-slate-200 hover:border-primary/30 text-left transition-all group">
                                            <span className="text-base">{emoji}</span>
                                            <span className="text-[10px] font-black text-slate-600 group-hover:text-primary">{label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm relative overflow-hidden group hover:border-primary/20 transition-all">
                            <div className="absolute right-0 top-0 w-20 h-20 bg-primary/5 rounded-full -mr-10 -mt-10 blur-2xl" />
                            <div className="flex items-center gap-2 mb-2">
                                <Shield className="w-4 h-4 text-primary" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">Enterprise Security</span>
                            </div>
                            <p className="text-[10px] text-slate-500 leading-relaxed font-bold">
                                Session isolated with SHA-256 HMAC + SSL. Real-time streams bypass public buffers via Daily Mesh.
                            </p>
                        </div>
                    </div>
                </aside>
            </div>
            <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
        </div>
    );
};

export default App;
