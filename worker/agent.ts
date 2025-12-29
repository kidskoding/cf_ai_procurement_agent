import { Agent } from 'agents';
import type { Env } from './core-utils';
import type { ChatState, Message } from './types';
import { ChatHandler } from './chat';
import { API_RESPONSES } from './config';
import { createMessage, createStreamResponse, createEncoder } from './utils';
export class ChatAgent extends Agent<Env, ChatState> {
  private chatHandler?: ChatHandler;
  initialState: ChatState = {
    messages: [],
    sessionId: crypto.randomUUID(),
    isProcessing: false,
    model: 'gpt-4o-mini' // OpenAI model for local testing
  };
  async onStart(): Promise<void> {
    try {
      // Ensure state is initialized
      if (!this.state) {
        this.setState({ ...this.initialState });
      }
      
      // Force update model if it's invalid using proper setState method
      if (this.state?.model?.startsWith('@cf/') || !this.state?.model) {
        this.setState({ ...this.state, model: this.initialState.model });
      }
      
      // Ensure state is initialized before accessing it
      const model = this.state?.model || this.initialState.model;
      this.chatHandler = new ChatHandler(this.env, model);
      console.log('ChatAgent onStart: Initialized successfully with model:', model);
    } catch (error) {
      console.error('ChatAgent onStart critical failure:', error);
      if (error instanceof Error) {
        console.error('onStart error message:', error.message);
        console.error('onStart error stack:', error.stack);
      }
      // Don't throw - allow agent to continue even if ChatHandler fails
    }
  }
  async onRequest(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const method = request.method;
      if (method === 'GET' && url.pathname === '/messages') {
        try {
          // Ensure state is accessible
          const state = this.state || this.initialState;
          return Response.json({ success: true, data: state });
        } catch (stateError) {
          console.error('ChatAgent: Error accessing state:', stateError);
          if (stateError instanceof Error) {
            console.error('State error stack:', stateError.stack);
          }
          return Response.json({ 
            success: false, 
            error: 'Failed to access agent state',
            detail: stateError instanceof Error ? stateError.message : String(stateError)
          }, { status: 500 });
        }
      }
      if (method === 'POST' && url.pathname === '/chat') {
        const body = await request.json() as { message: string; model?: string; stream?: boolean };
        return this.handleChatMessage(body);
      }
      if (method === 'DELETE' && url.pathname === '/clear') {
        this.setState({ ...this.state, messages: [] });
        return Response.json({ success: true, data: this.state });
      }
      if (method === 'POST' && url.pathname === '/model') {
        const body = await request.json() as { model: string };
        const { model } = body;
        this.setState({ ...this.state, model });
        if (this.chatHandler) this.chatHandler.updateModel(model);
        return Response.json({ success: true, data: this.state });
      }
      return Response.json({ success: false, error: API_RESPONSES.NOT_FOUND }, { status: 404 });
    } catch (error) {
      console.error('ChatAgent onRequest failure:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      return Response.json({ 
        success: false, 
        error: API_RESPONSES.INTERNAL_ERROR,
        detail: error instanceof Error ? error.message : String(error)
      }, { status: 500 });
    }
  }
  private async handleChatMessage(body: { message: string; model?: string; stream?: boolean; isSystemNotification?: boolean }): Promise<Response> {
    const { message, model, stream, isSystemNotification } = body;
    if (!message?.trim()) return Response.json({ success: false, error: API_RESPONSES.MISSING_MESSAGE }, { status: 400 });
    
    // Handle system notifications differently
    if (isSystemNotification) {
      const notificationMessage = createMessage('assistant', message.trim());
      notificationMessage.isSystemNotification = true;
      const updatedMessages = [...this.state.messages, notificationMessage];
      this.setState({ ...this.state, messages: updatedMessages });
      return Response.json({ success: true, data: this.state });
    }
    
    const activeModel = model || this.state.model;
    if (!this.chatHandler) {
      this.chatHandler = new ChatHandler(this.env, activeModel, this.state.sessionId);
    } else {
      // Ensure ChatHandler always has the current session_id
      this.chatHandler.setSessionId(this.state.sessionId);
    }
    if (model && model !== this.state.model) {
      this.setState({ ...this.state, model });
      this.chatHandler = new ChatHandler(this.env, model, this.state.sessionId);
      // Model updated - create new ChatHandler with new model and current session_id
    }
    const userMessage = createMessage('user', message.trim());
    const updatedMessages = [...this.state.messages, userMessage];
    this.setState({ ...this.state, messages: updatedMessages, isProcessing: true });
    try {
      if (stream) {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = createEncoder();
        (async () => {
          let lastStreamingText = '';
          let updateCounter = 0;
          try {
            const response = await this.chatHandler!.processMessage(
              message,
              updatedMessages,
              (chunk: string) => {
                lastStreamingText += chunk;
                updateCounter++;
                // Only update state every 5 chunks to reduce excessive updates
                if (updateCounter % 5 === 0) {
                  this.setState({ ...this.state, streamingMessage: lastStreamingText });
                }
                writer.write(encoder.encode(chunk)).catch(() => {});
              }
            );
            const newHistory: Message[] = [...updatedMessages];
            // 1. If tools were called, first push the assistant message containing tool calls
            if (!response.isPreview && response.toolCalls && response.toolCalls.length > 0) {
              newHistory.push({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                toolCalls: response.toolCalls.map(tc => ({
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments
                }))
              });
              // 2. Push tool result messages
              response.toolCalls.forEach(tc => {
                newHistory.push({
                  id: crypto.randomUUID(),
                  role: 'tool',
                  content: JSON.stringify(tc.result),
                  timestamp: Date.now(),
                  tool_call_id: tc.id
                });
              });
            }
            // 3. Finally push the summary assistant message with metadata for the UI
            const assistantFinal = createMessage('assistant', response.content || 'Audit complete.');
            if (response.toolCalls && response.toolCalls.length > 0) {
              assistantFinal.toolCalls = response.toolCalls;
            }
            newHistory.push(assistantFinal);
            this.setState({
              ...this.state,
              messages: newHistory,
              isProcessing: false,
              streamingMessage: ''
            });
          } catch (error) {
            console.error('Streaming error:', error);
            const errorMsg = "\n\n*Terminal protocol synchronization failed.*";
            writer.write(encoder.encode(errorMsg)).catch(() => {});
            this.setState({ ...this.state, isProcessing: false, streamingMessage: '' });
          } finally {
            writer.close().catch(() => {});
          }
        })();
        return createStreamResponse(readable);
      }
      const response = await this.chatHandler.processMessage(message, updatedMessages);
      const newHistory: Message[] = [...updatedMessages];
      if (!response.isPreview && response.toolCalls && response.toolCalls.length > 0) {
        newHistory.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          toolCalls: response.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments
          }))
        });
        response.toolCalls.forEach(tc => {
          newHistory.push({
            id: crypto.randomUUID(),
            role: 'tool',
            content: JSON.stringify(tc.result),
            timestamp: Date.now(),
            tool_call_id: tc.id
          });
        });
      }
      const assistantMessage = createMessage('assistant', response.content || 'Audit complete.');
      if (response.toolCalls && response.toolCalls.length > 0) {
        assistantMessage.toolCalls = response.toolCalls;
      }
      newHistory.push(assistantMessage);
      this.setState({
        ...this.state,
        messages: newHistory,
        isProcessing: false
      });
      return Response.json({ success: true, data: this.state, isPreview: response.isPreview });
    } catch (error) {
      console.error('Non-streaming chat error:', error);
      this.setState({ ...this.state, isProcessing: false, streamingMessage: '' });
      return Response.json({ success: false, error: API_RESPONSES.PROCESSING_ERROR }, { status: 500 });
    }
  }
}