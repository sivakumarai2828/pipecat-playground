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
    support: "You are a helpful customer support agent for a tech company. Be polite, professional, and focus on solving issues. BE EXTREMELY CONCISE. Provide summaries and one-line answers when possible. You will receive transcripts with speaker tags like 'Speaker S1:'; understand them but NEVER repeat them.",
    travel: "You are a knowledgeable travel guide. Suggest destinations and fun facts. BE EXTREMELY CONCISE and provide quick summaries. Avoid long paragraphs. Maintain an adventurous but brief tone.",
    storyteller: "You are a master storyteller. Weave captivating but BRIEF tales. Use descriptive language but keep total response length short (max 3-4 sentences).",
    interviewer: "You are a technical interviewer. Ask challenging but fair questions. BE EXTREMELY CONCISE. Provide feedback in bullet points.",
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
        stats: { stt_seconds: number; llm_input_tokens: number; llm_output_tokens: number; tts_chars: number };
    } | null>(null);
    const [dynamicPanel, setDynamicPanel] = useState<{
        isOpen: boolean;
        name: string;
        content: string;
        status: 'idle' | 'thinking' | 'running' | 'complete' | 'error';
        prompt: string;
        progress: number;
        eta: number;
        message: string;
    }>({ isOpen: false, name: '', content: '', status: 'idle', prompt: '', progress: 0, eta: 0, message: '' });

    const ws = useRef<WebSocket | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        // Only run on mount
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:7860' : window.location.host;
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
            // User transcripts arrive as 'transcript' with role 'user'
            // We ignore them for display as requested, but they are in the logs
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
                message: data.message || ''
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
        }
    };

    const connect = async () => {
        setIsConnecting(true);
        setStatus({ client: 'CONNECTING', agent: 'CONNECTING' });
        setErrorDialog(null);

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
                const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:7860' : window.location.host;
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

            co.on('remote-participants-audio-level', (evt: any) => {
                const levels = evt.participantsAudioLevel;
                // For this playground, we just take the highest remote level as bot level
                const maxLevel = Math.max(...Object.values(levels) as number[], 0);
                setBotAudioLevel(maxLevel);
            });

            await co.startLocalAudioLevelObserver();
            await co.startRemoteParticipantsAudioLevelObserver();

            setLogs(prev => [...prev, { message: 'Joined Daily Room', type: 'info', timestamp: new Date().toLocaleTimeString() }]);

            const base_prompt = selectedRole === 'custom' ? customPrompt : ROLE_PRESETS[selectedRole as keyof typeof ROLE_PRESETS];
            const system_prompt = [
                base_prompt,
                "### CRITICAL FORMATTING RULES:",
                "1. BE EXTREMELY CONCISE. Provide summaries instead of long explanations.",
                "2. Always use proper Markdown.",
                "3. Use DOUBLE NEWLINES (\n\n) between sections for clarity.",
                "4. Use bullet points and bolding for quick scanning.",
                "",
                "### TOOL USAGE (MANDATORY):",
                "1. If you are about to provide a list, grocery list, table, or structured data, you MUST call 'show_text_on_screen' FIRST. Do NOT describe the items verbally. Only provide a brief 1-sentence summary *after* the tool call has finished.",
                "2. If the user asks for a widget, mini-app, or complex visualization, you MUST call 'generate_ui_component' FIRST. Provide only the HTML code in the tool args.",
                "3. NEVER act as if you've shared information on the screen if you haven't called the corresponding tool first.",
                "4. Be EXTREMELY BRIEF verbally.",
                "",
                "The user will see your response in a side panel. Do not explain the tools, just use them and be extremely brief."
            ].join("\n");

            const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:7860' : window.location.host;
            await fetch(`http${window.location.protocol === 'https:' ? 's' : ''}://${host}/agent/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room_url, system_prompt })
            });

            co.on('track-started', (evt) => {
                const participant = evt.participant;
                if (!participant) return;
                console.log('Track started:', evt.track.kind, participant.user_name);
                if (participant.local) return;
                if (evt.track.kind === 'audio' && audioRef.current) {
                    audioRef.current.srcObject = new MediaStream([evt.track]);
                    audioRef.current.play().catch(e => console.error('Audio play failed:', e));
                    setLogs(prev => [...prev, { message: `Audio track started: ${participant.user_name}`, type: 'info', timestamp: new Date().toLocaleTimeString() }]);
                }
            });

            co.on('track-stopped', (evt) => {
                console.log('Track stopped:', evt.track.kind);
                if (evt.track.kind === 'audio' && audioRef.current) {
                    audioRef.current.srcObject = null;
                }
            });

            co.on('participant-joined', (evt) => {
                console.log('Participant joined:', evt.participant.user_name);
                if (evt.participant.user_name === 'Pipecat Agent') {
                    setStatus(prev => ({ ...prev, agent: 'READY' }));
                }
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
                                    <div className="flex flex-col items-center justify-center py-32 text-slate-300">
                                        <div className="w-16 h-16 rounded-3xl bg-slate-100 flex items-center justify-center mb-6 border border-slate-200/50">
                                            <Activity className="w-8 h-8 opacity-40 animate-pulse text-slate-400" />
                                        </div>
                                        <p className="text-lg font-bold tracking-tight text-slate-400">System stabilized. Awaiting human voice...</p>
                                        <p className="text-[10px] font-black font-mono mt-2 uppercase tracking-widest opacity-60">Real-time STT Buffer Empty</p>
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
                                            ) : (
                                                <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                                                    <div className="w-2 h-2 rounded-full bg-slate-400" />
                                                </div>
                                            )}
                                            <span className={cn(t.role === 'assistant' ? "text-primary" : "text-slate-600")}>
                                                {t.role === 'assistant' ? 'Velix' : 'You'}
                                            </span>
                                            <span className="opacity-0 group-hover:opacity-100 transition-opacity font-mono tracking-normal text-[9px]">
                                                {t.timestamp}
                                            </span>
                                        </div>
                                        <div className={cn(
                                            "px-6 py-4 rounded-[2rem] max-w-[85%] text-[15px] leading-relaxed relative transition-all",
                                            t.role === 'user'
                                                ? "bg-slate-900 text-white rounded-tr-none shadow-lg"
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
                        </div>
                    </div>
                </main>

                {/* Right Sidebar: Status & Controls */}
                <aside className="w-96 border-l border-slate-200 flex flex-col p-8 gap-8 bg-slate-50/50 backdrop-blur-md overflow-y-auto">
                    <section>
                        <h3 className="text-xs font-black text-slate-400 mb-6 flex items-center gap-2 uppercase tracking-widest">
                            <Activity className="w-4 h-4" /> Network Topology
                        </h3>
                        <div className="space-y-6">
                            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm border-l-4 border-l-primary hover:border-r-slate-300 transition-all">
                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Local Client</span>
                                    <span className={cn(
                                        "text-xs font-bold font-mono px-2 py-0.5 rounded border",
                                        status.client === 'READY' ? "text-secondary bg-secondary/10 border-secondary/20" : "text-primary bg-primary/10 border-primary/20"
                                    )}>{status.client}</span>
                                </div>
                                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-2">
                                    <div
                                        className={cn(
                                            "h-full transition-all duration-75 ease-out rounded-full shadow-[0_0_8px_rgba(37,99,235,0.3)]",
                                            status.client === 'READY' ? "bg-secondary" : "bg-primary animate-pulse"
                                        )}
                                        style={{ width: status.client === 'READY' ? `${userAudioLevel * 100}%` : '33%' }}
                                    />
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm border-l-4 border-l-secondary hover:border-r-slate-300 transition-all">
                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Pipecat Bot</span>
                                    <span className={cn(
                                        "text-xs font-bold font-mono px-2 py-0.5 rounded border",
                                        status.agent === 'READY' ? "text-secondary bg-secondary/10 border-secondary/20" : "text-primary bg-primary/10 border-primary/20"
                                    )}>{status.agent}</span>
                                </div>
                                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-2">
                                    <div
                                        className={cn(
                                            "h-full transition-all duration-75 ease-out rounded-full shadow-[0_0_8px_rgba(37,99,235,0.3)]",
                                            status.agent === 'READY' ? "bg-secondary" : "bg-primary animate-pulse"
                                        )}
                                        style={{ width: status.agent === 'READY' ? `${botAudioLevel * 100}%` : '33%' }}
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h3 className="text-xs font-black text-slate-400 mb-6 flex items-center gap-2 uppercase tracking-widest">
                            <Settings className="w-4 h-4" /> Local Config
                        </h3>
                        <div className="space-y-4">
                            <div className="space-y-3">
                                <label className="text-[10px] text-slate-500 font-black uppercase tracking-widest px-1">Studio Microinterface</label>
                                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between group hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="p-2 rounded-lg bg-slate-100">
                                            <Mic className="w-4 h-4 text-primary" />
                                        </div>
                                        <span className="text-[11px] font-bold text-slate-700 truncate tracking-tight">System High-Def (Built-in)</span>
                                    </div>
                                    <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-primary transition-colors" />
                                </div>
                            </div>

                            <div className="space-y-3 pt-4 border-t border-slate-200/60">
                                <label className="text-[10px] text-slate-500 font-black uppercase tracking-widest px-1">Custom Room URL (Optional)</label>
                                <div className="bg-white border border-slate-200 rounded-2xl p-4 group focus-within:border-primary/40 transition-all">
                                    <input
                                        type="text"
                                        value={customRoomUrl}
                                        onChange={(e) => setCustomRoomUrl(e.target.value)}
                                        placeholder="https://your-org.daily.co/room"
                                        className="w-full bg-transparent border-none outline-none text-[11px] font-mono text-slate-700 placeholder:text-slate-300"
                                    />
                                </div>
                                <p className="text-[9px] text-slate-400 px-1 leading-tight">
                                    Paste a room URL from your Dashboard to bypass automated creation issues.
                                </p>
                            </div>

                            <div className="form-group" style={{ marginTop: '20px' }}>
                                <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px', color: '#1e293b' }}>
                                    AGENT PERSONALITY
                                </label>
                                <select
                                    value={selectedRole}
                                    onChange={(e) => setSelectedRole(e.target.value as any)}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid #e2e8f0',
                                        background: 'white',
                                        outline: 'none',
                                        marginBottom: '10px'
                                    }}
                                >
                                    <option value="rag_assistant">Aria — Insurance Voice Assistant (RAG Demo)</option>
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
                                        style={{
                                            width: '100%',
                                            height: '100px',
                                            padding: '10px',
                                            borderRadius: '8px',
                                            border: '1px solid #e2e8f0',
                                            fontSize: '14px',
                                            outline: 'none',
                                            resize: 'none'
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    </section>

                    <div className="mt-auto space-y-4">
                        {/* Live Cost Comparison Widget */}
                        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm relative overflow-hidden">
                            <div className="flex items-center gap-2 mb-4">
                                <Zap className="w-4 h-4 text-secondary" />
                                <span className="text-xs font-black uppercase tracking-widest text-slate-700">Live Cost Meter</span>
                            </div>
                            {costData ? (
                                <div className="space-y-3">
                                    {/* Savings badge */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black text-slate-400 uppercase">Savings vs Realtime API</span>
                                        <span className="text-sm font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                            {costData.savings_pct}% cheaper
                                        </span>
                                    </div>
                                    {/* Your stack */}
                                    <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                                        <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-2">Pipecat Stack</p>
                                        <div className="flex justify-between text-[10px] text-slate-600 font-bold">
                                            <span>STT (Speechmatics)</span>
                                            <span>${costData.your_stack.stt.toFixed(5)}</span>
                                        </div>
                                        <div className="flex justify-between text-[10px] text-slate-600 font-bold">
                                            <span>LLM (GPT-4o text)</span>
                                            <span>${costData.your_stack.llm.toFixed(5)}</span>
                                        </div>
                                        <div className="flex justify-between text-[10px] text-slate-600 font-bold">
                                            <span>TTS (Cartesia)</span>
                                            <span>${costData.your_stack.tts.toFixed(5)}</span>
                                        </div>
                                        <div className="flex justify-between text-[10px] font-black text-slate-800 border-t border-slate-200 pt-1 mt-1">
                                            <span>Total</span>
                                            <span className="text-primary">${costData.your_stack.total.toFixed(5)}</span>
                                        </div>
                                    </div>
                                    {/* Realtime API */}
                                    <div className="bg-red-50 rounded-2xl p-3 border border-red-100">
                                        <p className="text-[9px] font-black text-red-500 uppercase tracking-widest mb-2">OpenAI Realtime API (est.)</p>
                                        <div className="flex justify-between text-[10px] font-black text-red-600">
                                            <span>Audio tokens</span>
                                            <span>${costData.realtime_api.total.toFixed(5)}</span>
                                        </div>
                                    </div>
                                    {/* Stats */}
                                    <div className="flex gap-2 text-[9px] font-bold text-slate-400">
                                        <span>{costData.stats.stt_seconds.toFixed(1)}s audio</span>
                                        <span>·</span>
                                        <span>{costData.stats.llm_input_tokens + costData.stats.llm_output_tokens} tokens</span>
                                        <span>·</span>
                                        <span>{costData.stats.tts_chars} chars</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-4">
                                    <p className="text-[10px] text-slate-400 font-bold">Start a session to see live cost comparison</p>
                                    <p className="text-[9px] text-slate-300 mt-1">Pipecat vs OpenAI Realtime API</p>
                                </div>
                            )}
                        </div>

                        <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm relative overflow-hidden group hover:border-primary/20 transition-all">
                            <div className="absolute right-0 top-0 w-24 h-24 bg-primary/5 rounded-full -mr-12 -mt-12 blur-2xl group-hover:bg-primary/10 transition-colors" />
                            <div className="flex items-center gap-3 mb-3">
                                <Shield className="w-5 h-5 text-primary" />
                                <span className="text-xs font-black uppercase tracking-widest text-slate-700">Enterprise Security</span>
                            </div>
                            <p className="text-[10px] text-slate-500 leading-relaxed font-bold tracking-tight">
                                Session isolated with SHA-256 HMAC and SSL encryption. Real-time media streams bypass public buffers via Daily Mesh.
                            </p>
                        </div>
                    </div>
                </aside>
            </div>
            {/* Dynamic Display Side Panel */}
            {dynamicPanel.isOpen && (
                <div className="fixed top-0 right-0 w-[450px] h-full bg-white shadow-2xl z-50 animate-in slide-in-from-right duration-500 border-l border-slate-200 flex flex-col">
                    <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
                                <PanelRight className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <h2 className="text-sm font-black text-slate-800 uppercase tracking-tight">AI Intelligence Display</h2>
                                <p className="text-[10px] font-bold text-slate-400 font-mono tracking-widest">{dynamicPanel.name}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setDynamicPanel(prev => ({ ...prev, isOpen: false }))}
                            className="p-2 rounded-xl hover:bg-slate-200 transition-colors text-slate-400"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-8 scrollbar-hide">
                        {dynamicPanel.status === 'thinking' || dynamicPanel.status === 'running' ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-8 animate-in fade-in zoom-in duration-500">
                                <div className="relative w-32 h-32 flex items-center justify-center">
                                    <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
                                    <div
                                        className="absolute inset-0 rounded-full border-4 border-primary transition-all duration-1000 ease-out"
                                        style={{
                                            clipPath: `inset(0 0 0 0)`,
                                            transform: `rotate(${dynamicPanel.progress * 3.6}deg)`,
                                            borderTopColor: 'transparent',
                                            borderRightColor: 'transparent',
                                            borderBottomColor: 'transparent'
                                        }}
                                    />
                                    <div className="flex flex-col items-center">
                                        <span className="text-2xl font-black text-slate-800">{dynamicPanel.progress}%</span>
                                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Progress</span>
                                    </div>
                                    <RefreshCw className="absolute -top-2 -right-2 w-6 h-6 animate-spin text-secondary opacity-50" />
                                </div>

                                <div className="w-full space-y-4 px-4 text-center">
                                    <div className="space-y-1">
                                        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-800 animate-pulse">
                                            {dynamicPanel.message || "Velix is constructing the UI..."}
                                        </p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                            Estimated completion in {dynamicPanel.eta}s
                                        </p>
                                    </div>

                                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                                        <div
                                            className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-1000 ease-out shadow-[0_0_12px_rgba(37,99,235,0.2)]"
                                            style={{ width: `${dynamicPanel.progress}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 w-full px-4">
                                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Architecture</p>
                                        <div className={cn("h-1 rounded-full", dynamicPanel.progress > 20 ? "bg-secondary" : "bg-slate-200")} />
                                    </div>
                                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Implementation</p>
                                        <div className={cn("h-1 rounded-full", dynamicPanel.progress > 60 ? "bg-secondary" : "bg-slate-200")} />
                                    </div>
                                </div>
                            </div>
                        ) : dynamicPanel.status === 'error' ? (
                            <div className="flex flex-col items-center justify-center h-full text-red-500 gap-4">
                                <X className="w-12 h-12 p-3 bg-red-50 rounded-2xl" />
                                <p className="text-sm font-black uppercase tracking-widest text-center">{dynamicPanel.message}</p>
                            </div>
                        ) : (
                            <div className="prose prose-slate max-w-none">
                                {dynamicPanel.name === 'generate_ui_component' ? (
                                    <div className="w-full h-[500px] rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-inner">
                                        <iframe
                                            title="UI Sandbox"
                                            srcDoc={dynamicPanel.content}
                                            className="w-full h-full border-none"
                                            sandbox="allow-scripts"
                                        />
                                    </div>
                                ) : (
                                    <div className="markdown-content">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            rehypePlugins={[rehypeRaw]}
                                            components={{
                                                h1: ({ node, ...props }) => <h1 className="text-xl font-black mb-4 text-slate-900" {...props} />,
                                                h2: ({ node, ...props }) => <h2 className="text-lg font-bold mb-3 mt-6 text-slate-800" {...props} />,
                                                ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-4 space-y-2" {...props} />,
                                                li: ({ node, ...props }) => <li className="text-sm text-slate-600" {...props} />,
                                                p: ({ node, ...props }) => <p className="text-sm text-slate-600 leading-relaxed mb-4" {...props} />,
                                                code: ({ node, inline, ...props }: any) => (
                                                    <code className={cn("bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono text-primary", !inline && "block p-4 overflow-x-auto my-4")} {...props} />
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

                    <div className="p-6 border-t border-slate-100 bg-slate-50/30">
                        <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <Activity className="w-3 h-3 text-secondary" />
                            Real-time Execution Engine
                        </div>
                    </div>
                </div>
            )}
            <audio ref={audioRef} style={{ display: 'none' }} />
        </div>
    );
};

export default App;
