import type { WeatherResult, ErrorResult, Supplier, SupplierResult } from './types';
import type { Env } from './core-utils';
import { mcpManager } from './mcp-client';
export type ToolResult = WeatherResult | SupplierResult | { content: string } | ErrorResult;
const customTools = [
  {
    type: 'function',
    function: {
      name: 'find_suppliers',
      description: 'Search the internal ERP database for historical suppliers of a specific part.',
      parameters: {
        type: 'object',
        properties: {
          part_description: { 
            type: 'string', 
            description: 'The name or description of the part to search for' 
          }
        },
        required: ['part_description']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_supplier_email',
      description: 'Send an email to a supplier to initiate contact or request information.',
      parameters: {
        type: 'object',
        properties: {
          supplier_email: { 
            type: 'string', 
            description: 'The email address of the supplier' 
          },
          supplier_name: {
            type: 'string',
            description: 'The name of the supplier company'
          },
          subject: {
            type: 'string',
            description: 'Email subject line'
          },
          message: {
            type: 'string',
            description: 'The body of the email message'
          }
        },
        required: ['supplier_email', 'supplier_name', 'subject', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_supplier_responses',
      description: 'Get all email responses from suppliers and analyze them to find the best price.',
      parameters: {
        type: 'object',
        properties: {
          part_description: {
            type: 'string',
            description: 'The part we are searching responses for (optional, if not provided returns all recent responses)'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'place_order',
      description: 'Place an order with a supplier for a specific part and quantity.',
      parameters: {
        type: 'object',
        properties: {
          supplier_email: {
            type: 'string',
            description: 'The email of the supplier to order from'
          },
          supplier_name: {
            type: 'string',
            description: 'The name of the supplier'
          },
          part_number: {
            type: 'string',
            description: 'The part number or description to order'
          },
          quantity: {
            type: 'number',
            description: 'How many units to order'
          },
          price: {
            type: 'number',
            description: 'Price per unit'
          }
        },
        required: ['supplier_email', 'supplier_name', 'part_number', 'quantity', 'price']
      }
    }
  }
];
export async function getToolDefinitions() {
  // Temporarily disable MCP tools to test basic functionality
  // const mcpTools = await mcpManager.getToolDefinitions();
  // return [...customTools, ...mcpTools];
  return customTools;
}
export async function executeTool(name: string, args: Record<string, unknown>, env: Env): Promise<ToolResult> {
  if (name === 'find_suppliers' && !env.SUPPLY_DB) {
    return {
      error: "The Procurement Terminal is unable to access records because the internal database binding (SUPPLY_DB targeting procurement-ai) is not configured in the environment."
    };
  }
  try {
    switch (name) {
      case 'find_suppliers': {
        const query = (args.part_description as string || '').toLowerCase().trim();
        if (!query) return { error: "Please provide a specific part description for the audit." };
        
        const sql = `
          SELECT supplier_name as name, supplier_email as email, 
                 order_date as lastPurchased, price,
                 part_number as partDescription
          FROM PurchaseOrders
          WHERE LOWER(part_number) LIKE ? 
          ORDER BY order_date DESC 
          LIMIT 10
        `;
        
        const wildcardQuery = `%${query}%`;
        const { results } = await env.SUPPLY_DB.prepare(sql).bind(wildcardQuery).all();
        const suppliers = (results || []) as unknown as Supplier[];
        if (suppliers.length === 0) {
          return { error: `ERP System Search: No historical records found for "${args.part_description}".` };
        }
        return {
          suppliers: suppliers.map(s => ({
            ...s,
            price: typeof s.price === 'number' ? s.price : parseFloat(String(s.price)) || 0
          })),
          count: suppliers.length
        };
      }
      case 'send_supplier_email': {
        const { supplier_email, supplier_name, subject, message } = args;
        
        if (!supplier_email || !supplier_name || !subject || !message) {
          return { error: "Missing required fields: supplier_email, supplier_name, subject, message" };
        }
        
        if (!env.RESEND_API_KEY) {
          return { error: "Email service not configured. RESEND_API_KEY is missing." };
        }

        try {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'anirudh@kidskoding.com',
              to: supplier_email,
              subject: `${subject}`,
              text: `${message}\n\n---\nReply with your price quote: e.g., "Price: $450 per unit"`
            })
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Resend API error:', response.status, errorText);
            return { error: `Failed to send email: ${response.statusText}` };
          }

          console.log(`✓ Email sent successfully to ${supplier_email}`);
          return {
            success: true,
            message: `Email sent to ${supplier_name} (${supplier_email})`,
            recipient: supplier_email
          };
        } catch (error) {
          console.error('Email sending error:', error);
          return { error: `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
      }
      case 'place_order': {
        const { supplier_email, supplier_name, part_number, quantity, price } = args;

        if (!supplier_email || !supplier_name || !part_number || !quantity || price === undefined) {
          return { error: 'Missing required fields: supplier_email, supplier_name, part_number, quantity, price' };
        }

        try {
          const result = await env.SUPPLY_DB.prepare(`
            INSERT INTO PurchaseOrders (supplier_name, supplier_email, part_number, order_date, quantity, price)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
            supplier_name,
            supplier_email,
            part_number,
            new Date().toISOString(),
            quantity,
            price
          ).run();

          const totalPrice = (quantity as number) * (price as number);
          console.log(`✓ Order placed: ${quantity} units of ${part_number} from ${supplier_name} at $${price}/unit = $${totalPrice} total`);
          
          return {
            success: true,
            message: `Order placed with ${supplier_name}: ${quantity} units of ${part_number} at $${price}/unit = $${totalPrice} total`,
            details: {
              supplier: supplier_name,
              part: part_number,
              quantity,
              unit_price: price,
              total: totalPrice
            }
          };
        } catch (error) {
          console.error('Error placing order:', error);
          return { error: `Failed to place order: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
      }
      case 'get_supplier_responses': {
        try {
          const { results } = await env.SUPPLY_DB.prepare(`
            SELECT supplier_name, supplier_email, price, response_text, created_at
            FROM SupplierResponses
            ORDER BY created_at DESC
            LIMIT 50
          `).all() as any;

          if (!results || results.length === 0) {
            return { message: 'No supplier responses received yet.' };
          }

          // Get only the most recent response from each supplier with pricing
          const supplierLatestPrices = new Map();
          
          for (const response of results as any[]) {
            if (response.price && !isNaN(response.price)) {
              const email = response.supplier_email;
              if (!supplierLatestPrices.has(email)) {
                supplierLatestPrices.set(email, response);
              }
            }
          }
          
          const latestValidResponses = Array.from(supplierLatestPrices.values());
          
          if (latestValidResponses.length === 0) {
            return { 
              message: `Received ${results.length} responses but no pricing info extracted yet.`,
              responses: results
            };
          }

          const bestOption = latestValidResponses.reduce((best, current) => 
            (current.price < best.price) ? current : best
          );

          const analysis = {
            total_responses: results.length,
            current_suppliers_with_pricing: latestValidResponses.length,
            best_option: {
              supplier: bestOption.supplier_name,
              email: bestOption.supplier_email,
              price: bestOption.price,
              response: bestOption.response_text,
              received_at: bestOption.created_at
            },
            current_supplier_prices: latestValidResponses.map(r => ({
              supplier: r.supplier_name,
              email: r.supplier_email,
              price: r.price,
              last_updated: r.created_at,
              message: r.response_text?.substring(0, 200) + '...'
            }))
          };

          console.log(`✓ Analyzed ${results.length} supplier responses, best price: $${bestOption.price}`);
          return analysis;
        } catch (error) {
          console.error('Error analyzing responses:', error);
          return { error: 'Failed to retrieve supplier responses' };
        }
      }
      default: {
        const content = await mcpManager.executeTool(name, args);
        return { content };
      }
    }
  } catch (error) {
    console.error(`Tool execution error [${name}] against D1:`, error);
    return { error: `ERP Connection Failure: ${error instanceof Error ? error.message : 'The query to procurement-ai failed.'}` };
  }
}