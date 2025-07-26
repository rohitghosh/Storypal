import React, { useState, useEffect, useRef, useCallback } from "react";
import { Send, Image as ImageIcon, Type, RotateCcw } from "lucide-react";
import { ChatLogic } from "@/utils/ChatLogic";
import { ChatMessage, ChatState, ChatOption } from "@/types/ChatTypes";
// import { saveChatMessage, getChatHistory } from "@/utils/chatFirebase";
import { saveChatMessage, getChatHistory, trackRegeneration, getRegenerationCount } from "@/components/chatFirebase";
import { updateDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

interface CustomerSupportChatProps {
  bookId: string;
  bookData: any; // Your book type with transformed pages
  userId: string;
  onImageUpdate?: () => void;
  togglePageVersion: (pageId: number, direction: "prev" | "next") => void;
  regeneratePage: (
    page: any,
    mode: string,
    titleOverride?: string,
    revisedPrompt?: string,
  ) => Promise<void>;
  updatePage: (pageId: number, updates: any) => void;
}

export const CustomerSupportChat: React.FC<CustomerSupportChatProps> = ({
  bookId,
  bookData,
  userId,
  onImageUpdate,
  togglePageVersion,
  regeneratePage,
  updatePage,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentState, setCurrentState] = useState<ChatState>("initial");
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedContext, setSelectedContext] = useState<any>({});
  const [regenerationCounts, setRegenerationCounts] = useState<
    Map<string, number>
  >(new Map());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatLogic = useRef(new ChatLogic());

  // Initialize chat
  useEffect(() => {
    initializeChat();
  }, [bookId, userId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const initializeChat = async () => {
    try {
      const history = await getChatHistory(userId, bookId);
      if (history && history.messages.length > 0) {
        setMessages(history.messages);
        setCurrentState(history.currentState || "initial");
        // Restore regeneration counts
        if (history.regenerationTracking) {
          setRegenerationCounts(
            new Map(Object.entries(history.regenerationTracking)),
          );
        }
      } else {
        const initial = chatLogic.current.getInitialMessage();
        const initialMessage: ChatMessage = {
          id: Date.now().toString(),
          type: "bot",
          content: initial.message,
          timestamp: new Date(),
          options: initial.options,
        };
        setMessages([initialMessage]);
        await saveChatMessage(userId, bookId, initialMessage);
      }
    } catch (error) {
      console.error("Error initializing chat:", error);
    }
  };

  const handleOptionClick = async (option: ChatOption) => {
    // Add user message
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: "user",
      content: option.label,
      timestamp: new Date(),
      metadata: { selectedOption: option.value },
    };

    setMessages((prev) => [...prev, userMessage]);
    await saveChatMessage(userId, bookId, userMessage);

    // Process selection
    processUserSelection(option.value);
  };

  const handleTextSubmit = async () => {
    if (!userInput.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: "user",
      content: userInput,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setUserInput("");
    await saveChatMessage(userId, bookId, userMessage);

    // Handle based on current context
    if (selectedContext.actionType === "regenerate_scene") {
      await handleImageRegeneration(
        selectedContext.selectedPageIndex,
        userInput,
      );
    } else if (selectedContext.actionType === "regenerate_cover") {
      await handleCoverRegeneration(userInput);
    } else if (selectedContext.actionType === "regenerate_title") {
      await handleTitleRegeneration(userInput);
    } else if (selectedContext.actionType === "update_text") {
      await handleTextUpdate(selectedContext.selectedPageIndex, userInput);
    }
  };

  const processUserSelection = async (selection: string) => {
    if (selection.startsWith("toggle_")) {
      const parts = selection.split("_");
      if (parts[1] === "prev" || parts[1] === "next") {
        const pageIndex = parseInt(parts[2]);
        const actualPageId = pageIndex === -1 ? 1 : pageIndex + 2; // -1 for cover, otherwise +2

        await togglePageVersion(actualPageId, parts[1] as "prev" | "next");
        onImageUpdate?.();

        const toggleMessage: ChatMessage = {
          id: Date.now().toString(),
          type: "bot",
          content: `I've switched to the ${parts[1] === "prev" ? "previous" : "next"} version. What would you like to do now?`,
          timestamp: new Date(),
          options: [
            { id: "more_yes", label: "Make more changes", value: "yes" },
            { id: "more_no", label: "Everything looks good", value: "no" },
          ],
        };

        setMessages((prev) => [...prev, toggleMessage]);
        return;
      }
    }
    // Handle go back
    if (selection === "go_back" || selection === "start_over") {
      setCurrentState("initial");
      setSelectedContext({});
      const initial = chatLogic.current.getInitialMessage();
      const resetMessage: ChatMessage = {
        id: Date.now().toString(),
        type: "bot",
        content: initial.message,
        timestamp: new Date(),
        options: initial.options,
      };
      setMessages((prev) => [...prev, resetMessage]);
      return;
    }

    const context = {
      bookId,
      pages: bookData.pages,
      cover: bookData.cover,
      regenerationCounts,
      ...selectedContext,
    };

    const response = chatLogic.current.processUserSelection(
      currentState,
      selection,
      context,
    );

    if (response.state) {
      setCurrentState(response.state);
    }

    if (response.selectedPageIndex !== undefined) {
      setSelectedContext((prev) => ({
        ...prev,
        selectedPageIndex: response.selectedPageIndex,
      }));
    }

    if (response.actionType) {
      setSelectedContext((prev) => ({
        ...prev,
        actionType: response.actionType,
      }));
    }

    // Add bot response
    const botMessage: ChatMessage = {
      id: Date.now().toString(),
      type: "bot",
      content: response.message,
      timestamp: new Date(),
      options: response.options,
    };

    setMessages((prev) => [...prev, botMessage]);
    await saveChatMessage(userId, bookId, botMessage);
  };

  const handleImageRegeneration = async (
    pageIndex: number,
    feedback: string,
  ) => {
    setIsLoading(true);
    try {
      const imageKey = `page_${pageIndex}`;
      // Check Firestore for regeneration count
      const regenCount = await getRegenerationCount(userId, bookId, imageKey);
      if (regenCount >= 1) {
        const errorMessage: ChatMessage = {
          id: Date.now().toString(),
          type: "bot",
          content:
            "You've already regenerated this image once. You can switch between the original and new version using the toggle below.",
          timestamp: new Date(),
          options: [
            {
              id: `toggle_prev_${pageIndex}`,
              label: "Toggle to previous version",
              value: `toggle_prev_${pageIndex}`,
            },
            { id: "more_yes", label: "Yes, something else", value: "yes" },
            { id: "more_no", label: "No, everything looks good", value: "no" },
          ],
        };
        setMessages((prev) => [...prev, errorMessage]);
        setIsLoading(false);
        return;
      }
      const page = bookData.pages[pageIndex];
      if (!page) return;
      await regeneratePage(pageIndex + 2, "image", undefined, feedback);
      // Track regeneration in Firestore
      await trackRegeneration(userId, bookId, imageKey);
      // Update local state
      const newCount = (regenerationCounts.get(imageKey) || 0) + 1;
      setRegenerationCounts((prev) => new Map(prev).set(imageKey, newCount));
      onImageUpdate?.();
      const successMessage: ChatMessage = {
        id: Date.now().toString(),
        type: "bot",
        content:
          "Perfect! I've updated the image based on your feedback. The new image is now displayed. Would you like to make any other changes?",
        timestamp: new Date(),
        options: [
          {
            id: `toggle_prev_${pageIndex}`,
            label: "Toggle to previous version",
            value: `toggle_prev_${pageIndex}`,
          },
          { id: "more_yes", label: "Yes, something else", value: "yes" },
          { id: "more_no", label: "No, everything looks good", value: "no" },
        ],
      };
      setMessages((prev) => [...prev, successMessage]);
      await saveChatMessage(userId, bookId, successMessage);
    } catch (error) {
      console.error("Error regenerating image:", error);
      const errorMessage: ChatMessage = {
        id: Date.now().toString(),
        type: "bot",
        content:
          "I'm sorry, there was an error updating the image. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCoverRegeneration = async (feedback: string) => {
    setIsLoading(true);
    try {
      const imageKey = "cover";
      // Check Firestore for regeneration count
      const regenCount = await getRegenerationCount(userId, bookId, imageKey);
      if (regenCount >= 1) {
        const errorMessage: ChatMessage = {
          id: Date.now().toString(),
          type: "bot",
          content:
            "You've already regenerated the cover once. You can switch between versions using the toggle below.",
          timestamp: new Date(),
          options: [
            {
              id: "toggle_cover",
              label: "Toggle to previous version",
              value: "toggle_cover",
            },
            { id: "more_yes", label: "Make more changes", value: "yes" },
            { id: "more_no", label: "Everything looks good", value: "no" },
          ],
        };
        setMessages((prev) => [...prev, errorMessage]);
        setIsLoading(false);
        return;
      }
      const coverPage = bookData.pages.find((p) => p.isCover);
      if (!coverPage) return;
      await regeneratePage(1, "cover", undefined, feedback);
      // Track regeneration in Firestore
      await trackRegeneration(userId, bookId, imageKey);
      // Update local state
      const prevCount = regenerationCounts.get("cover") || 0;
      const newCount = prevCount + 1;
      setRegenerationCounts((prev) => new Map(prev).set("cover", newCount));
      onImageUpdate?.();
      const successMessage: ChatMessage = {
        id: Date.now().toString(),
        type: "bot",
        content:
          "Great! I've updated the cover based on your feedback. The new cover is now displayed. What would you like to do next?",
        timestamp: new Date(),
        options: [
          {
            id: "toggle_cover",
            label: "Toggle to previous version",
            value: "toggle_cover",
          },
          { id: "more_yes", label: "Make more changes", value: "yes" },
          { id: "more_no", label: "Everything looks good", value: "no" },
        ],
      };
      setMessages((prev) => [...prev, successMessage]);
    } catch (err: any) {
      console.error(`coverRegen error msg ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTitleRegeneration = async (newTitle: string) => {
    setIsLoading(true);
    try {
      const coverPage = bookData.pages.find((p) => p.isCover);
      if (!coverPage) return;

      await regeneratePage(1, "coverTitle", newTitle);
      onImageUpdate?.();

      const successMessage: ChatMessage = {
        id: Date.now().toString(),
        type: "bot",
        content: `Perfect! I've updated the title to "${newTitle}". Is there anything else you'd like to change?`,
        timestamp: new Date(),
        options: [
          { id: "more_yes", label: "Yes, something else", value: "yes" },
          { id: "more_no", label: "No, everything looks good", value: "no" },
        ],
      };

      setMessages((prev) => [...prev, successMessage]);
    } catch (error) {
      console.error("Error regenerating title:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTextUpdate = async (pageIndex: number, newText: string) => {
    setIsLoading(true);
    try {
      // Update the page content
      const { ok } = await updatePage(pageIndex + 2, newText); // +2 because of 0-based index and cover is 1
      if (!ok) {
        throw new Error("PATCH failed");
      }

      // Update in Firebase
      // await updateDoc(doc(db, "books", bookId), {
      //   [`pages.${pageIndex}.scene_text`]: newText,
      // });

      // onImageUpdate?.();

      const successMessage: ChatMessage = {
        id: Date.now().toString(),
        type: "bot",
        content:
          "I've updated the text for that scene. Is there anything else you'd like to change?",
        timestamp: new Date(),
        options: [
          { id: "more_yes", label: "Yes, something else", value: "yes" },
          { id: "more_no", label: "No, everything looks good", value: "no" },
        ],
      };

      setMessages((prev) => [...prev, successMessage]);
    } catch (error) {
      console.error("Error updating text:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = (message: ChatMessage) => {
    const isUser = message.type === "user";

    return (
      <div
        key={message.id}
        className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}
      >
        <div
          className={`max-w-[80%] ${
            isUser
              ? "bg-black text-white rounded-l-2xl rounded-tr-2xl"
              : "bg-gray-100 text-gray-800 rounded-r-2xl rounded-tl-2xl"
          } px-4 py-3`}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>

          {/* Render options if bot message */}
          {!isUser && message.options && (
            <div className="mt-3 space-y-2">
              {message.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => handleOptionClick(option)}
                  className="block w-full text-left px-3 py-2 bg-white hover:bg-gray-50 rounded-lg text-sm transition-colors border border-gray-200"
                  disabled={isLoading}
                >
                  {option.imageUrl ? (
                    <div className="flex items-center space-x-2">
                      <img
                        src={option.imageUrl}
                        alt={option.label}
                        className="w-16 h-12 object-cover rounded"
                      />
                      <span>{option.label}</span>
                    </div>
                  ) : (
                    <div>
                      <div className="font-medium">{option.label}</div>
                      {option.sceneText && (
                        <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {option.sceneText}
                        </div>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Check if we should show text input
  const lastBotMessage = messages.filter((m) => m.type === "bot").pop();
  const showTextInput =
    lastBotMessage &&
    (lastBotMessage.content.includes("type") ||
      lastBotMessage.content.includes("describe") ||
      lastBotMessage.content.includes("What would you like"));

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.map(renderMessage)}
        {isLoading && (
          <div className="flex justify-start mb-4">
            <div className="bg-gray-100 rounded-2xl px-4 py-3">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      {showTextInput && !isLoading && (
        <div className="border-t p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleTextSubmit();
            }}
            className="flex space-x-2"
          >
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Type your response..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-black"
              disabled={isLoading}
              autoFocus
            />
            <button
              type="submit"
              disabled={!userInput.trim() || isLoading}
              className="p-2 bg-black text-white rounded-full hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
