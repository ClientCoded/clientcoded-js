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
