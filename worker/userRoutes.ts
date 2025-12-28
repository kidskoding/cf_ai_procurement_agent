import { Hono } from "hono";
import { getAgentByName } from 'agents';
import { ChatAgent } from './agent';
import { API_RESPONSES } from './config';
import { Env, getAppController, registerSession, unregisterSession } from "./core-utils";
import { executeTool } from './tools';
export function coreRoutes(app: Hono<{ Bindings: Env }>) {
    app.all('/api/chat/:sessionId/*', async (c) => {
        try {
            // Validate Durable Object binding exists
            if (!c.env.CHAT_AGENT) {
                console.error('CHAT_AGENT binding is missing from environment');
                return c.json({
                    success: false,
                    error: 'CHAT_AGENT binding not configured. Please ensure Durable Objects are properly set up in wrangler.jsonc',
                    detail: 'Missing CHAT_AGENT binding'
                }, { status: 500 });
            }

            const sessionId = c.req.param('sessionId');
            if (!sessionId) {
                return c.json({
                    success: false,
                    error: 'Session ID is required'
                }, { status: 400 });
            }

            let agent;
            try {
              agent = await getAgentByName<Env, ChatAgent>(c.env.CHAT_AGENT, sessionId);
            } catch (agentError) {
              console.error('getAgentByName failed:', agentError);
              if (agentError instanceof Error) {
                console.error('Agent error message:', agentError.message);
                console.error('Agent error stack:', agentError.stack);
              }
              return c.json({
                success: false,
                error: 'Failed to initialize chat agent',
                detail: agentError instanceof Error ? agentError.message : String(agentError)
              }, { status: 500 });
            }

            const url = new URL(c.req.url);
            url.pathname = url.pathname.replace(`/api/chat/${sessionId}`, '');
            
            try {
              const agentRequest = new Request(url.toString(), {
                  method: c.req.method,
                  headers: c.req.header(),
                  body: c.req.method === 'GET' || c.req.method === 'DELETE' || c.req.method === 'HEAD'
                      ? undefined
                      : c.req.raw.body
              });
              
              console.log(`[Agent Request] ${c.req.method} ${url.pathname} for session ${sessionId}`);
              
              const agentResponse = await agent.fetch(agentRequest);
              
              // Check if the agent response itself is an error
              if (!agentResponse.ok) {
                const errorText = await agentResponse.text().catch(() => 'Unknown error');
                console.error('Agent returned error response:', {
                  status: agentResponse.status,
                  statusText: agentResponse.statusText,
                  body: errorText
                });
                
                // Try to parse as JSON, fallback to text
                let errorData: any;
                try {
                  errorData = JSON.parse(errorText);
                } catch {
                  errorData = { error: errorText || `Agent error: ${agentResponse.status}` };
                }
                
                return c.json({
                  success: false,
                  error: errorData.error || errorData.detail || `Agent error: ${agentResponse.status}`,
                  detail: errorData.detail || errorText
                }, agentResponse.status as any);
              }
              
              return agentResponse;
            } catch (fetchError) {
              console.error('Agent fetch failed:', fetchError);
              if (fetchError instanceof Error) {
                console.error('Fetch error message:', fetchError.message);
                console.error('Fetch error stack:', fetchError.stack);
              }
              return c.json({
                success: false,
                error: 'Failed to process agent request',
                detail: fetchError instanceof Error ? fetchError.message : String(fetchError)
              }, { status: 500 });
            }
        } catch (error) {
            console.error('Chat proxy /agent init failed (userRoutes proxy getAgentByName ChatAgent onStart):', error);
            if (error instanceof Error) {
                console.error('Error message:', error.message);
                console.error('Stack:', error.stack);
            }
            return c.json({
                success: false,
                error: API_RESPONSES.AGENT_ROUTING_FAILED,
                detail: error instanceof Error ? error.message : String(error)
            }, { status: 500 });
        }
    });
}
export function userRoutes(app: Hono<{ Bindings: Env }>) {
    // Webhook endpoint to receive supplier email responses from Resend
    app.post('/api/webhooks/emails', async (c) => {
        try {
            const body = await c.req.json() as any;
            
            console.log('[Email Webhook] Received payload:', JSON.stringify(body, null, 2));
            
            // Handle Resend incoming email format
            // Resend sends incoming emails with type 'email.inbound' or similar
            const { type, data } = body;
            
            // Accept inbound emails
            if (type && !type.includes('inbound') && type !== 'email.received') {
                return c.json({ success: true, message: 'Event type not for incoming emails' });
            }

            // Extract email info from Resend inbound format
            let from = data?.from?.email || data?.from;
            let subject = data?.subject || '';
            let emailBody = data?.text || data?.html || data?.body?.text || data?.body?.html || '';
            let supplierName = data?.from?.name || from?.split('@')[0] || 'Unknown';
            const emailId = data?.email_id;

            // Handle alternative payload formats
            if (!from && body.from) {
                from = body.from;
            }
            if (!subject && body.subject) {
                subject = body.subject;
            }
            if (!emailBody && body.text) {
                emailBody = body.text;
            }
            if (!emailBody && body.html) {
                emailBody = body.html;
            }
            if (!emailBody && body.body) {
                emailBody = body.body.text || body.body.html || '';
            }
            
            // If no email body but we have email_id, fetch content from Resend API
            if (!emailBody && emailId && c.env.RESEND_API_KEY) {
                try {
                    console.log(`[Email Webhook] Fetching email content for ID: ${emailId}`);
                    
                    // Use Resend's Retrieve Received Email API
                    const emailResponse = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${c.env.RESEND_API_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (emailResponse.ok) {
                        const emailData = await emailResponse.json();
                        emailBody = emailData.text || emailData.html || '';
                        if (emailBody) {
                            console.log(`✓ Retrieved email content: ${emailBody.substring(0, 100)}...`);
                        } else {
                            console.log('⚠️ Email data retrieved but no text/html content');
                        }
                    } else {
                        const errorText = await emailResponse.text();
                        console.log(`⚠️ Failed to fetch email: ${emailResponse.status} - ${errorText}`);
                    }
                } catch (error) {
                    console.error('Error fetching email content:', error);
                }
            }
            
            if (!from) {
                console.log('[Email Webhook] Skipping: no sender email found');
                return c.json({ success: true, message: 'No sender email in payload' });
            }

            console.log(`[Email Webhook] Processing incoming email from ${from}: ${subject}`);
            console.log(`[Email Body Debug]: ${emailBody ? emailBody.substring(0, 200) : 'NO BODY CONTENT'}`);

            // Try to extract price from email body using enhanced regex patterns
            let extractedPrice: number | null = null;
            
            if (emailBody) {
                const pricePatterns = [
                    /\$\s*(\d+(?:\.\d{2})?)/gi,                    // $450, $450.00
                    /price[:\s]*\$?\s*(\d+(?:\.\d{2})?)/gi,       // price: $450, price 450
                    /(\d+(?:\.\d{2})?)\s*(?:dollars?|usd)/gi,     // 450 dollars, 450.00 USD
                    /quote[:\s]*\$?\s*(\d+(?:\.\d{2})?)/gi,       // quote: $450
                    /cost[:\s]*\$?\s*(\d+(?:\.\d{2})?)/gi,        // cost: $450
                    /(\d+(?:\.\d{2})?)\s*per\s*unit/gi            // 450.00 per unit
                ];
                
                for (const pattern of pricePatterns) {
                    const matches = emailBody.match(pattern);
                    if (matches) {
                        for (const match of matches) {
                            const numbers = match.match(/(\d+(?:\.\d{2})?)/);
                            if (numbers) {
                                extractedPrice = parseFloat(numbers[1]);
                                console.log(`✓ Extracted price: $${extractedPrice} from pattern: ${match}`);
                                break;
                            }
                        }
                        if (extractedPrice) break;
                    }
                }
            }
            
            if (!extractedPrice) {
                console.log('⚠️ No price found in email body, storing without price');
            }

            // Store in SupplierResponses table
            const responseId = crypto.randomUUID();
            await c.env.SUPPLY_DB.prepare(`
                INSERT INTO SupplierResponses (id, supplier_email, supplier_name, price, response_text, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).bind(
                responseId,
                from,
                supplierName,
                extractedPrice,
                emailBody,
                new Date().toISOString()
            ).run();

            console.log(`✓ Stored supplier response: ${responseId} from ${from}`);
            return c.json({ success: true, id: responseId, price: extractedPrice });
        } catch (error) {
            console.error('Email webhook error:', error);
            return c.json({ 
                success: false, 
                error: error instanceof Error ? error.message : 'Webhook processing failed'
            }, { status: 500 });
        }
    });

    // System health and D1 binding verification
    app.get('/api/system/status', async (c) => {
        const status = {
            db: {
                binding: 'SUPPLY_DB',
                target: 'procurement-ai',
                connected: false,
                error: null as string | null
            },
            timestamp: Date.now()
        };
        try {
            if (!c.env.SUPPLY_DB) {
                status.db.error = 'Binding SUPPLY_DB missing';
            } else {
                // Verify connection with a lightweight query
                await c.env.SUPPLY_DB.prepare('SELECT 1').first();
                status.db.connected = true;
            }
        } catch (err: any) {
            status.db.error = err?.message || 'Connection failed';
        }
        return c.json({ success: true, data: status });
    });

    // Debug endpoint to check supplier responses
    app.get('/api/debug/supplier-responses', async (c) => {
        try {
            if (!c.env.SUPPLY_DB) {
                return c.json({ success: false, error: 'Database not configured' });
            }
            
            const { results } = await c.env.SUPPLY_DB.prepare(`
                SELECT id, supplier_name, supplier_email, price, response_text, created_at
                FROM SupplierResponses
                ORDER BY created_at DESC
                LIMIT 20
            `).all() as any;
            
            return c.json({ 
                success: true, 
                data: {
                    count: results?.length || 0,
                    responses: results || []
                }
            });
        } catch (error) {
            console.error('Debug endpoint error:', error);
            return c.json({ 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            });
        }
    });

    // Test endpoint to manually add supplier responses (for debugging)
    app.post('/api/debug/add-supplier-response', async (c) => {
        try {
            if (!c.env.SUPPLY_DB) {
                return c.json({ success: false, error: 'Database not configured' });
            }
            
            const { from, subject, message, price } = await c.req.json() as any;
            
            if (!from || !subject || !message) {
                return c.json({ 
                    success: false, 
                    error: 'Required fields: from, subject, message' 
                });
            }
            
            const supplierName = from.split('@')[0] || 'Unknown';
            const responseId = crypto.randomUUID();
            
            await c.env.SUPPLY_DB.prepare(`
                INSERT INTO SupplierResponses (id, supplier_email, supplier_name, price, response_text, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).bind(
                responseId,
                from,
                supplierName,
                price || null,
                message,
                new Date().toISOString()
            ).run();
            
            return c.json({ 
                success: true, 
                data: { 
                    id: responseId, 
                    from, 
                    subject, 
                    price 
                }
            });
        } catch (error) {
            console.error('Debug add response error:', error);
            return c.json({ 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            });
        }
    });

    // Database setup endpoint
    app.post('/api/debug/setup-db', async (c) => {
        try {
            if (!c.env.SUPPLY_DB) {
                return c.json({ success: false, error: 'Database not configured' });
            }
            
            // Create tables
            await c.env.SUPPLY_DB.prepare(`
                CREATE TABLE IF NOT EXISTS SupplierResponses (
                    id TEXT PRIMARY KEY,
                    supplier_email TEXT NOT NULL,
                    supplier_name TEXT NOT NULL,
                    price REAL,
                    response_text TEXT,
                    created_at TEXT NOT NULL
                )
            `).run();
            
            await c.env.SUPPLY_DB.prepare(`
                CREATE TABLE IF NOT EXISTS PurchaseOrders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    supplier_name TEXT NOT NULL,
                    supplier_email TEXT NOT NULL,
                    part_number TEXT NOT NULL,
                    order_date TEXT NOT NULL,
                    quantity INTEGER NOT NULL,
                    price REAL NOT NULL
                )
            `).run();
            
            return c.json({ success: true, message: 'Database setup completed' });
        } catch (error) {
            console.error('Database setup error:', error);
            return c.json({ 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            });
        }
    });

    // Clean up test data - remove entries without proper pricing or test entries
    app.post('/api/debug/cleanup-responses', async (c) => {
        try {
            if (!c.env.SUPPLY_DB) {
                return c.json({ success: false, error: 'Database not configured' });
            }
            
            // Delete test entries and entries without pricing
            const deleteResult = await c.env.SUPPLY_DB.prepare(`
                DELETE FROM SupplierResponses 
                WHERE price IS NULL 
                OR supplier_name = 'Dream Supply'
                OR supplier_name = 'dreamstan05' AND price = 430
            `).run();
            
            return c.json({ 
                success: true, 
                message: `Cleaned up ${deleteResult.changes || 0} test entries`
            });
        } catch (error) {
            console.error('Cleanup error:', error);
            return c.json({ 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            });
        }
    });

    app.get('/api/sessions', async (c) => {
        try {
            // Validate Durable Object binding exists
            if (!c.env.APP_CONTROLLER) {
                console.error('APP_CONTROLLER binding is missing from environment');
                return c.json({
                    success: false,
                    error: 'APP_CONTROLLER binding not configured. Please ensure Durable Objects are properly set up in wrangler.jsonc',
                    detail: 'Missing APP_CONTROLLER binding'
                }, { status: 500 });
            }

            const controller = getAppController(c.env);
            const sessions = await controller.listSessions();
            return c.json({ success: true, data: sessions });
        } catch (error) {
            console.error('AppController listSessions failed:', error);
            if (error instanceof Error) {
                console.error('Error message:', error.message);
                console.error('Stack:', error.stack);
            }
            // Return empty array in preview/stub mode, but log the actual error
            return c.json({ 
                success: true, 
                data: [],
                warning: error instanceof Error ? error.message : 'Failed to load sessions'
            });
        }
    });
    app.post('/api/sessions', async (c) => {
        try {
            // Validate Durable Object binding exists
            if (!c.env.APP_CONTROLLER) {
                console.error('APP_CONTROLLER binding is missing from environment');
                return c.json({
                    success: false,
                    error: 'APP_CONTROLLER binding not configured. Please ensure Durable Objects are properly set up in wrangler.jsonc',
                    detail: 'Missing APP_CONTROLLER binding'
                }, { status: 500 });
            }

            const body = await c.req.json().catch(() => ({}));
            const { title, sessionId: providedSessionId, firstMessage } = body as { title?: string; sessionId?: string; firstMessage?: string };
            const sessionId = providedSessionId || crypto.randomUUID();
            let sessionTitle = title;
            if (!sessionTitle) {
                const now = new Date();
                const dateTime = now.toLocaleString('en-US', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false
                });
                if (firstMessage && firstMessage.trim()) {
                    const cleanMessage = firstMessage.trim().replace(/\s+/g, ' ');
                    const truncated = cleanMessage.length > 35 ? cleanMessage.slice(0, 32) + '...' : cleanMessage;
                    sessionTitle = `${truncated} | ${dateTime}`;
                } else {
                    sessionTitle = `Inquiry ${dateTime}`;
                }
            }
            await registerSession(c.env, sessionId, sessionTitle);
            return c.json({ success: true, data: { sessionId, title: sessionTitle } });
        } catch (error) {
            console.error('Failed to create session:', error);
            if (error instanceof Error) {
                console.error('Error message:', error.message);
                console.error('Stack:', error.stack);
            }
            return c.json({ 
                success: false, 
                error: 'Failed to create session',
                detail: error instanceof Error ? error.message : String(error)
            }, { status: 500 });
        }
    });
    app.delete('/api/sessions/:sessionId', async (c) => {
        try {
            const sessionId = c.req.param('sessionId');
            const deleted = await unregisterSession(c.env, sessionId);
            if (!deleted) return c.json({ success: false, error: 'Session not found' }, { status: 404 });
            return c.json({ success: true, data: { deleted: true } });
        } catch (error) {
            console.error('Failed to delete session:', error);
            return c.json({ success: false, error: 'Failed to delete session' }, { status: 500 });
        }
    });
    app.put('/api/sessions/:sessionId/title', async (c) => {
        try {
            const sessionId = c.req.param('sessionId');
            const { title } = await c.req.json() as { title: string };
            if (!title || typeof title !== 'string') return c.json({ success: false, error: 'Title is required' }, { status: 400 });
            const controller = getAppController(c.env);
            const updated = await controller.updateSessionTitle(sessionId, title);
            if (!updated) return c.json({ success: false, error: 'Session not found' }, { status: 404 });
            return c.json({ success: true, data: { title } });
        } catch (error) {
            console.error('AppController updateSessionTitle failed (likely stub):', error);
            return c.json({ success: false, error: 'Session not found' }, { status: 404 });
        }
    });
    app.delete('/api/sessions', async (c) => {
        try {
            const controller = getAppController(c.env);
            const deletedCount = await controller.clearAllSessions();
            return c.json({ success: true, data: { deletedCount } });
        } catch (error) {
            console.error('AppController clearAllSessions failed (likely stub):', error);
            return c.json({ success: true, data: { deletedCount: 0 } });
        }
    });
}
