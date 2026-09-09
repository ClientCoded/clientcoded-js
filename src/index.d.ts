declare module "clientcoded" {
  interface ConfigOptions {
    agentId: string;
    apiKey: string;
    traceUrl?: string;
  }

  interface TraceData {
    input?: any;
    output?: any;
    error?: string;
    latencyMs?: number;
  }

  export function configure(config: ConfigOptions): void;
  export function setConversationId(conversationId: string): void;
  export function setTurn(turnNumber: number): void;
  export function incrementTurn(): void;
  export function trace<T extends (...args: any[]) => Promise<any>>(
    name: string,
    fn: T
  ): T;
  export function traceSync<T extends (...args: any[]) => any>(
    name: string,
    fn: T
  ): T;
  export function logTrace(toolName: string, data?: TraceData): void;
  export function traceLangChain<T extends (...args: any[]) => Promise<any>>(
    name: string,
    fn: T
  ): T;
}

export function extractTestContext(headers: Record<string, string>): { test_run_id?: string; question_index?: number; agent_id?: string };
export function getTestContext(): { test_run_id?: string; question_index?: number; agent_id?: string };
export function runWithTestContext(ctx: object, fn: () => any): any;
export function expressMiddleware(): (req: any, res: any, next: any) => void;
export function fastifyPlugin(fastify: any, opts: any, done: any): void;
