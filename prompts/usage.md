# Usage Instructions

You can start customizing the template frontend by modifying `src/App.tsx`. The page auto-updates as you edit the file.

The chat API is powered by Cloudflare Agents (Which is a wrapper on Durable Objects) and accessible through the worker at `/api/chat/:sessionId/*` routes defined in `worker/userRoutes.ts`. **Use it!**

The agent system uses Durable Objects for persistent state management and conversation history. `/api/chat/:sessionId/*` should be used without modifications for any conversation support. There is also a control plane durable object for session management name AppController.

There are already several models presupplied with the template along with proper configuration (apikeys and base url). You should develop using them instead of adding mock methods.

- Built with:
  * **React + Vite** for fast frontend development with hot module replacement
  * **Cloudflare Agents SDK** for stateful agent management with persistent Durable Objects
  * **Model Context Protocol (MCP)** client for real server integration
  * **OpenAI SDK** for AI model integration via Cloudflare AI Gateway
  * **Production MCP Servers** including Cloudflare Bindings and Observability
  * **Tailwind CSS** for utility-first styling with glass morphism effects
  * **Framer Motion** for smooth chat animations and loading states
  * **Lucide Icons** (React) for modern, consistent iconography
  * **Shadcn/UI** (v2.3.0) for accessible chat components built on Radix UI primitives
  * **TypeScript** for type safety and extensible architecture
  * **Durable Objects** for control plane for database or session management

- Agent Features:
  * **Real MCP Integration**: Connects to actual MCP servers, not simulated implementations
  * **Cloudflare MCP Servers**: Direct integration with Cloudflare Bindings and Observability servers
  * **Intelligent Tool Usage**: AI automatically detects when to use tools (D1, R2, Workers, Web browsing)
  * **Multi-Model Support**: Switch between various models
  * **Production Tools**: Query D1 databases, manage R2 buckets, get Worker analytics
  * **Web Browsing**: Browse and extract content from web pages through MCP server
  * **Persistent Conversations**: Maintains chat history using Durable Objects state in Cloudflare Agents.
  * **Tool Visualization**: Shows which tools were used with results in the chat interface

- Adding New MCP Servers:
  * **Step 1**: Add server configuration to `initializeCloudflareServers()` in `worker/mcp-client.ts`
  * **Step 2**: Tools are automatically discovered and registered from MCP server definitions
  * **Step 3**: The system automatically routes tool calls to appropriate MCP servers
  * **Real Protocol**: Uses actual MCP protocol for server communication, not simulation

- Environment Variables:
  * **CF_AI_BASE_URL**: Cloudflare AI Gateway base URL (required)
  * **CF_AI_API_KEY**: API key for AI Gateway access (required)
  * **CHAT_AGENT**: Durable Object binding name for agent persistence

- Restrictions:
  * **Environment variables**: CF_AI_BASE_URL and CF_AI_API_KEY must be configured
  * **API keys**: Never expose API keys to client-side - they're server-side only in worker
  * **Tool Safety**: Tool functions should validate inputs and handle errors gracefully
  * **Use Agents SDK patterns**: Extend Agent class, use setState for persistence

- Styling:
  * Must generate **fully responsive** and beautiful UI with agent-focused design
  * Use Shadcn preinstalled components rather than writing custom ones when possible
  * Use **Tailwind's spacing, layout, and typography utilities** for all components
  * Include tool interaction indicators and loading states for better UX

- Components:
  * All Shadcn components are available and can be imported from `@/components/ui/...`
  * Current chat uses: `Button`, `Input`, `Card`, `Select`, `Badge` for the interface
  * Tool results are displayed with badges and icons from the UI library
  * Do not write custom components if shadcn components are available
  * Icons from Lucide should be imported directly from `lucide-react`

- Animation:
  * Use `framer-motion`'s `motion` components for chat message animations
  * Animate tool usage indicators, model selection, and loading states
  * You can integrate variants and transitions using Tailwind utility classes alongside motion props

- Worker Architecture (Backend, APIs):
  * **`worker/agent.ts`**: Main agent class 
  * **`worker/userRoutes.ts`**: HTTP routing for agent API and session managementå
  * **`worker/chat.ts`**: OpenAI integration and conversation logic  
  * **`worker/mcp-client.ts`**: MCP client for real server integration
  * **`worker/tools.ts`**: Tool routing and MCP server coordination
  * **`worker/config.ts`**: Centralized configuration
  * **`worker/types.ts`**: TypeScript interfaces and type definitions
  * **`worker/app-controller.ts`**: Control plane durable object for session management

---

# Important Notes
- Conversations and persistence are already handled by the template. Utilize existing utilities and apis to build something greater.
- For example, to build a chatgpt clone - You just need to build the frontend and use existing APIs without modifying them.

# Available bindings:
**Only The following bindings are to be used in the project! Do not use any other bindings or remove/replace any of the bindings**
- `CHAT_AGENT`: A durable object binding for the chat agent, but can be extended and used for other agentic purposes
- `APP_CONTROLLER`: A durable object binding for the app controller, but can be extended and used for other agentic purposes
**IMPORTANT: You are NOT ALLOWED to edit/add/remove ANY worker bindings OR touch wrangler.jsonc/wrangler.toml. Build your application around what is already provided.**

# IMPORTANT NOTE: You must inform the user that although this project has AI capaibilities, There is a limit on the number of requests that can be made to the AI servers across all user apps in a given time period.
Add the above note in an appropriate and visible location in the app - like in the footer or in the chat interface or as a modal

---

## Routing (CRITICAL)

Uses `createBrowserRouter` - do NOT switch to `BrowserRouter`/`HashRouter`.

If you switch routers, `RouteErrorBoundary`/`useRouteError()` will not work (you'll get a router configuration error screen instead of proper route error handling).

**Add routes in `src/main.tsx`:**
```tsx
const router = createBrowserRouter([
  { path: "/", element: <HomePage />, errorElement: <RouteErrorBoundary /> },
  { path: "/new", element: <NewPage />, errorElement: <RouteErrorBoundary /> },
]);
```

**Navigation:** `import { Link } from 'react-router-dom'` then `<Link to="/new">New</Link>`

**Don't:**
- Use `BrowserRouter`, `HashRouter`, `MemoryRouter`
- Remove `errorElement` from routes
- Use `useRouteError()` in your components

## UI Components
All ShadCN components are in `./src/components/ui/*`. Import and use them directly:
```tsx
import { Button } from "@/components/ui/button";
```
**Do not rewrite these components.**
