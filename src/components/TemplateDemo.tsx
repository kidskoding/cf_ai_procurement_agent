import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Send, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { chatService, MODELS } from '@/lib/chat'
import type { ChatState, Message } from '../../worker/types'

export const HAS_TEMPLATE_DEMO = true

export function TemplateDemo() {
  const [model, setModel] = useState(MODELS[0]?.id ?? 'google-ai-studio/gemini-2.0-flash')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const loadMessages = useCallback(async () => {
    const res = await chatService.getMessages()
    if (res.success && res.data) {
      const data = res.data as ChatState
      setMessages(data.messages)
    }
  }, [])

  useEffect(() => {
    loadMessages().catch(() => {})
  }, [loadMessages])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setLoading(true)

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now() }
    setMessages((prev) => [...prev, userMsg])

    const res = await chatService.sendMessage(text, model)
    if (res.success) await loadMessages()
    setLoading(false)
  }

  return (
    <Card className="max-w-5xl mx-auto h-[55vh] flex flex-col backdrop-blur-xl bg-white/10 dark:bg-black/20 border-white/20 shadow-2xl">
      <div className="p-4 border-b flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center">
          <Bot className="w-4 h-4 text-white" />
        </div>
        <h2 className="font-display font-bold text-lg">Chat demo</h2>

        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="w-56 ml-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Try asking: <span className="font-medium">"What tools do you have?"</span>
          </div>
        ) : null}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
              <div className="flex items-center gap-2 mb-1 opacity-80">
                {m.role === 'user' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                <span className="text-xs">{new Date(m.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="p-4 border-t flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          send().catch(() => {})
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={loading ? 'Waiting for response…' : 'Send a message'}
          className="min-h-[44px] max-h-28"
        />
        <Button type="submit" disabled={loading || !input.trim()} className="shrink-0">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </Card>
  )
}
