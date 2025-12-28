import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { User, Bot, Info } from 'lucide-react';
import { SupplierTable } from '@/components/chat/supplier-table';

interface MessageBubbleProps {
  message: Message;
}

// Safe markdown wrapper with error boundary
function SafeMarkdown({ 
  content, 
  ReactMarkdown, 
  onError 
}: { 
  content: string;
  ReactMarkdown: any;
  onError: () => void;
}) {
  try {
    return (
      <ReactMarkdown 
        components={{
          // Custom components for better styling
          h2: ({ children, ...props }: any) => (
            <h2 className="text-lg font-bold mt-4 mb-3 text-foreground" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }: any) => (
            <h3 className="text-base font-semibold mt-3 mb-2 text-foreground" {...props}>
              {children}
            </h3>
          ),
          strong: ({ children, ...props }: any) => (
            <strong className="font-bold text-foreground" {...props}>
              {children}
            </strong>
          ),
          p: ({ children, ...props }: any) => (
            <p className="mb-2 leading-relaxed" {...props}>
              {children}
            </p>
          ),
          ul: ({ children, ...props }: any) => (
            <ul className="list-disc ml-4 mb-2" {...props}>
              {children}
            </ul>
          ),
          li: ({ children, ...props }: any) => (
            <li className="mb-1" {...props}>
              {children}
            </li>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    );
  } catch (error) {
    console.warn('Markdown rendering failed:', error);
    onError();
    return null;
  }
}

// Pre-process markdown to convert tables to HTML before ReactMarkdown processes them
function preprocessMarkdownTables(content: string): string {
  // Split content by lines
  const lines = content.split('\n');
  const processedLines: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check if this looks like a table row
    if (line.includes('|') && line.split('|').length > 2) {
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      tableRows.push(line);
      
      // Check if next line is a separator or end of table
      const nextLine = lines[i + 1]?.trim() || '';
      if (!nextLine.includes('|') || nextLine.match(/^[\|\s\-:]+$/)) {
        // Skip separator line if it exists
        if (nextLine.match(/^[\|\s\-:]+$/)) {
          i++; // Skip the separator line
        }
        continue;
      }
    } else if (inTable && tableRows.length > 0) {
      // End of table, convert to HTML
      processedLines.push(convertTableToHTML(tableRows));
      tableRows = [];
      inTable = false;
      
      if (line.trim()) {
        processedLines.push(line);
      }
    } else {
      if (line.trim()) {
        processedLines.push(line);
      }
    }
  }
  
  // Handle any remaining table at end of content
  if (inTable && tableRows.length > 0) {
    processedLines.push(convertTableToHTML(tableRows));
  }
  
  return processedLines.join('\n');
}

// Convert table rows to HTML
function convertTableToHTML(tableRows: string[]): string {
  if (tableRows.length === 0) return '';
  
  const [headerRow, ...dataRows] = tableRows;
  const headerCells = headerRow.split('|').slice(1, -1).map(cell => cell.trim());
  
  let html = '<div class="my-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">';
  html += '<table class="min-w-full text-sm">';
  
  // Header
  html += '<thead class="bg-slate-50 dark:bg-slate-800">';
  html += '<tr>';
  headerCells.forEach(cell => {
    html += `<th class="border-b border-slate-200 dark:border-slate-700 px-4 py-2 text-left font-semibold text-slate-700 dark:text-slate-300">${cell}</th>`;
  });
  html += '</tr>';
  html += '</thead>';
  
  // Body
  html += '<tbody class="bg-white dark:bg-slate-900">';
  dataRows.forEach((row, index) => {
    const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
    const rowClass = index % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/50';
    html += `<tr class="${rowClass} hover:bg-slate-100 dark:hover:bg-slate-700">`;
    cells.forEach(cell => {
      html += `<td class="border-b border-slate-200 dark:border-slate-700 px-4 py-2 text-slate-800 dark:text-slate-200">${cell}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';
  html += '</table>';
  html += '</div>';
  
  return html;
}

// Convert markdown to safe HTML manually for fallback
function formatTextContent(content: string): string {
  return content
    // Convert headers first
    .replace(/^\*\*(.*?)\*\*:/gm, '<div class="font-bold text-lg mt-4 mb-2 text-slate-800 dark:text-slate-200">$1:</div>')
    .replace(/^\*\*(.*?)\*\*/gm, '<strong class="font-bold text-slate-800 dark:text-slate-200">$1</strong>')
    // Convert emoji headers  
    .replace(/^(🏢|📊|💡|📈|🔍|📋|🟢|💻|🧠|💾|🔧) \*\*(.*?)\*\*/gm, '<div class="font-bold text-base mt-3 mb-2 text-slate-800 dark:text-slate-200">$1 $2</div>')
    // Convert bullet points with proper spacing
    .replace(/^• (.+)/gm, '<div class="ml-4 my-1 text-slate-700 dark:text-slate-300">• $1</div>')
    // Convert italicized text
    .replace(/\*(.*?)\*/g, '<em class="italic text-slate-600 dark:text-slate-400">$1</em>')
    // Add proper line breaks between sections
    .replace(/\n\n/g, '<div class="my-3"></div>')
    // Convert remaining single line breaks
    .replace(/\n/g, '<br>');
}
export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [md, setMd] = useState<{ReactMarkdown: any} | null>(null);
  const [markdownError, setMarkdownError] = useState(false);
  
  useEffect(() => {
    let cancelled = false;
    // Only import react-markdown, skip remark-gfm to avoid compatibility issues
    import('react-markdown').then((markdown) => {
      if (!cancelled) {
        setMd({ ReactMarkdown: markdown.default });
      }
    }).catch(() => {
      if (!cancelled) {
        setMarkdownError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (message.role === 'tool' || (message.role === 'assistant' && !message.content?.trim() && message.toolCalls?.length)) {
    return null;
  }
  const supplierResult = message.toolCalls?.find(tc => tc.name === 'find_suppliers')?.result as any;
  const suppliers = supplierResult?.suppliers;
  return (
    <div className={cn(
      "flex items-start gap-4 group animate-in fade-in duration-300 w-full",
      isUser ? "flex-row-reverse" : "flex-row"
    )}>
      <Avatar className={cn(
        "w-9 h-9 border shadow-sm shrink-0 mt-1",
        isUser ? "bg-primary text-primary-foreground" : "bg-slate-100 dark:bg-slate-800"
      )}>
        <AvatarFallback className="text-xs font-bold">
          {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={cn(
        "max-w-[92%] md:max-w-[85%] flex flex-col gap-2",
        isUser ? "items-end" : "items-start"
      )}>
        <div className={cn(
          "rounded-2xl px-5 py-3.5 shadow-sm border overflow-hidden transition-all duration-200",
          isUser
            ? "bg-primary text-primary-foreground border-primary rounded-tr-none"
            : "bg-card text-foreground rounded-tl-none border-border"
        )}>
          <div className={cn(
            md && !markdownError ?
              "prose prose-sm dark:prose-invert max-w-none break-words prose-headings:text-inherit prose-a:underline prose-a:font-medium prose-table:text-xs prose-table:border prose-table:border-border prose-th:border prose-th:border-border prose-th:bg-muted prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1" :
              "whitespace-pre-wrap break-words text-sm leading-relaxed",
            isUser ? "text-primary-foreground prose-a:text-white" : "text-foreground prose-a:text-primary"
          )}>
            {md && !markdownError ? (
              <SafeMarkdown 
                content={message.content ?? ''} 
                ReactMarkdown={md.ReactMarkdown}
                onError={() => setMarkdownError(true)}
              />
            ) : (
              <div dangerouslySetInnerHTML={{ __html: formatTextContent(message.content ?? '') }} />
            )}
          </div>
          <div className={cn(
            "text-[10px] mt-2 opacity-60 font-medium",
            isUser ? "text-right" : "text-left"
          )}>
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        {!isUser && suppliers && Array.isArray(suppliers) && suppliers.length > 0 && (
          <div className="w-full mt-2 animate-in slide-in-from-top-2 duration-500">
            <div className="flex items-center gap-2 mb-2 px-1">
              <div className="h-[1px] flex-1 bg-border/50" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <Info className="w-3 h-3" /> Verified Records
              </span>
              <div className="h-[1px] flex-1 bg-border/50" />
            </div>
            <SupplierTable suppliers={suppliers} />
          </div>
        )}
      </div>
    </div>
  );
}