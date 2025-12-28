import type {
  ChatState,
  ApiResponse,
  SessionInfo
} from './types';
export interface ChatResponse {
  success: boolean;
  data?: ChatState;
  error?: string;
  isPreview?: boolean;
}
const STORAGE_KEY = 'supply_scout_session_id';
export const MODELS = [
  { id: '@cf/meta/llama-3.3-70b-instruct-turbo', name: 'Llama 3.3 70B Turbo (Latest)' },
  { id: '@cf/meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B (High Reasoning)' },
  { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B (Fast)' },
  { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B (Fastest)' },
];
class ChatService {
  private sessionId: string;
  private baseUrl: string;
  constructor() {
    const savedSessionId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    this.sessionId = savedSessionId || crypto.randomUUID();
    this.baseUrl = `/api/chat/${this.sessionId}`;
    if (typeof window !== 'undefined' && !savedSessionId) {
      localStorage.setItem(STORAGE_KEY, this.sessionId);
    }
  }
  async sendMessage(
    message: string,
    model?: string,
    onChunk?: (chunk: string) => void
  ): Promise<ChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          model: model || '@cf/meta/llama-3.3-70b-instruct-turbo',
          stream: !!onChunk
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = (errorData.detail || errorData.error || `HTTP ${response.status}`).toString();
        const isPreview = detail.includes('SupplyScout ready') || detail.includes('Preview sandbox');
        return {
          success: false,
          error: detail,
          isPreview
        };
      }
      if (onChunk && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            if (chunk) {
              fullText += chunk;
              onChunk(chunk);
            }
          }
        } catch (streamError) {
          console.error('ChatService: Stream error', streamError);
          return { success: false, error: 'Connection interrupted' };
        } finally {
          reader.releaseLock();
        }
        return {
          success: true,
          isPreview: fullText.includes('SupplyScout ready') || fullText.includes('Preview sandbox')
        };
      }
      const result = await response.json();
      return {
        ...result,
        isPreview: result.isPreview || result.data?.messages?.some((m: any) => m.content?.includes('SupplyScout ready') || m.content?.includes('Preview sandbox'))
      };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Failed to send message' };
    }
  }
  async getMessages(): Promise<ChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/messages`);
      if (!response.ok) {
        let errorData: any = {};
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          try {
            errorData = await response.json();
          } catch (e) {
            console.error('Failed to parse error JSON:', e);
          }
        } else {
          const text = await response.text().catch(() => '');
          console.error('Non-JSON error response:', text);
          errorData = { error: text || `HTTP ${response.status}` };
        }
        const errorMessage = errorData.detail || errorData.error || `Terminal Sync Error (${response.status})`;
        console.error('getMessages error:', {
          status: response.status,
          statusText: response.statusText,
          errorMessage,
          errorData,
          url: `${this.baseUrl}/messages`
        });
        return { success: false, error: errorMessage };
      }
      return await response.json();
    } catch (error: any) {
      console.error('getMessages exception:', error);
      return { success: false, error: error?.message || 'Failed to load messages' };
    }
  }
  async clearMessages(): Promise<ChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/clear`, { method: 'DELETE' });
      return await response.json();
    } catch (error: any) {
      return { success: false, error: 'Failed to clear history' };
    }
  }
  async factoryReset(): Promise<ApiResponse> {
    try {
      const response = await fetch('/api/sessions', { method: 'DELETE' });
      const result = await response.json();
      if (result.success) {
        this.newSession();
      }
      return result;
    } catch (error: any) {
      return { success: false, error: 'Factory reset failed' };
    }
  }
  getSessionId(): string { return this.sessionId; }
  newSession(): void {
    this.sessionId = crypto.randomUUID();
    this.baseUrl = `/api/chat/${this.sessionId}`;
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, this.sessionId);
  }
  switchSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.baseUrl = `/api/chat/${sessionId}`;
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, this.sessionId);
  }
  async createSession(title?: string, sessionId?: string, firstMessage?: string): Promise<ApiResponse<{ sessionId: string; title: string }>> {
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, sessionId, firstMessage })
      });
      const result = await response.json();
      if (!response.ok) {
        console.error('createSession error:', result);
      }
      return result;
    } catch (error: any) {
      console.error('createSession exception:', error);
      return { success: false, error: error?.message || 'Failed to create session' };
    }
  }
  async listSessions(): Promise<ApiResponse<SessionInfo[]>> {
    try {
      const response = await fetch('/api/sessions');
      const result = await response.json();
      if (!response.ok) {
        console.error('listSessions error:', result);
      }
      return result;
    } catch (error: any) {
      console.error('listSessions exception:', error);
      return { success: false, error: error?.message || 'Failed to load sessions', data: [] };
    }
  }
  async updateModel(model: string): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model })
    });
    return await response.json();
  }
}
export const chatService = new ChatService();