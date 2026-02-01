"use client";

import { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
  }

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

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        throw new Error("Please wait a moment before sending another message");
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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

                    {/* Tool indicators */}
                    {message.toolsUsed && message.toolsUsed.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-200/50">
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
                      </div>
                    )}
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
              <div className="grid grid-cols-2 gap-2">
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
                      <p className="text-sm text-gray-700 truncate">
                        {q.question}
                      </p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
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
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type your question..."
            disabled={isLoading}
            className="flex-1 px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            className="px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">
          For emergencies, call 911 or press your nurse call button
        </p>
      </form>
    </div>
  );
}
