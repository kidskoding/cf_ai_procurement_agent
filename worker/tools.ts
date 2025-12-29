import type { WeatherResult, ErrorResult, Supplier, SupplierResult } from './types';
import type { Env } from './core-utils';
import { mcpManager } from './mcp-client';
export type ToolResult = WeatherResult | SupplierResult | { content: string } | ErrorResult;
const customTools = [
  {
    type: 'function',
    function: {
      name: 'find_suppliers',
      description: 'Search the internal ERP database for historical suppliers of a specific part. Will try multiple search strategies automatically.',
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
      name: 'search_parts_catalog',
      description: 'Search all parts in the database to discover what part codes and suppliers are available. Use this to explore the inventory.',
      parameters: {
        type: 'object',
        properties: {
          search_term: { 
            type: 'string', 
            description: 'Optional search term to filter results. Leave empty to see all available parts.' 
          }
        },
        required: []
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
      name: 'send_bulk_procurement_request',
      description: 'Send procurement requests to multiple suppliers and set up automatic tracking with hourly status updates.',
      parameters: {
        type: 'object',
        properties: {
          part_description: {
            type: 'string',
            description: 'Description of the part being procured'
          },
          suppliers: {
            type: 'array',
            description: 'List of suppliers to contact',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                name: { type: 'string' }
              },
              required: ['email', 'name']
            }
          },
          message: {
            type: 'string',
            description: 'The procurement request message to send'
          },
          session_id: {
            type: 'string',
            description: 'Current chat session ID for tracking updates'
          }
        },
        required: ['part_description', 'suppliers', 'message', 'session_id']
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
        
        try {
          // First, find part numbers from Parts table by searching descriptions
          const partsQuery = `
            SELECT part_number, part_description 
            FROM Parts 
            WHERE LOWER(part_description) LIKE ?
          `;
          
          console.log(`Searching parts catalog for: "${query}"`);
          
          const wildcardQuery = `%${query}%`;
          const partsResult = await env.SUPPLY_DB.prepare(partsQuery).bind(wildcardQuery).all();
          const matchingParts = (partsResult.results || []) as any[];
          
          console.log(`Found ${matchingParts.length} matching parts:`, matchingParts.map(p => `${p.part_number} (${p.part_description})`));
          
          if (matchingParts.length === 0) {
            return { error: `No parts found matching "${args.part_description}". Use search_parts_catalog to explore available parts.` };
          }
          
          // Now find suppliers for those part numbers in PurchaseOrders
          const supplierQuery = `
            SELECT supplier_name as name, supplier_email as email, 
                   order_date as lastPurchased, price,
                   part_number as partDescription
            FROM PurchaseOrders
            WHERE part_number = ? 
            ORDER BY order_date DESC
          `;
          
          let allSuppliers: Supplier[] = [];
          for (const part of matchingParts) {
            console.log(`Looking for suppliers of part: ${part.part_number}`);
            const supplierResult = await env.SUPPLY_DB.prepare(supplierQuery).bind(part.part_number).all();
            const suppliers = (supplierResult.results || []) as unknown as Supplier[];
            console.log(`Found ${suppliers.length} suppliers for ${part.part_number}`);
            
            // Add the part description to each supplier record
            suppliers.forEach(s => {
              s.partDescription = `${part.part_number} (${part.part_description})`;
            });
            
            allSuppliers.push(...suppliers);
          }
          
          console.log(`Total suppliers found: ${allSuppliers.length}`);
          
          if (allSuppliers.length === 0) {
            const partNumbers = matchingParts.map(p => p.part_number).join(', ');
            return { error: `Found matching parts (${partNumbers}) but no suppliers have purchased these parts yet.` };
          }
          
          return {
            suppliers: allSuppliers.map(s => ({
              ...s,
              price: typeof s.price === 'number' ? s.price : parseFloat(String(s.price)) || 0
            })),
            count: allSuppliers.length
          };
        } catch (error) {
          console.error('Find suppliers error:', error);
          return { error: `Database error while searching for suppliers: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
      }
      case 'search_parts_catalog': {
        const searchTerm = (args.search_term as string || '').toLowerCase().trim();
        
        try {
          console.log('Starting catalog search with term:', searchTerm || '(all parts)');
          
          let sql: string;
          let queryParams: any[] = [];
          
          if (searchTerm) {
            // Search specific parts by description
            sql = `
              SELECT part_number, part_description 
              FROM Parts 
              WHERE LOWER(part_description) LIKE ?
              ORDER BY part_description
            `;
            queryParams = [`%${searchTerm}%`];
          } else {
            // Show all parts
            sql = `
              SELECT part_number, part_description 
              FROM Parts 
              ORDER BY part_description 
              LIMIT 20
            `;
          }
          
          console.log('Executing catalog query:', sql);
          const result = await env.SUPPLY_DB.prepare(sql).bind(...queryParams).all();
          const parts = (result.results || []) as any[];
          
          console.log(`Found ${parts.length} parts in catalog`);
          
          if (parts.length === 0) {
            return { content: searchTerm ? 
              `No parts found matching "${searchTerm}" in catalog.` : 
              `No parts available in catalog.` 
            };
          }
          
          let content = searchTerm ? 
            `Parts matching "${searchTerm}":\n` : 
            `Parts Catalog (showing ${parts.length} parts):\n`;
          
          for (const part of parts) {
            content += `${part.part_number}: ${part.part_description}\n`;
          }
          
          content += `\nUse find_suppliers with any part description to locate suppliers.`;
          
          return { content };
        } catch (error) {
          console.error('Catalog search error:', error);
          return { content: `Catalog unavailable: ${error instanceof Error ? error.message : String(error)}` };
        }
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
          
          // 🚀 Track this as part of a procurement request
          // Use the session_id from args if provided
          try {
            const procurementId = crypto.randomUUID();
            const sessionId = (args.session_id as string) || 'unknown-session';
            
            await env.SUPPLY_DB.prepare(`
              INSERT INTO ProcurementRequests (id, session_id, part_description, suppliers_contacted, status, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(
              procurementId,
              sessionId,
              subject || 'Procurement Request',
              JSON.stringify([{
                email: supplier_email,
                name: supplier_name,
                contacted_at: new Date().toISOString()
              }]),
              'pending',
              new Date().toISOString(),
              new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // Expires in 7 days
            ).run();
            
            console.log(`✅ Created procurement request ${procurementId} for ${supplier_name} in session ${sessionId}`);
          } catch (trackingError) {
            console.error('Failed to create procurement request:', trackingError);
            // Don't fail the email send if tracking fails
          }
          
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
      case 'send_bulk_procurement_request': {
        const { part_description, suppliers, message, session_id } = args;
        
        if (!part_description || !suppliers || !Array.isArray(suppliers)) {
          return { error: "Missing required fields: part_description, suppliers (array)" };
        }

        if (!env.RESEND_API_KEY) {
          return { error: "Email service not configured. RESEND_API_KEY is missing." };
        }

        try {
          const procurementId = crypto.randomUUID();
          const currentSessionId = session_id as string || 'default-session';
          
          // Create procurement request record with session tracking
          await env.SUPPLY_DB.prepare(`
            INSERT INTO ProcurementRequests (id, session_id, part_description, suppliers_contacted, status, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(
            procurementId,
            currentSessionId,
            part_description,
            JSON.stringify(suppliers),
            'pending',
            new Date().toISOString(),
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          ).run();

          // Send emails to all suppliers
          let emailsSent = 0;
          let emailErrors = [];
          
          for (const supplier of suppliers as any[]) {
            try {
              const emailBody = message || `Dear ${supplier.name || 'Supplier'},\n\nWe are interested in procuring: ${part_description}\n\nPlease provide your best quote.\n\nThank you.`;
              
              const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  from: 'anirudh@kidskoding.com',
                  to: supplier.email,
                  subject: `Price Quote Request: ${part_description}`,
                  text: emailBody
                })
              });

              if (!response.ok) {
                const errorText = await response.text();
                console.error(`Failed to email ${supplier.email}:`, errorText);
                emailErrors.push(`${supplier.name}: ${response.statusText}`);
              } else {
                emailsSent++;
                console.log(`✓ Email sent to ${supplier.name} (${supplier.email})`);
              }
            } catch (emailError) {
              console.error(`Error emailing ${supplier.email}:`, emailError);
              emailErrors.push(`${supplier.name}: ${emailError instanceof Error ? emailError.message : 'Unknown error'}`);
            }
          }

          const totalSuppliers = suppliers.length;
          const summaryMessage = `Successfully sent ${emailsSent}/${totalSuppliers} procurement requests for "${part_description}". The system will monitor for responses and notify you hourly until all suppliers respond.`;
          
          if (emailErrors.length > 0) {
            return {
              success: true,
              message: summaryMessage + ` (Some errors: ${emailErrors.join(', ')})`,
              procurement_id: procurementId,
              emails_sent: emailsSent,
              total_suppliers: totalSuppliers,
              tracking_enabled: true,
              errors: emailErrors
            };
          }

          return {
            success: true,
            message: summaryMessage,
            procurement_id: procurementId,
            emails_sent: emailsSent,
            total_suppliers: totalSuppliers,
            tracking_enabled: true
          };
        } catch (error) {
          console.error('Bulk procurement error:', error);
          return { error: `Failed to send bulk procurement request: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
      }
      case 'start_procurement_request': {
        const { part_description, suppliers, session_id } = args;
        
        if (!part_description || !suppliers || !Array.isArray(suppliers)) {
          return { error: "Missing required fields: part_description, suppliers (array)" };
        }

        if (!env.RESEND_API_KEY) {
          return { error: "Email service not configured. RESEND_API_KEY is missing." };
        }

        try {
          const procurementId = crypto.randomUUID();
          const currentSessionId = session_id as string || 'default-session';
          
          // Create procurement request record
          await env.SUPPLY_DB.prepare(`
            INSERT INTO ProcurementRequests (id, session_id, part_description, suppliers_contacted, status, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(
            procurementId,
            currentSessionId,
            part_description,
            JSON.stringify(suppliers),
            'pending',
            new Date().toISOString(),
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // Expires in 7 days
          ).run();

          // Send emails to all suppliers
          let emailsSent = 0;
          let emailErrors = [];
          
          for (const supplier of suppliers as any[]) {
            try {
              const emailBody = `Dear ${supplier.name || 'Supplier'},

We are interested in procuring the following item:
${part_description}

Could you please provide:
1. Your best price quote per unit
2. Availability and lead time
3. Any minimum order quantities

Please reply with your pricing in the format: "Price: $XXX per unit"

Thank you for your time.

Best regards,
Procurement Team`;

              const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  from: 'anirudh@kidskoding.com',
                  to: supplier.email,
                  subject: `Price Quote Request: ${part_description}`,
                  text: emailBody
                })
              });

              if (!response.ok) {
                const errorText = await response.text();
                console.error(`Failed to email ${supplier.email}:`, errorText);
                emailErrors.push(`${supplier.name}: ${response.statusText}`);
              } else {
                emailsSent++;
                console.log(`✓ Email sent to ${supplier.name} (${supplier.email})`);
              }
            } catch (emailError) {
              console.error(`Error emailing ${supplier.email}:`, emailError);
              emailErrors.push(`${supplier.name}: ${emailError instanceof Error ? emailError.message : 'Unknown error'}`);
            }
          }

          const message = `Started procurement request ${procurementId} for "${part_description}". Sent ${emailsSent}/${suppliers.length} emails successfully.`;
          
          if (emailErrors.length > 0) {
            return {
              success: true,
              message: message + ` Errors: ${emailErrors.join(', ')}`,
              procurement_id: procurementId,
              emails_sent: emailsSent,
              total_suppliers: suppliers.length,
              errors: emailErrors
            };
          }

          return {
            success: true,
            message: message + " The system will monitor for responses and provide updates hourly.",
            procurement_id: procurementId,
            emails_sent: emailsSent,
            total_suppliers: suppliers.length
          };
        } catch (error) {
          console.error('Start procurement request error:', error);
          return { error: `Failed to start procurement request: ${error instanceof Error ? error.message : 'Unknown error'}` };
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