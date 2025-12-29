// Making changes to this file is **STRICTLY** forbidden. Please add your routes in `userRoutes.ts` file.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { Env, getAppController } from "./core-utils";
import { API_RESPONSES } from "./config";
import { ChatAgent } from "./agent";
import { AppController } from "./app-controller";
import { userRoutes, coreRoutes } from "./userRoutes";
import { getAgentByName } from 'agents';
export { ChatAgent, AppController };
export interface ClientErrorReport {
  message: string;
  url: string;
  userAgent: string;
  timestamp: string;
  stack?: string;
  componentStack?: string;
  errorBoundary?: boolean;
  errorBoundaryProps?: Record<string, unknown>;
  source?: string;
  lineno?: number;
  colno?: number;
  error?: unknown;
}

type UserRoutesModule = {
  userRoutes: (app: Hono<{ Bindings: Env }>) => void;
  coreRoutes: (app: Hono<{ Bindings: Env }>) => void;
};

let userRoutesLoaded = false;
let userRoutesLoadError: string | null = null;

const safeLoadUserRoutes = async (app: Hono<{ Bindings: Env }>) => {
  if (userRoutesLoaded) return;

  try {
    // Use static imports for production reliability
    userRoutes(app);
    coreRoutes(app);
    userRoutesLoaded = true;
    userRoutesLoadError = null;
  } catch (e) {
    userRoutesLoadError = e instanceof Error ? e.message : String(e);
    console.error('Failed to load user routes:', e);
  }
};

const app = new Hono<{ Bindings: Env }>();

/** DO NOT TOUCH THE CODE BELOW THIS LINE */
// Middleware
app.use("*", logger());

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);


app.get("/api/health", (c) =>
  c.json({
    success: true,
    data: {
      status: "healthy",
      timestamp: new Date().toISOString(),
    },
  })
);

app.post("/api/client-errors", async (c) => {
  try {
    const errorReport = await c.req.json<ClientErrorReport>();
    console.error("[CLIENT ERROR]", {
      ...errorReport,
    });
    return c.json({ success: true });
  } catch (error) {
    console.error("[CLIENT ERROR HANDLER] Failed:", error);
    return c.json(
      {
        success: false,
        error: "Failed to process error report",
      },
      { status: 500 }
    );
  }
});

app.notFound((c) =>
  c.json(
    {
      success: false,
      error: API_RESPONSES.NOT_FOUND,
    },
    { status: 404 }
  )
);

// 🚀 Scheduled procurement monitoring function
async function checkProcurementRequests(env: Env) {
  if (!env.SUPPLY_DB) {
    console.error('❌ SUPPLY_DB not available for scheduled job');
    return;
  }

  try {
    // Get all pending procurement requests
    const { results: requests } = await env.SUPPLY_DB.prepare(`
      SELECT * FROM ProcurementRequests 
      WHERE status = 'pending' 
      AND datetime(expires_at) > datetime('now')
      ORDER BY created_at DESC
    `).all() as any;

    if (!requests || requests.length === 0) {
      console.log('✅ No pending procurement requests found');
      return;
    }

    console.log(`📋 Found ${requests.length} pending procurement requests to check`);

    for (const request of requests) {
      await checkSingleProcurementRequest(env, request);
      
      // Update last check time
      await env.SUPPLY_DB.prepare(`
        UPDATE ProcurementRequests 
        SET last_check_at = ? 
        WHERE id = ?
      `).bind(
        new Date().toISOString(),
        request.id
      ).run();
    }

  } catch (error) {
    console.error('❌ Error in checkProcurementRequests:', error);
  }
}

async function checkSingleProcurementRequest(env: Env, request: any) {
  try {
    const suppliersContacted = JSON.parse(request.suppliers_contacted);
    
    // Get all responses for this request's suppliers
    const supplierEmails = suppliersContacted.map((s: any) => s.email);
    const placeholders = supplierEmails.map(() => '?').join(',');
    
    const { results: responses } = await env.SUPPLY_DB.prepare(`
      SELECT supplier_email, supplier_name, price, created_at 
      FROM SupplierResponses 
      WHERE supplier_email IN (${placeholders})
      AND datetime(created_at) >= datetime(?)
    `).bind(...supplierEmails, request.created_at).all() as any;

    const respondedSuppliers = new Set(responses?.map((r: any) => r.supplier_email) || []);
    const pendingSuppliers = suppliersContacted.filter((s: any) => !respondedSuppliers.has(s.email));
    
    const totalContacted = suppliersContacted.length;
    const totalResponded = respondedSuppliers.size;
    const totalPending = pendingSuppliers.length;

    console.log(`📊 Request ${request.id}: ${totalResponded}/${totalContacted} responses received`);

    // Notify user about status
    if (env.CHAT_AGENT && env.APP_CONTROLLER) {
      try {
        const agent = await getAgentByName<Env, ChatAgent>(env.CHAT_AGENT, request.session_id);
        
        let statusMessage: string;
        
        if (totalPending === 0) {
          // All suppliers responded - mark as completed
          statusMessage = `🎉 **All supplier responses received!**\n\n**${request.part_description}** procurement complete:\n• **${totalResponded} responses** collected\n• Best pricing analysis ready\n\nWould you like me to analyze all responses and recommend the best supplier?`;
          
          await env.SUPPLY_DB.prepare(`
            UPDATE ProcurementRequests 
            SET status = 'completed' 
            WHERE id = ?
          `).bind(request.id).run();
          
        } else {
          // Still waiting for responses
          const pendingNames = pendingSuppliers.map((s: any) => s.name).join(', ');
          statusMessage = `⏳ **Procurement Status Update**\n\n**${request.part_description}**:\n• **${totalResponded}/${totalContacted} responses** received\n• Still waiting for: **${pendingNames}**\n\n${totalResponded > 0 ? 'I can provide preliminary analysis of current responses if needed.' : 'I\'ll notify you as more responses arrive.'}`;
        }
        
        await agent.fetch(new Request('http://internal/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: statusMessage,
            isSystemNotification: true
          })
        }));
        
        console.log(`✅ Notified session ${request.session_id} about procurement status`);
        
      } catch (notificationError) {
        console.error(`❌ Failed to notify session ${request.session_id}:`, notificationError);
      }
    }
    
  } catch (error) {
    console.error(`❌ Error checking request ${request.id}:`, error);
  }
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith("/api/") && pathname !== "/api/health" && pathname !== "/api/client-errors") {
      await safeLoadUserRoutes(app);
      if (userRoutesLoadError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Worker routes failed to load",
            detail: userRoutesLoadError,
          }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }
    }

    return app.fetch(request, env, ctx);
  },

  // 🚀 NEW: Scheduled job to check supplier responses every hour
  async scheduled(event, env, ctx) {
    console.log('⏰ Running scheduled procurement check at', new Date().toISOString());
    
    try {
      await checkProcurementRequests(env);
    } catch (error) {
      console.error('❌ Scheduled job failed:', error);
    }
  },
} satisfies ExportedHandler<Env>;
