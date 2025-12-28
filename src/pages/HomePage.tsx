import { ChatView } from '@/components/chat/chat-view';
import { Toaster } from '@/components/ui/sonner';
import { ThemeToggle } from '@/components/ThemeToggle';
export function HomePage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col transition-colors duration-300">
      <ThemeToggle className="fixed top-4 right-4" />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col">
        <div className="py-6 md:py-10 flex-1 flex flex-col items-center min-h-0">
          <div className="w-full max-w-4xl flex-1 flex flex-col min-h-0">
            <ChatView />
          </div>
        </div>
      </main>
      <footer className="w-full border-t border-border/40 bg-background/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-[10px] text-muted-foreground/60 select-none uppercase tracking-widest font-semibold dark:text-slate-400">
            SupplyScout v1.0.0 Terminal
          </p>
          <p className="text-[10px] text-center text-muted-foreground/40 max-w-md leading-relaxed dark:text-slate-500">
            <strong>Notice:</strong> AI request limits apply. Data retrieved from internal ERP bindings. Subject to procurement compliance policies.
          </p>
        </div>
      </footer>
      <Toaster richColors closeButton position="top-right" />
    </div>
  );
}