import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
interface ErrorFallbackProps {
  error: string;
  stack?: string;
  resetErrorBoundary?: () => void;
}
export function ErrorFallback({
  error,
  stack,
  resetErrorBoundary,
}: ErrorFallbackProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px] w-full p-6 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center shadow-xl space-y-6">
        <div className="flex justify-center">
          <div className="p-3 bg-destructive/10 rounded-full">
            <AlertCircle className="h-10 w-10 text-destructive" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            System Alert
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 break-words leading-relaxed font-medium">
            {error}
          </p>
        </div>
        {stack && (
          <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-left overflow-auto max-h-[150px]">
            <pre className="text-[10px] text-slate-500 dark:text-slate-500 font-mono leading-tight whitespace-pre-wrap">
              {stack}
            </pre>
          </div>
        )}
        <div className="pt-2 flex flex-col gap-3">
          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            className="w-full flex items-center justify-center gap-2 rounded-xl"
          >
            <RotateCcw className="h-4 w-4" />
            Reload Terminal
          </Button>
          {resetErrorBoundary && (
            <Button
              onClick={resetErrorBoundary}
              className="w-full rounded-xl bg-slate-900 dark:bg-slate-100 dark:text-slate-900"
            >
              Recover Session
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}