"use client";

import { useState } from "react";
import {
  Plus,
  ChevronDown,
  Mic,
  Sparkles,
  X,
  FolderKanban,
} from "lucide-react";

export function ChatComposer() {
  const [showBanner, setShowBanner] = useState(true);
  const [inputValue, setInputValue] = useState("");

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Main composer container */}
      <div className="bg-[#141414] rounded-2xl p-3">
        {/* Text input area */}
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="to change..."
          className="w-full bg-transparent text-gray-200 placeholder-gray-500 text-sm resize-none outline-none min-h-[60px] px-1"
          rows={2}
        />

        {/* Bottom toolbar */}
        <div className="mt-2 flex items-center justify-between pt-2">
          {/* Left side buttons */}
          <div className="flex items-center gap-1.5">
            {/* Plus button */}
            <button
              type="button"
              className="flex items-center justify-center size-7 rounded-lg bg-[#1f1f1f] hover:bg-[#2a2a2a] transition-colors text-gray-400 hover:text-gray-300"
            >
              <Plus className="size-4" />
            </button>

            {/* Model selector */}
            <button
              type="button"
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[#1f1f1f] hover:bg-[#2a2a2a] transition-colors text-gray-400 hover:text-gray-300"
            >
              <Sparkles className="size-3.5" />
              <span className="text-xs font-medium">test</span>
              <ChevronDown className="size-3" />
            </button>
          </div>

          {/* Right side buttons */}
          <div className="flex items-center gap-1.5">
            {/* Project dropdown */}
            <button
              type="button"
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[#1f1f1f] hover:bg-[#2a2a2a] transition-colors text-gray-400 hover:text-gray-300"
            >
              <FolderKanban className="size-3.5" />
              <span className="text-xs font-medium">Project</span>
              <ChevronDown className="size-3" />
            </button>

            {/* Microphone button */}
            <button
              type="button"
              className="flex items-center justify-center size-7 rounded-lg bg-[#1f1f1f] hover:bg-[#2a2a2a] transition-colors text-gray-400 hover:text-gray-300"
            >
              <Mic className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Dismissible upgrade banner */}
      {showBanner && (
        <div className="flex items-center justify-between mt-3 px-3 py-2.5 bg-[#141414] rounded-xl">
          <p className="text-xs text-gray-400">
            Upgrade to Team to unlock all of v0's features and more credits
          </p>
          <div className="flex items-center gap-3">
            <a
              href="#"
              className="text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors whitespace-nowrap"
            >
              Upgrade Plan
            </a>
            <button
              type="button"
              onClick={() => setShowBanner(false)}
              className="text-gray-500 hover:text-gray-400 transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
