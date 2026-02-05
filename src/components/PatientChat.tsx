"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Bot,
  User,
  Loader2,
  Sparkles,
  Pill,
  Activity,
  HelpCircle,
  Apple,
  Calendar,
  Dumbbell,
  ChevronDown,
  RotateCcw,
  AlertTriangle,
  Mic,
  MicOff,
  Volume2,
  Square,
} from "lucide-react";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";

// Web Speech API types (vendor-prefixed in most browsers)
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

interface PatientChatProps {
  patient: Patient;
  analysis: DischargeAnalysis | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolsUsed?: Array<{ name: string; result: unknown }>;
  isLoading?: boolean;
}

// Limits (should match API)
const CHAT_LIMITS = {
  MAX_CONVERSATION_TURNS: 10,
  MAX_MESSAGE_LENGTH: 500,
};

interface SuggestedQuestion {
  icon: React.ReactNode;
  question: string;
  category: string;
}

export function PatientChat({ patient, analysis }: PatientChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [limitWarning, setLimitWarning] = useState<string | null>(null);
  // Session-wide rate limit state (20 msgs / 15 min)
  const [chatRateLimitReset, setChatRateLimitReset] = useState<number | null>(null);
  const [chatRateLimitCountdown, setChatRateLimitCountdown] = useState("");
  const isChatRateLimited = chatRateLimitReset !== null && chatRateLimitReset > Date.now();
  // Voice state
  const [isListening, setIsListening] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);
  const [playingMessageIndex, setPlayingMessageIndex] = useState<number | null>(null);
  const [ttsLoading, setTtsLoading] = useState<number | null>(null);
  const [voiceRateLimitReset, setVoiceRateLimitReset] = useState<number | null>(null);
  const [voiceRateLimitCountdown, setVoiceRateLimitCountdown] = useState("");
  const [autoPlayVoice, setAutoPlayVoice] = useState(false);
  const [sttTranscribing, setSttTranscribing] = useState(false); // Whisper processing
  const [sttError, setSttError] = useState<string | null>(null);
  const [sttRateLimitReset, setSttRateLimitReset] = useState<number | null>(null);
  const [sttRateLimitCountdown, setSttRateLimitCountdown] = useState("");
  const isSttRateLimited = sttRateLimitReset !== null && sttRateLimitReset > Date.now();
  const isVoiceRateLimited = voiceRateLimitReset !== null && voiceRateLimitReset > Date.now();
  // Capabilities — voice feature availability (based on API keys)
  const [voiceEnabled, setVoiceEnabled] = useState(true); // optimistic default
  const [voiceDisabledMsg, setVoiceDisabledMsg] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const lastAutoPlayedRef = useRef<number>(-1);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Calculate current turn count
  const turnCount = Math.floor(messages.filter(m => m.role === "user").length);
  const isNearLimit = turnCount >= CHAT_LIMITS.MAX_CONVERSATION_TURNS - 2;
  const isAtLimit = turnCount >= CHAT_LIMITS.MAX_CONVERSATION_TURNS;

  // Reset conversation
  function resetConversation() {
    setMessages([]);
    setShowSuggestions(true);
    setLimitWarning(null);
    setChatRateLimitReset(null);
    stopAudio();
  }

  // --- Voice: detect browser STT support ---
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSttSupported(!!SR);
  }, []);

  // --- Capabilities: check if voice features are available (API key configured) ---
  useEffect(() => {
    fetch("/api/capabilities")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return;
        const tts = data.voice?.ttsEnabled ?? true;
        const stt = data.voice?.sttEnabled ?? true;
        setVoiceEnabled(tts || stt);
        if (!tts && !stt) {
          setVoiceDisabledMsg(data.voice?.message || "Voice features unavailable");
        }
      })
      .catch(() => {
        // If capabilities endpoint fails, keep optimistic defaults
      });
  }, []);

  // --- Voice: countdown for voice rate limit ---
  useEffect(() => {
    if (!voiceRateLimitReset) {
      setVoiceRateLimitCountdown("");
      return;
    }
    const tick = () => {
      const remaining = voiceRateLimitReset - Date.now();
      if (remaining <= 0) {
        setVoiceRateLimitReset(null);
        setVoiceRateLimitCountdown("");
        return;
      }
      const m = Math.floor(remaining / 60000);
      const s = Math.ceil((remaining % 60000) / 1000);
      setVoiceRateLimitCountdown(m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [voiceRateLimitReset]);

  // --- Voice: countdown for STT (Whisper) rate limit ---
  useEffect(() => {
    if (!sttRateLimitReset) {
      setSttRateLimitCountdown("");
      return;
    }
    const tick = () => {
      const remaining = sttRateLimitReset - Date.now();
      if (remaining <= 0) {
        setSttRateLimitReset(null);
        setSttRateLimitCountdown("");
        return;
      }
      const m = Math.floor(remaining / 60000);
      const s = Math.ceil((remaining % 60000) / 1000);
      setSttRateLimitCountdown(m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [sttRateLimitReset]);

  // --- Voice: browser-native STT toggle (Chrome/Safari) ---
  const toggleBrowserSTT = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInputValue(transcript);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event: { error: string }) => {
      console.error("[STT] Error:", event.error);
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening]);

  // --- Voice: server-side Whisper STT toggle (Firefox fallback) ---
  const toggleWhisperSTT = useCallback(async () => {
    // If already recording, stop and transcribe
    if (isListening && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      // onStop handler will handle transcription
      return;
    }

    // Check if mediaDevices API is available (requires HTTPS, except Chrome localhost)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setSttError("Mic requires HTTPS — works on the deployed site");
      setTimeout(() => setSttError(null), 4000);
      return;
    }

    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks to release the mic
        stream.getTracks().forEach((t) => t.stop());
        setIsListening(false);

        if (chunks.length === 0) return;

        const blob = new Blob(chunks, { type: "audio/webm" });
        setSttTranscribing(true);

        try {
          const formData = new FormData();
          formData.append("audio", blob, "recording.webm");

          const response = await fetch("/api/stt", {
            method: "POST",
            body: formData,
          });

          if (response.status === 429) {
            const errorData = await response.json().catch(() => ({}));
            const resetTime = Date.now() + (errorData.retryAfterMs || 60000);
            setSttRateLimitReset(resetTime);
            setSttTranscribing(false);
            return;
          }

          if (!response.ok) {
            throw new Error("STT request failed");
          }

          const data = await response.json();
          if (data.transcript) {
            setInputValue(data.transcript);
          }
        } catch (err) {
          console.error("[STT/Whisper] Transcription error:", err);
        } finally {
          setSttTranscribing(false);
        }
      };

      mediaRecorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsListening(false);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsListening(true);
    } catch (err) {
      const message = err instanceof DOMException && err.name === "NotAllowedError"
        ? "Mic access denied — check browser permissions"
        : "Mic unavailable — try the deployed site (HTTPS)";
      setSttError(message);
      setTimeout(() => setSttError(null), 4000);
      setIsListening(false);
    }
  }, [isListening]);

  // Unified toggle — picks the right STT method
  const toggleListening = useCallback(() => {
    if (sttSupported) {
      toggleBrowserSTT();
    } else {
      toggleWhisperSTT();
    }
  }, [sttSupported, toggleBrowserSTT, toggleWhisperSTT]);

  // --- Voice: TTS playback ---
  function stopAudio() {
    // Abort any inflight TTS fetch
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setPlayingMessageIndex(null);
    setTtsLoading(null);
  }

  async function playTTS(text: string, messageIndex: number) {
    // If already playing this message, stop
    if (playingMessageIndex === messageIndex) {
      stopAudio();
      return;
    }

    // Stop any current playback AND any inflight fetch
    stopAudio();

    const abortController = new AbortController();
    ttsAbortRef.current = abortController;
    setTtsLoading(messageIndex);

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: abortController.signal,
      });

      // Check if aborted while fetching
      if (abortController.signal.aborted) return;

      if (response.status === 429) {
        const errorData = await response.json().catch(() => ({}));
        const resetTime = Date.now() + (errorData.retryAfterMs || 60000);
        setVoiceRateLimitReset(resetTime);
        setTtsLoading(null);
        return;
      }

      if (!response.ok) {
        throw new Error("TTS request failed");
      }

      const blob = await response.blob();

      // Check if aborted while reading blob
      if (abortController.signal.aborted) return;

      const url = URL.createObjectURL(blob);
      const audio = new Audio();

      // Wait for enough audio to be buffered before playing (prevents clipping)
      await new Promise<void>((resolve, reject) => {
        audio.oncanplaythrough = () => resolve();
        audio.onerror = () => reject(new Error("Audio failed to load"));
        audio.src = url;
      });

      // Check if aborted while buffering
      if (abortController.signal.aborted) {
        URL.revokeObjectURL(url);
        return;
      }

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPlayingMessageIndex(null);
        audioRef.current = null;
      };

      audioRef.current = audio;
      setPlayingMessageIndex(messageIndex);
      setTtsLoading(null);
      await audio.play();
    } catch (error) {
      // Ignore abort errors — they're intentional
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("[TTS] Error:", error);
      setTtsLoading(null);
      setPlayingMessageIndex(null);
    }
  }

  // --- Voice: auto-play TTS for new assistant messages ---
  useEffect(() => {
    if (!autoPlayVoice || isVoiceRateLimited || !voiceEnabled) return;
    // Find the last non-loading assistant message
    const lastAssistantIndex = messages.reduce<number>((acc, m, i) =>
      m.role === "assistant" && !m.isLoading ? i : acc, -1);
    if (lastAssistantIndex <= 0) return; // skip welcome message (index 0)
    if (lastAssistantIndex === lastAutoPlayedRef.current) return; // already played
    lastAutoPlayedRef.current = lastAssistantIndex;
    playTTS(messages[lastAssistantIndex].content, lastAssistantIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, autoPlayVoice, isVoiceRateLimited]);

  // Generate suggested questions based on patient data
  const suggestedQuestions: SuggestedQuestion[] = [
    ...(patient.medications.length > 0
      ? [
          {
            icon: <Pill className="w-4 h-4" />,
            question: `What does ${patient.medications[0]?.name || "my medication"} do?`,
            category: "Medications",
          },
        ]
      : []),
    {
      icon: <Activity className="w-4 h-4" />,
      question: "What should I do if I feel dizzy?",
      category: "Symptoms",
    },
    {
      icon: <Calendar className="w-4 h-4" />,
      question: "When should I see my doctor?",
      category: "Follow-up",
    },
    {
      icon: <Apple className="w-4 h-4" />,
      question: "What can I eat?",
      category: "Diet",
    },
    {
      icon: <Dumbbell className="w-4 h-4" />,
      question: "Can I exercise?",
      category: "Activity",
    },
    {
      icon: <HelpCircle className="w-4 h-4" />,
      question: "What warning signs should I watch for?",
      category: "Safety",
    },
  ];

  // Scroll chat container to bottom when new messages arrive (not the whole page)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Countdown timer for session-wide rate limit
  useEffect(() => {
    if (!chatRateLimitReset) {
      setChatRateLimitCountdown("");
      return;
    }
    const tick = () => {
      const remaining = chatRateLimitReset - Date.now();
      if (remaining <= 0) {
        setChatRateLimitReset(null);
        setChatRateLimitCountdown("");
        return;
      }
      const m = Math.floor(remaining / 60000);
      const s = Math.ceil((remaining % 60000) / 1000);
      setChatRateLimitCountdown(m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [chatRateLimitReset]);

  // Welcome message on first load
  useEffect(() => {
    if (messages.length === 0) {
      const welcomeMessage: ChatMessage = {
        role: "assistant",
        content: `Hi ${patient.name.split(" ")[0]}! 👋 I'm your Recovery Coach. I'm here to help you understand your care plan and answer any questions you have about going home.\n\nFeel free to ask me about your medications, what symptoms to watch for, dietary restrictions, or anything else on your mind!`,
        timestamp: new Date(),
      };
      setMessages([welcomeMessage]);
    }
  }, [patient.name, messages.length]);

  async function sendMessage(messageText: string) {
    if (!messageText.trim() || isLoading) return;

    // Check message length limit
    const trimmedMessage = messageText.trim().slice(0, CHAT_LIMITS.MAX_MESSAGE_LENGTH);

    // Check if at conversation limit
    if (isAtLimit) {
      setLimitWarning("You've reached the conversation limit. Please start a new conversation.");
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: trimmedMessage,
      timestamp: new Date(),
    };

    // Build the updated messages array BEFORE setting state
    // This ensures we send the correct history to the API
    const updatedMessages = [...messages, userMessage];

    setMessages(updatedMessages);
    setInputValue("");
    setIsLoading(true);
    setShowSuggestions(false);

    // Add loading message
    const loadingMessage: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isLoading: true,
    };
    setMessages((prev) => [...prev, loadingMessage]);

    try {
      // Send the conversation history WITHOUT the current message
      // (the API receives `message` separately and the history should be prior context)
      const historyForAPI = messages
        .filter((m) => !m.isLoading) // Exclude loading placeholders
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const response = await fetch("/api/patient-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: patient.id,
          message: trimmedMessage,
          conversationHistory: historyForAPI,
          analysis,
        }),
      });

      if (response.status === 429) {
        const errorData = await response.json().catch(() => ({}));

        if (errorData.category === "chat") {
          // Session-wide demo rate limit — show countdown banner
          const resetTime = Date.now() + (errorData.retryAfterMs || 60000);
          setChatRateLimitReset(resetTime);
          // Remove the loading message without adding an error bubble
          setMessages((prev) => prev.filter((m) => !m.isLoading));
          setIsLoading(false);
          return;
        }

        // Per-patient 1s cooldown — show as error bubble
        throw new Error(errorData.error || "Please wait a moment before sending another message");
      }

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const data = await response.json();

      // Check for limit warning from API
      if (data.limitWarning) {
        setLimitWarning(data.limitWarning);
      }

      // Replace loading message with actual response
      setMessages((prev) => {
        const newMessages = prev.filter((m) => !m.isLoading);
        return [
          ...newMessages,
          {
            role: "assistant" as const,
            content: data.response,
            timestamp: new Date(),
            toolsUsed: data.toolsUsed,
          },
        ];
      });
    } catch (error) {
      console.error("Chat error:", error);
      // Replace loading message with error
      setMessages((prev) => {
        const newMessages = prev.filter((m) => !m.isLoading);
        return [
          ...newMessages,
          {
            role: "assistant" as const,
            content:
              "I'm sorry, I had trouble processing that. Please try asking again, or press your nurse call button if you need immediate help.",
            timestamp: new Date(),
          },
        ];
      });
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(inputValue);
  }

  function handleSuggestedQuestion(question: string) {
    sendMessage(question);
  }

  function getToolIcon(toolName: string) {
    switch (toolName) {
      case "lookupMedication":
        return <Pill className="w-3 h-3" />;
      case "checkSymptom":
        return <Activity className="w-3 h-3" />;
      case "explainMedicalTerm":
        return <HelpCircle className="w-3 h-3" />;
      case "getFollowUpGuidance":
        return <Calendar className="w-3 h-3" />;
      case "getDietaryGuidance":
        return <Apple className="w-3 h-3" />;
      case "getActivityGuidance":
        return <Dumbbell className="w-3 h-3" />;
      default:
        return <Sparkles className="w-3 h-3" />;
    }
  }

  function formatToolName(toolName: string): string {
    const names: Record<string, string> = {
      lookupMedication: "Medication Info",
      checkSymptom: "Symptom Check",
      explainMedicalTerm: "Term Explained",
      getFollowUpGuidance: "Follow-up Info",
      getDietaryGuidance: "Dietary Info",
      getActivityGuidance: "Activity Info",
    };
    return names[toolName] || toolName;
  }

  // Simple markdown renderer for chat messages
  function renderMarkdown(text: string): React.ReactNode {
    // Split by lines to handle numbered lists and paragraphs
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];

    lines.forEach((line, lineIndex) => {
      // Check if it's a numbered list item (e.g., "1. **Bold**: text")
      const listMatch = line.match(/^(\d+)\.\s+(.*)$/);

      if (listMatch) {
        const [, , content] = listMatch;
        elements.push(
          <div key={lineIndex} className="flex gap-2 mb-2">
            <span className="text-gray-500 flex-shrink-0">{listMatch[1]}.</span>
            <span>{renderInlineMarkdown(content)}</span>
          </div>
        );
      } else if (line.trim() === '') {
        // Empty line - add spacing
        elements.push(<div key={lineIndex} className="h-2" />);
      } else {
        // Regular paragraph
        elements.push(
          <p key={lineIndex} className="mb-2">{renderInlineMarkdown(line)}</p>
        );
      }
    });

    return <div className="space-y-0">{elements}</div>;
  }

  // Render inline markdown (bold, italic)
  function renderInlineMarkdown(text: string): React.ReactNode {
    // Pattern to match **bold** text
    const parts = text.split(/(\*\*[^*]+\*\*)/g);

    return parts.map((part, i) => {
      // Check for bold (**text**)
      const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
      if (boldMatch) {
        return <strong key={i} className="font-semibold">{boldMatch[1]}</strong>;
      }
      return <span key={i}>{part}</span>;
    });
  }

  return (
    <div className="flex flex-col h-[600px] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">Recovery Coach</h3>
          <p className="text-xs text-gray-500">
            Ask me anything about your recovery
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Turn counter */}
          <span className={`text-xs px-2 py-1 rounded-full ${
            isAtLimit ? "bg-red-100 text-red-700" :
            isNearLimit ? "bg-amber-100 text-amber-700" :
            "bg-gray-100 text-gray-600"
          }`}>
            {turnCount}/{CHAT_LIMITS.MAX_CONVERSATION_TURNS} messages
          </span>
          {/* Auto-play voice toggle (hidden when voice not configured) */}
          {voiceEnabled && (
            <button
              onClick={() => {
                if (autoPlayVoice) stopAudio();
                setAutoPlayVoice(prev => !prev);
              }}
              disabled={isVoiceRateLimited}
              className={`p-2 rounded-lg transition-colors ${
                autoPlayVoice
                  ? "bg-blue-100 text-blue-600 hover:bg-blue-200"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              title={autoPlayVoice ? "Auto-play voice: ON" : "Auto-play voice: OFF"}
            >
              <Volume2 className="w-4 h-4" />
            </button>
          )}
          {/* Reset button */}
          {messages.length > 1 && (
            <button
              onClick={resetConversation}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Start new conversation"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          <div className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            AI
          </div>
        </div>
      </div>

      {/* Limit Warning Banner */}
      {limitWarning && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-800 flex-1">{limitWarning}</p>
          <button
            onClick={resetConversation}
            className="text-xs text-amber-700 hover:text-amber-900 underline"
          >
            Start new
          </button>
        </div>
      )}

      {/* Session Rate Limit Countdown Banner */}
      {isChatRateLimited && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-800 flex-1">
            Demo chat limit reached. Try again in <strong>{chatRateLimitCountdown}</strong>.
          </p>
        </div>
      )}

      {/* Voice Rate Limit Countdown Banner */}
      {isVoiceRateLimited && (
        <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 border-b border-purple-200">
          <Volume2 className="w-4 h-4 text-purple-600 flex-shrink-0" />
          <p className="text-xs text-purple-800 flex-1">
            Voice limit reached. Listen again in <strong>{voiceRateLimitCountdown}</strong>.
          </p>
        </div>
      )}

      {/* STT (Whisper) Rate Limit Countdown Banner */}
      {isSttRateLimited && (
        <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 border-b border-purple-200">
          <Mic className="w-4 h-4 text-purple-600 flex-shrink-0" />
          <p className="text-xs text-purple-800 flex-1">
            Mic limit reached. Try again in <strong>{sttRateLimitCountdown}</strong>.
          </p>
        </div>
      )}

      {/* Voice disabled notice (missing OPENAI_API_KEY) */}
      {!voiceEnabled && voiceDisabledMsg && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
          <Volume2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <p className="text-xs text-gray-500 flex-1">{voiceDisabledMsg}</p>
        </div>
      )}

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence initial={false}>
          {messages.map((message, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className={`flex gap-3 ${
                message.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              {/* Avatar */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  message.role === "user"
                    ? "bg-blue-100 text-blue-600"
                    : "bg-indigo-100 text-indigo-600"
                }`}
              >
                {message.role === "user" ? (
                  <User className="w-4 h-4" />
                ) : (
                  <Bot className="w-4 h-4" />
                )}
              </div>

              {/* Message Bubble */}
              <div
                className={`max-w-[80%] ${
                  message.role === "user"
                    ? "bg-blue-600 text-white rounded-2xl rounded-tr-md"
                    : "bg-gray-100 text-gray-900 rounded-2xl rounded-tl-md"
                } px-4 py-3`}
              >
                {message.isLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Thinking...</span>
                  </div>
                ) : (
                  <>
                    <div className="text-sm">{renderMarkdown(message.content)}</div>

                    {/* Tool indicators + voice playback */}
                    <div className="mt-2 pt-2 border-t border-gray-200/50 flex items-center justify-between gap-2">
                      {message.toolsUsed && message.toolsUsed.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {message.toolsUsed.map((tool, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 text-xs bg-white/80 text-indigo-700 px-2 py-0.5 rounded-full"
                            >
                              {getToolIcon(tool.name)}
                              {formatToolName(tool.name)}
                            </span>
                          ))}
                        </div>
                      ) : <div />}
                      {/* TTS play button for assistant messages (hidden when voice not configured) */}
                      {message.role === "assistant" && voiceEnabled && (
                        <button
                          onClick={() => playTTS(message.content, index)}
                          disabled={ttsLoading === index || isVoiceRateLimited}
                          className="flex-shrink-0 p-1 rounded-full text-gray-400 hover:text-indigo-600 hover:bg-white/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title={playingMessageIndex === index ? "Stop" : "Listen"}
                        >
                          {ttsLoading === index ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : playingMessageIndex === index ? (
                            <Square className="w-3.5 h-3.5" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Suggested Questions - show when explicitly toggled OR on initial load */}
        <AnimatePresence>
          {showSuggestions && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              <p className="text-xs text-gray-500 text-center">
                {messages.length <= 1 ? "Try asking one of these:" : "Suggested questions:"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {suggestedQuestions.map((q, i) => (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => handleSuggestedQuestion(q.question)}
                    className="flex items-center gap-2 p-3 bg-gray-50 hover:bg-blue-50 rounded-lg text-left transition-colors group"
                  >
                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm text-gray-400 group-hover:text-blue-600 transition-colors">
                      {q.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400">{q.category}</p>
                      <p className="text-sm text-gray-700">
                        {q.question}
                      </p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* Show More Suggestions Toggle */}
      {!showSuggestions && messages.length > 1 && (
        <button
          onClick={() => setShowSuggestions(true)}
          className="mx-4 mb-2 text-xs text-blue-600 hover:text-blue-700 flex items-center justify-center gap-1"
        >
          <ChevronDown className="w-3 h-3" />
          Show suggested questions
        </button>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-gray-100 bg-gray-50"
      >
        <div className="flex gap-2">
          {/* Mic button (STT) — visible only when voice is configured */}
          {voiceEnabled && (
            <button
              type="button"
              onClick={toggleListening}
              disabled={isLoading || isChatRateLimited || sttTranscribing || isSttRateLimited}
              className={`relative px-3 py-3 rounded-xl transition-all flex items-center justify-center ${
                isListening
                  ? "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/30 scale-105"
                  : sttTranscribing
                    ? "bg-indigo-100 text-indigo-500 border border-indigo-300"
                    : "bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 border border-blue-200"
              } disabled:bg-gray-100 disabled:text-gray-300 disabled:border-gray-200 disabled:cursor-not-allowed disabled:shadow-none`}
              title={
                sttTranscribing ? "Transcribing..."
                  : isListening ? (sttSupported ? "Stop listening" : "Tap to stop & transcribe")
                  : "Speak your question"
              }
            >
              {sttTranscribing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isListening ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
              {isListening && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-400 rounded-full animate-ping" />
              )}
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={sttTranscribing ? "Transcribing..." : isListening ? "🎙️ Listening... speak now" : voiceEnabled ? "Type your question or tap 🎤" : "Type your question..."}
            disabled={isLoading || isChatRateLimited}
            className={`flex-1 px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed ${
              isListening ? "border-red-300 ring-1 ring-red-200" : "border-gray-200"
            }`}
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading || isChatRateLimited}
            className="px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        {sttError && (
          <p className="text-xs text-red-500 text-center mt-2 animate-pulse">
            {sttError}
          </p>
        )}
        <p className="text-xs text-gray-400 text-center mt-2">
          For emergencies, call 911 or press your nurse call button
        </p>
      </form>
    </div>
  );
}
