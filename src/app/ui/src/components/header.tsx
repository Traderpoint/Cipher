"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { HeaderProps } from "@/types/chat"
import { ActionBar } from "./action-bar"
import { LlmModelDisplay } from "./llm-model-display"

export function Header({
  currentSessionId,
  isWelcomeState,
  onToggleSearch,
  onToggleSessions,
  onToggleServers,
  isSessionsPanelOpen,
  isServersPanelOpen,
  onReturnToWelcome
}: HeaderProps) {
  return (
    <header className="shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="flex justify-between items-center px-4 py-3">
        <div className="flex items-center space-x-4">
          <button
            onClick={onReturnToWelcome}
            className="flex items-center space-x-3 hover:opacity-80 transition-opacity cursor-pointer group"
            title="Return to Welcome Screen"
          >
            <div className="flex items-center justify-center w-7 h-7 rounded-lg border border-border/50 text-primary-foreground group-hover:border-primary/50 transition-colors">
              <img src="/cipher-logo.png" alt="Cipher" className="w-4 h-4" />
            </div>
            <h1 className="text-base font-semibold tracking-tight group-hover:text-primary transition-colors">Cipher</h1>
          </button>

          <div className="flex items-center space-x-3">
            {currentSessionId && !isWelcomeState && (
              <Badge variant="outline" className="text-xs">
                {currentSessionId}
              </Badge>
            )}
            
            {/* LLM Model Display - Always show */}
            <LlmModelDisplay />
          </div>
        </div>

        <ActionBar 
          onToggleSearch={onToggleSearch}
          onToggleSessions={onToggleSessions}
          onToggleServers={onToggleServers}
          isSessionsPanelOpen={isSessionsPanelOpen}
          isServersPanelOpen={isServersPanelOpen}
        />
      </div>
    </header>
  );
}