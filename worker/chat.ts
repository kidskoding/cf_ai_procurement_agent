import OpenAI from 'openai';
import type { Message, ToolCall } from './types';
import type { Env } from './core-utils';
import { getToolDefinitions, executeTool } from './tools';
export class ChatHandler {
  private client: OpenAI | null = null;
  private model: string;
  private env: Env;
  private sessionId: string;
  private initError: string | null = null;
  private isPreviewMode: boolean = false;
  private readonly DEFAULT_MODEL = 'gpt-4o-mini';
  
  constructor(env: Env, model: string, sessionId?: string) {
    this.env = env;
    this.model = model || this.DEFAULT_MODEL;
    this.sessionId = sessionId || 'unknown-session';
    
    try {
      const apiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not found');
      }
      this.client = new OpenAI({ apiKey });
      console.log('OpenAI SDK initialized successfully');
    } catch (error) {
      this.initError = error instanceof Error ? error.message : String(error);
      console.error('OpenAI initialization error:', this.initError);
      this.isPreviewMode = true;
    }
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId || 'unknown-session';
  }

  updateModel(model: string): void {
    this.model = model || this.DEFAULT_MODEL;
  }

  async processMessage(
    message: string,
    conversationHistory: Message[],
    onChunk?: (chunk: string) => void
  ): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    isPreview?: boolean;
  }> {
    if (!this.client) {
      const errorMsg = `AI not configured: ${this.initError || 'OpenAI SDK not initialized'}`;
      console.error(errorMsg);
      return { content: errorMsg, isPreview: true };
    }
    
    const messages = this.buildConversationMessages(message, conversationHistory);
    
    const tools = await getToolDefinitions();
    const openaiTools = tools.map(tool => ({
      type: 'function' as const,
      function: tool.function
    }));
    
    try {
      console.log('Calling OpenAI with proper function calling, model:', this.model);
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content
        })),
        tools: openaiTools,
        tool_choice: 'auto',
        max_tokens: 1000,
        temperature: 0.7
      });
      
      console.log('OpenAI response received, stop_reason:', response.choices[0]?.finish_reason);
      
      const choice = response.choices[0];
      if (!choice) {
        return { content: 'No response from AI' };
      }
      
      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        console.log('✓ AI called tools autonomously:', choice.message.tool_calls.length);
        
        const toolCalls: ToolCall[] = [];
        let finalContent = choice.message.content || '';
        
        for (const toolCall of choice.message.tool_calls) {
          try {
            const args = typeof toolCall.function.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;
            
            // Inject session_id for procurement tools
            if (toolCall.function.name === 'send_bulk_procurement_request' || 
                toolCall.function.name === 'start_procurement_request' ||
                toolCall.function.name === 'send_supplier_email') {
              args.session_id = this.sessionId;
            }
            
            console.log(`✓ Executing tool: ${toolCall.function.name}`, args);
            const result = await executeTool(toolCall.function.name, args, this.env);
            
            toolCalls.push({
              id: toolCall.id,
              name: toolCall.function.name,
              arguments: args,
              result
            });
            
            messages.push({
              role: 'assistant',
              content: finalContent || ' ',
              tool_calls: [{
                id: toolCall.id,
                type: 'function',
                function: {
                  name: toolCall.function.name,
                  arguments: JSON.stringify(args)
                }
              }]
            });
            
            messages.push({
              role: 'user',
              content: `Tool "${toolCall.function.name}" returned: ${JSON.stringify(result)}`
            });
          } catch (error) {
            console.error(`✗ Error executing tool ${toolCall.function.name}:`, error);
          }
        }
        
        console.log('Getting follow-up response with tool results...');
        const followUp = await this.client.chat.completions.create({
          model: this.model,
          messages: messages.map(m => ({
            role: m.role as 'system' | 'user' | 'assistant',
            content: m.content || ''
          })),
          max_tokens: 1500
        });
        
        finalContent = followUp.choices[0]?.message.content || finalContent;
        console.log('✓ Follow-up response generated');
        return { content: finalContent, toolCalls };
      }
      
      console.log('No tools called, returning direct response');
      return { content: choice.message.content || 'No response' };
    } catch (error) {
      console.error('✗ OpenAI API error:', error);
      return {
        content: `Error calling AI: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private buildConversationMessages(userMessage: string, history: Message[]) {
    const formattedHistory = history.slice(-10).map(m => {
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const toolCallsText = m.toolCalls.map(tc => 
          `<tool_call>{"name": "${tc.name}", "arguments": ${JSON.stringify(tc.arguments)}}</tool_call>`
        ).join('\n');
        
        return {
          role: 'assistant' as const,
          content: (m.content || '') + '\n' + toolCallsText
        };
      }
      if (m.role === 'tool') {
        return { 
          role: 'user' as const, 
          content: `Tool Result: ${m.content}`
        };
      }
      return { role: m.role as any, content: m.content };
    });
    
    const systemMessage = {
      role: 'system' as const,
      content: `You are the Procurement AI Agent, an AUTONOMOUS system for sourcing and purchasing. 
      
      CORE MANDATE: Be proactive and investigative. Autonomously execute the full procurement workflow.
      
      AVAILABLE TOOLS:
      - find_suppliers: Search ERP for suppliers of a specific part (tries multiple search strategies automatically)
      - search_parts_catalog: Browse available parts and their codes in the database
      - send_supplier_email: Send outreach emails to suppliers (for single supplier)
      - send_bulk_procurement_request: Contact multiple suppliers at once with automated tracking and hourly updates
      - record_supplier_response: Record a supplier's response with pricing information
      - get_supplier_responses: Get all recorded supplier responses and analyze to find best price
      - place_order: Create a purchase order with a supplier
      
      PROCUREMENT WORKFLOW (YOU EXECUTE AUTONOMOUSLY):
      1. When user asks to find suppliers: 
         - FIRST: CALL find_suppliers with their description - this returns a list of suppliers
         - If no results, CALL search_parts_catalog to explore available parts and suggest alternatives
      2. IMMEDIATELY after finding suppliers: 
         - If 2 or more suppliers: CALL send_bulk_procurement_request with suppliers array for automated tracking
         - If 1 supplier: CALL send_supplier_email for that single supplier
      3. When responses arrive: The system automatically notifies you in this chat with updates
      4. After all responses received or when user asks: CALL get_supplier_responses to analyze pricing
      5. Present analysis: "Best price: Supplier X at $Y per unit"
      6. If user approves: CALL place_order to confirm the purchase
      
      CRITICAL: Use send_bulk_procurement_request to enable automatic hourly status updates until all suppliers respond.
      
      SEARCH STRATEGY:
      - The find_suppliers tool automatically tries multiple search approaches (exact match, individual words, abbreviations)
      - If find_suppliers returns no results, use search_parts_catalog to discover what parts ARE available
      - Help users understand how parts are coded in the system (e.g., WLK-001 for wireless keyboards)
      - Be adaptive and suggest alternative search terms based on catalog exploration
      
      CRITICAL: When user asks about supplier responses, pricing updates, or mentions emails were received, 
      IMMEDIATELY call get_supplier_responses to check for new responses in the system.
      
      BEHAVIOR RULES:
      - Always use tools to gather and process data before responding
      - Be investigative: if direct search fails, explore the catalog to understand available inventory
      - For supplier queries, send emails to ALL relevant suppliers found
      - When user provides response data, record EACH response individually with record_supplier_response
      - ALWAYS follow up by calling get_supplier_responses to analyze all responses
      - Present clear price comparison before suggesting orders
      - Be proactive: if you have recorded responses, analyze them without waiting to be asked
      - When user mentions receiving emails or asks about responses, check get_supplier_responses first
      
      For procurement requests, be adaptive and thorough in your search approach.`
    };

    return [systemMessage, ...formattedHistory, { role: 'user' as const, content: userMessage }];
  }

  private addToolPrompting(messages: any[], toolDefinitions: any[]): any[] {
    if (toolDefinitions.length === 0) return messages;
    
    const toolsPrompt = `
AVAILABLE TOOLS:
${toolDefinitions.map(tool => `
- ${tool.function.name}: ${tool.function.description}
  Parameters: ${JSON.stringify(tool.function.parameters, null, 2)}
`).join('')}

TOOL USAGE FORMAT:
When you need to use a tool, respond with:
<tool_call>
{
  "name": "tool_name",
  "arguments": {"param1": "value1", "param2": "value2"}
}
</tool_call>

You can use multiple tools in sequence. Always use tools to gather data before making conclusions.
`;

    const lastMessage = messages[messages.length - 1];
    return [
      ...messages.slice(0, -1),
      {
        ...lastMessage,
        content: lastMessage.content + '\n\n' + toolsPrompt
      }
    ];
  }

  private async handlePromptBasedStreamResponse(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
    message: string,
    conversationHistory: Message[],
    onChunk: (chunk: string) => void
  ) {
    let fullContent = '';
    
    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          fullContent += delta.content;
          onChunk(delta.content);
        }
      }
    } catch (error) {
      console.error('Stream processing error:', error);
      throw new Error('Terminal stream synchronization failed.');
    }

    const toolCallMatch = fullContent.match(/<tool_call>\s*({.*?})\s*<\/tool_call>/s);
    if (toolCallMatch) {
      try {
        const toolCall = JSON.parse(toolCallMatch[1]);
        
        // Inject session_id for procurement tools
        if (toolCall.name === 'send_bulk_procurement_request' || 
            toolCall.name === 'start_procurement_request' ||
            toolCall.name === 'send_supplier_email') {
          toolCall.arguments = toolCall.arguments || {};
          toolCall.arguments.session_id = this.sessionId;
        }
        
        onChunk("\n\n---\n**ACCESSING SECURE ERP RECORDS...**\n\n");
        
        const result = await executeTool(toolCall.name, toolCall.arguments, this.env);
        const toolResult = {
          id: `tool_${Date.now()}`,
          name: toolCall.name,
          arguments: toolCall.arguments,
          result
        };
        
        const finalResponse = await this.generatePromptBasedToolResponse(message, conversationHistory, [toolResult]);
        onChunk(finalResponse);
        return { content: finalResponse, toolCalls: [toolResult] };
      } catch (error) {
        console.error('Tool call parsing error:', error);
      }
    }

    return { content: fullContent };
  }

  private async handlePromptBasedNonStreamResponse(
    completion: OpenAI.Chat.Completions.ChatCompletion,
    message: string,
    conversationHistory: Message[]
  ) {
    const responseContent = completion.choices[0]?.message?.content || '';
    
    // Check if response contains tool calls
    const toolCallMatch = responseContent.match(/<tool_call>\s*({.*?})\s*<\/tool_call>/s);
    if (toolCallMatch) {
      try {
        const toolCall = JSON.parse(toolCallMatch[1]);
        const result = await executeTool(toolCall.name, toolCall.arguments, this.env);
        const toolResult = {
          id: `tool_${Date.now()}`,
          name: toolCall.name,
          arguments: toolCall.arguments,
          result
        };
        
        const finalResponse = await this.generatePromptBasedToolResponse(message, conversationHistory, [toolResult]);
        return { content: finalResponse, toolCalls: [toolResult] };
      } catch (error) {
        console.error('Tool call parsing error:', error);
      }
    }

    return { content: responseContent };
  }

  private async generatePromptBasedToolResponse(
    userMessage: string,
    history: Message[],
    toolResults: ToolCall[]
  ): Promise<string> {
    if (!this.client) return "Terminal offline.";
    
    const toolResultsText = toolResults.map(tr => `
Tool: ${tr.name}
Arguments: ${JSON.stringify(tr.arguments)}
Result: ${JSON.stringify(tr.result)}
`).join('\n');

    const messages: any[] = [
      {
        role: 'system',
        content: `You are the Procurement AI Agent, an AUTONOMOUS system for sourcing and purchasing. 
        
        The user asked: "${userMessage}"
        
        You have gathered this data using tools:
        ${toolResultsText}
        
        Now provide a comprehensive analysis based on this data. Be thorough and professional.`
      },
      ...this.buildConversationMessages(userMessage, history)
    ];

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: 2000,
        temperature: 0.7
      });
      return completion.choices[0]?.message?.content || 'Analysis complete.';
    } catch (error) {
      console.error('Follow-up generation failure:', error);
      return 'Data retrieved successfully, but the terminal failed to generate a summary.';
    }
  }

  private async handlePromptBasedResponse(
    content: string,
    message: string,
    conversationHistory: Message[]
  ): Promise<{content: string; toolCalls?: ToolCall[]}> {
    console.log('Analyzing response for tool calls. Content:', content);
    
    let jsonString = '';
    
    const standardPatterns = [
      /<tool_call>\s*({.*?})\s*<\/tool_call>/gs,
      /<tool_call>({.*?})<\/tool_call>/gs
    ];
    
    for (const pattern of standardPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        jsonString = match[1].trim();
        console.log('Found standard tool call:', jsonString);
        break;
      }
    }
    
    if (!jsonString) {
      const malformedPatterns = [
        /<ool_call>\s*({.*?})\s*<\/tool_call>/gs,
        /<ool_call>\s*({.*?})\s*<tool_call>/gs,
        /<ool_call>([^<]+)<tool_call>/gs
      ];
      
      for (const pattern of malformedPatterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
          jsonString = match[1].trim();
          console.log('Found malformed tool call:', jsonString);
          break;
        }
      }
    }
    
    if (!jsonString) {
      const directJsonMatch = content.match(/{[^}]*"name"\s*:\s*"find_suppliers"[^}]*}/g);
      if (directJsonMatch) {
        jsonString = directJsonMatch[0];
        console.log('Found direct JSON:', jsonString);
      }
    }
    
    if (jsonString) {
      try {
        console.log('Raw extracted JSON:', JSON.stringify(jsonString));
        
        let cleanJson = jsonString.trim();
        
        const startBrace = cleanJson.indexOf('{');
        if (startBrace > 0) {
          cleanJson = cleanJson.substring(startBrace);
        }
        
        const lastBrace = cleanJson.lastIndexOf('}');
        if (lastBrace !== -1) {
          cleanJson = cleanJson.substring(0, lastBrace + 1);
        }
        
        cleanJson = cleanJson
          .replace(/,\s*}/, '}')
          .replace(/'/g, '"')    
          .replace(/([{,]\s*)(\w+):/g, '$1"$2":')
          .trim();
        
        console.log('Cleaned JSON after fixes:', cleanJson);
        
        const toolCall = JSON.parse(cleanJson);
        console.log('Successfully parsed tool call:', toolCall);
        
        if (!toolCall.name || !toolCall.arguments) {
          throw new Error('Tool call missing required name or arguments');
        }
        
        const result = await executeTool(toolCall.name, toolCall.arguments, this.env);
        console.log('Tool execution result:', result);
        
        const toolResult = {
          id: `tool_${Date.now()}`,
          name: toolCall.name,
          arguments: toolCall.arguments,
          result
        };
        
        const followUpResult = await this.env.AI.run(this.model, {
          messages: [
            {
              role: 'system',
              content: `You are the Procurement AI Agent. The user asked: "${message}"\n\nDatabase Results: ${JSON.stringify(result, null, 2)}\n\nProvide a clear, professional response about these suppliers.`
            },
            { role: 'user', content: message }
          ],
          max_tokens: 1500
        });
        
        const finalContent = followUpResult?.response || `Based on your request for "${message}", here are the supplier results:\n\n${JSON.stringify(result, null, 2)}`;
        return { content: finalContent, toolCalls: [toolResult] };
      } catch (error) {
        console.error('Tool call parsing/execution error:', error);
        console.error('Failed JSON string:', jsonString);
        console.error('Original content:', content);
        return { 
          content: `I encountered an issue processing your request. Error details: ${error.message}. Please try rephrasing your query.` 
        };
      }
    }
    
    const shouldUseDatabase = /supplier|i7|procurement|part|component|gpu|memory|cpu/i.test(message);
    if (shouldUseDatabase) {
      console.log('Query seems to need database access, but no tool call detected. Content:', content);
    }

    return { content };
  }
}