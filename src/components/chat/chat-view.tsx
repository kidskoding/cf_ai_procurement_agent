import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, PackageSearch, Trash2, PlusCircle, Database, ShieldCheck, AlertTriangle, Settings2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { chatService } from '@/lib/chat';
import { MessageBubble } from '@/components/chat/message-bubble';
import type { Message } from '@/lib/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
export function ChatView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [dbStatus, setDbStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [streamingText, setStreamingText] = useState('');
  const [isPreview, setIsPreview] = useState(false);
  const [currentModel, setCurrentModel] = useState('gpt-4o-mini');
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);
  const checkDb = useCallback(async () => {
    try {
      const res = await fetch('/api/system/status');
      const json = await res.json();
      if (isMounted.current) {
        if (json.success && json.data?.db?.connected) {
          setDbStatus('online');
        } else {
          setDbStatus('offline');
        }
      }
    } catch (err) {
      if (isMounted.current) setDbStatus('offline');
    }
  }, []);
  const loadMessages = useCallback(async () => {
    try {
      const res = await chatService.getMessages();
      if (isMounted.current) {
        if (!res.success) {
          console.error('loadMessages failed:', res.error);
          toast.error(res.error || 'Failed to load messages');
        } else if (res.data && Array.isArray(res.data.messages)) {
          setMessages(res.data.messages);
          setCurrentModel(res.data.model || 'gpt-4o-mini');
          const hasSandboxMsg = res.data.messages.some(m => m.content?.includes('Procurement AI Agent ready') || m.content?.includes('Preview sandbox'));
          if (hasSandboxMsg) setIsPreview(true);
        }
      }
    } catch (err) {
      console.error('ChatView: loadMessages exception', err);
      if (isMounted.current) {
        toast.error('Failed to load messages');
      }
    } finally {
      if (isMounted.current) setIsInitializing(false);
    }
  }, []);

  // Auto-polling for new messages (dynamic notifications)
  useEffect(() => {
    let pollInterval: NodeJS.Timeout;
    
    const startPolling = () => {
      pollInterval = setInterval(async () => {
        if (isMounted.current && !isLoading && !streamingText) {
          try {
            const res = await chatService.getMessages();
            if (res.success && res.data && Array.isArray(res.data.messages)) {
              const newMessageCount = res.data.messages.length;
              const currentMessageCount = messages.length;
              
              if (newMessageCount > currentMessageCount) {
                console.log(`📧 Detected ${newMessageCount - currentMessageCount} new messages`);
                setMessages(res.data.messages);
                
                // Check if the new message is a system notification
                const latestMessage = res.data.messages[res.data.messages.length - 1];
                if (latestMessage?.isSystemNotification) {
                  toast.success('📧 New supplier response received!', {
                    duration: 5000
                  });
                }
              }
            }
          } catch (err) {
            console.error('Polling error:', err);
          }
        }
      }, 2000); // Poll every 2 seconds
    };

    // Start polling when component is active
    if (!isInitializing && messages.length > 0) {
      startPolling();
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [isInitializing, isLoading, streamingText, messages.length]);
  useEffect(() => {
    const init = async () => {
      try {
        await checkDb();
        
        // Auto-clear previous sessions and start fresh every time
        console.log('ChatView: Auto-clearing previous sessions for fresh start');
        const factoryResetRes = await chatService.factoryReset();
        
        if (isMounted.current) {
          if (factoryResetRes.success) {
            console.log('ChatView: Successfully cleared previous sessions');
            setMessages([]);
            setStreamingText('');
          } else {
            console.warn('ChatView: Factory reset failed, continuing with existing sessions');
          }
        }
        
        if (isMounted.current) await loadMessages();
      } catch (err) {
        console.error('ChatView: init exception', err);
        if (isMounted.current) {
          setIsInitializing(false);
          toast.error('Failed to initialize chat');
        }
      }
    };
    init();
  }, [loadMessages, checkDb]);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior
      });
    }
  }, []);
  useEffect(() => {
    if (messages.length > 0 || streamingText) {
      scrollToBottom(streamingText ? 'auto' : 'smooth');
    }
  }, [messages, streamingText, scrollToBottom]);
  const handleClearChat = useCallback(async () => {
    try {
      const res = await chatService.clearMessages();
      if (res.success && isMounted.current) {
        setMessages([]);
        setStreamingText('');
        setIsPreview(false);
        toast.success("Terminal history purged");
      }
    } catch (error) {
      toast.error("Purge failed");
    }
  }, []);
  const handleFactoryReset = useCallback(async () => {
    const confirm = window.confirm("CAUTION: This will delete all history permanently. Proceed?");
    if (!confirm) return;
    try {
      setIsLoading(true);
      const res = await chatService.factoryReset();
      if (res.success) {
        if (isMounted.current) {
          setMessages([]);
          setStreamingText('');
        }
        toast.success("Factory Reset complete.");
        window.location.reload();
      }
    } catch (err) {
      toast.error("Reset failed");
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  }, []);
  const handleNewSession = useCallback(() => {
    chatService.newSession();
    if (isMounted.current) {
      setMessages([]);
      setStreamingText('');
      setIsPreview(false);
    }
    toast.info("New inquiry terminal initialized");
  }, []);
  const handleSend = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const userMsg = input.trim();
    if (!userMsg || isLoading) return;
    setInput('');
    setIsLoading(true);
    setStreamingText('');
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMsg,
      timestamp: Date.now()
    }]);
    try {
      const currentMessages = await chatService.getMessages();
      if (isMounted.current && !currentMessages.data?.messages?.length) {
        const sessionRes = await chatService.createSession(undefined, chatService.getSessionId(), userMsg);
        if (!sessionRes.success) {
          console.error('createSession failed:', sessionRes.error);
          toast.error(sessionRes.error || 'Failed to create session');
          if (isMounted.current) {
            setIsLoading(false);
            setStreamingText('');
          }
          return;
        }
      }
      const res = await chatService.sendMessage(userMsg, currentModel, (chunk) => {
        if (isMounted.current) setStreamingText(prev => prev + chunk);
      });
      if (isMounted.current) {
        if (res.isPreview) setIsPreview(true);
        if (!res.success && !res.isPreview) {
          toast.error(res.error || "Terminal protocol failure");
        }
        await loadMessages();
      }
    } catch (error) {
      console.error('handleSend exception:', error);
      toast.error("Synchronization lost");
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
        setStreamingText('');
      }
    }
  }, [input, isLoading, loadMessages, currentModel]);
  return (
    <div className="flex flex-col h-full w-full border bg-background relative shadow-2xl rounded-2xl overflow-hidden min-h-0 ring-1 ring-border/50">
      <header className="px-6 py-4 border-b flex items-center justify-between bg-card/90 backdrop-blur-xl sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
            <div className="relative w-11 h-11 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-xl ring-1 ring-white/10">
              <PackageSearch className="w-6 h-6" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-base font-bold tracking-tight text-foreground">Procurement AI</h1>
              {isPreview ? (
                <Badge variant="destructive" className="text-[9px] h-4.5 px-1.5 font-bold uppercase tracking-wider bg-orange-500 text-white border-orange-600">
                  Sandbox
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] h-4.5 px-1.5 font-bold uppercase tracking-wider bg-primary/5 text-primary border-primary/20">
                  Live
                </Badge>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center cursor-help">
                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full animate-pulse",
                      dbStatus === 'online' ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)]" :
                      dbStatus === 'checking' ? "bg-amber-500" : "bg-destructive shadow-[0_0_10px_rgba(239,68,68,0.6)]"
                    )} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-[11px] p-3 max-w-[200px] leading-relaxed">
                  <p className="font-bold flex items-center gap-1.5 text-foreground mb-1">
                    <Database className="w-3 h-3 text-primary" /> ERP Live Sync
                  </p>
                  <p className="text-muted-foreground">Status: <span className="font-mono text-primary uppercase">{dbStatus}</span></p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.1em] font-bold flex items-center gap-1 mt-0.5">
              <ShieldCheck className="w-3 h-3" /> GPT-4o-mini
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={handleNewSession} disabled={isLoading} className="rounded-xl h-10 w-10">
            <PlusCircle className="w-5 h-5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" disabled={isLoading} className="rounded-xl h-10 w-10">
                <Settings2 className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-xl">
              <DropdownMenuLabel>System Controls</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleClearChat} className="text-foreground cursor-pointer">
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Session Logs
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleFactoryReset} className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer">
                <RefreshCw className="w-4 h-4 mr-2" />
                Global System Reset
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 md:p-8 space-y-10 scrollbar-thin">
          {isInitializing ? (
            <div className="h-full flex flex-col items-center justify-center space-y-6 py-24">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest animate-pulse">Initializing Terminal...</p>
            </div>
          ) : messages.length === 0 && !isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-8 py-20 max-w-md mx-auto">
              <div className="w-24 h-24 rounded-[2.5rem] bg-muted/30 flex items-center justify-center border-2 border-dashed border-muted-foreground/20">
                <Database className="w-12 h-12 text-muted-foreground/30" />
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-bold tracking-tight text-foreground">ERP Records Linked</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Ready for historical audits. Inquire about <span className="text-foreground font-semibold">parts, prices, or vendor performance</span>.
                </p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
              {streamingText && (
                <MessageBubble
                  message={{ id: 'streaming', role: 'assistant', content: streamingText, timestamp: Date.now() }}
                />
              )}
            </>
          )}
          {isLoading && !streamingText && (
            <div className="flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="w-9 h-9 rounded-xl bg-muted/80 flex items-center justify-center border shadow-sm shrink-0">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              </div>
              <div className="bg-muted/30 px-5 py-3 rounded-2xl rounded-tl-none text-xs font-semibold text-muted-foreground border border-border/50">
                Querying Internal ERP...
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="p-6 md:p-8 border-t bg-card/60 backdrop-blur-xl relative">
        {isPreview && (
          <div className="max-w-4xl mx-auto mb-4 p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/50 rounded-xl flex items-start gap-3 text-orange-800 dark:text-orange-400 animate-in fade-in slide-in-from-bottom-2">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <p className="font-bold mb-1">Preview Sandbox Mode</p>
              <p>The AI Gateway is unconfigured. Live ERP queries are simulated for demonstration.</p>
            </div>
          </div>
        )}
        <form onSubmit={handleSend} className="relative flex gap-3 max-w-4xl mx-auto items-end">
          <div className="relative flex-1">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Inquire about parts (e.g. M3 bolts)..."
              className="relative pr-14 py-8 rounded-2xl bg-background/50 border-border/50 focus-visible:ring-primary text-sm font-medium shadow-inner"
              disabled={isLoading || isInitializing}
            />
          </div>
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading}
            className={cn(
              "absolute right-2.5 bottom-2.5 h-11 w-11 rounded-xl transition-all duration-300 shadow-lg",
              input.trim() ? "bg-primary scale-100" : "bg-muted scale-95"
            )}
          >
            <Send className="w-5 h-5" />
          </Button>
        </form>
      </div>
    </div>
  );
}