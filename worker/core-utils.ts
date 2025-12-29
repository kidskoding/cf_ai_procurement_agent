/**
 * Core utilities for the Cloudflare Agents template
 * Provides access to Durable Object stubs and session registration.
 */
import type { AppController } from './app-controller';
import type { ChatAgent } from './agent';
export interface Env {
  // OpenAI Configuration
  OPENAI_API_KEY: string;
  // Cloudflare Workers AI Binding (for production)
  AI: Ai;
  // AI Gateway Configuration (legacy)
  CF_AI_BASE_URL: string;
  CF_AI_API_KEY: string;
  // Email Service (Resend)
  RESEND_API_KEY: string;
  // Persistence Bindings
  CHAT_AGENT: DurableObjectNamespace<ChatAgent>;
  APP_CONTROLLER: DurableObjectNamespace<AppController>;
  // External Procurement Database
  // Bound to D1 Database: "procurement-ai"
  SUPPLY_DB: D1Database;
}
/**
 * Get AppController stub for session management
 * Uses a singleton pattern with fixed ID for consistent routing
 */
export function getAppController(env: Env): DurableObjectStub<AppController> {
  if (!env.APP_CONTROLLER) {
    throw new Error('APP_CONTROLLER binding is not available. Please ensure Durable Objects are configured in wrangler.jsonc');
  }
  const id = env.APP_CONTROLLER.idFromName("controller");
  return env.APP_CONTROLLER.get(id);
}
/**
 * Register a new chat session with the control plane
 * Called automatically when a new ChatAgent is created
 */
export async function registerSession(env: Env, sessionId: string, title?: string): Promise<void> {
  try {
    if (!env.APP_CONTROLLER) {
      console.error('APP_CONTROLLER binding is missing - cannot register session');
      return;
    }
    const controller = getAppController(env);
    await controller.addSession(sessionId, title);
  } catch (error) {
    console.error('Failed to register session:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack:', error.stack);
    }
    // Don't throw - session should work even if registration fails
  }
}
/**
 * Update session activity timestamp
 * Called when a session receives messages
 */
export async function updateSessionActivity(env: Env, sessionId: string): Promise<void> {
  try {
    const controller = getAppController(env);
    await controller.updateSessionActivity(sessionId);
  } catch (error) {
    console.error('Failed to update session activity:', error);
    // Don't throw - this is non-critical
  }
}
/**
 * Unregister a session from the control plane
 * Called when a session is explicitly deleted
 */
export async function unregisterSession(env: Env, sessionId: string): Promise<boolean> {
  try {
    const controller = getAppController(env);
    return await controller.removeSession(sessionId);
  } catch (error) {
    console.error('Failed to unregister session:', error);
    return false;
  }
}
