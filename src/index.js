// ClientCoded JavaScript/TypeScript SDK
// npm install clientcoded

const DEFAULT_API = "https://clientcoded.app.n8n.cloud/webhook/ap-35-trace-ingest";

let _config = {
  agentId: null,
  apiKey: null,
  traceUrl: DEFAULT_API,
};

let _conversationId = null;
let _turn = null;

/**
 * Configure the SDK globally.
 * @param {Object} config
 * @param {string} config.agentId - Your agent's ID from ClientCoded dashboard
 * @param {string} config.apiKey - Your API key from ClientCoded dashboard
 * @param {string} [config.traceUrl] - Optional custom trace endpoint URL
 */
function configure(config) {
  _config.agentId = config.agentId;
  _config.apiKey = config.apiKey;
  if (config.traceUrl) {
    _config.traceUrl = config.traceUrl;
  }
}

/**
 * Set the current conversation ID. Call at the start of each conversation.
 * @param {string} conversationId
 */
function setConversationId(conversationId) {
  _conversationId = conversationId;
  _turn = 0;
}

/**
 * Set the current turn number.
 * @param {number} turnNumber
 */
function setTurn(turnNumber) {
  _turn = turnNumber;
}

/**
 * Increment the turn counter by 1.
 */
function incrementTurn() {
  _turn = (_turn || 0) + 1;
}

/**
 * Wrap a function with tracing.
 * 
 * Usage:
 *   const getInvoice = trace("get_invoice", async (invoiceId) => {
 *     return await stripe.invoices.retrieve(invoiceId);
 *   });
 * 
 * @param {string} name - Name for this traced function
 * @param {Function} fn - The function to trace
 * @returns {Function} - Wrapped function with tracing
 */
function trace(name, fn) {
  return async function (...args) {
    const traceId = _uuid();
    const start = Date.now();
    let error = null;
    let result = null;

    try {
      result = await fn(...args);
      return result;
    } catch (e) {
      error = e.message || String(e);
      throw e;
    } finally {
      _sendTrace({
        traceId,
        toolName: name,
        input: _safeSerializeInput(args),
        output: _safeSerializeOutput(result),
        error,
        latencyMs: Date.now() - start,
      });
    }
  };
}

/**
 * Wrap a synchronous function with tracing.
 * 
 * Usage:
 *   const parseData = traceSync("parse_data", (raw) => {
 *     return JSON.parse(raw);
 *   });
 * 
 * @param {string} name - Name for this traced function
 * @param {Function} fn - The synchronous function to trace
 * @returns {Function} - Wrapped function with tracing
 */
function traceSync(name, fn) {
  return function (...args) {
    const traceId = _uuid();
    const start = Date.now();
    let error = null;
    let result = null;

    try {
      result = fn(...args);
      return result;
    } catch (e) {
      error = e.message || String(e);
      throw e;
    } finally {
      _sendTrace({
        traceId,
        toolName: name,
        input: _safeSerializeInput(args),
        output: _safeSerializeOutput(result),
        error,
        latencyMs: Date.now() - start,
      });
    }
  };
}

/**
 * Manual trace logging for cases where wrappers don't fit.
 * 
 * Usage:
 *   const start = Date.now();
 *   try {
 *     const result = await complexOperation();
 *     logTrace("complex_op", { input: { key: "val" }, output: result });
 *   } catch (e) {
 *     logTrace("complex_op", { input: { key: "val" }, error: e.message });
 *   }
 * 
 * @param {string} toolName
 * @param {Object} data
 * @param {*} [data.input]
 * @param {*} [data.output]
 * @param {string} [data.error]
 * @param {number} [data.latencyMs]
 */
function logTrace(toolName, data = {}) {
  _sendTrace({
    traceId: _uuid(),
    toolName,
    input: data.input ? _safeSerializeInput([data.input]) : null,
    output: data.output ? _safeSerializeOutput(data.output) : null,
    error: data.error || null,
    latencyMs: data.latencyMs || null,
  });
}

/**
 * Create a traced wrapper for a LangChain tool function.
 * 
 * Usage:
 *   const searchDb = traceLangChain("search_database", async (query) => {
 *     return await db.execute(query);
 *   });
 * 
 * @param {string} name
 * @param {Function} fn
 * @returns {Function}
 */
function traceLangChain(name, fn) {
  return trace(name, fn);
}

// === Internal functions ===

function _sendTrace({ traceId, toolName, input, output, error, latencyMs }) {
  if (!_config.agentId || !_config.apiKey) return;

  const payload = {
    agent_id: _config.agentId,
    api_key: _config.apiKey,
    trace_id: traceId,
    conversation_id: _conversationId,
    turn: _turn,
    tool_name: toolName,
    input: input,
    output: output,
    error: error,
    latency_ms: latencyMs,
    timestamp: Date.now() / 1000,
  };

  // Fire and forget
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    fetch(_config.traceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
  } catch {
    // Never break the customer's agent
  }
}

function _safeSerializeInput(args) {
  try {
    const serialized = args.map((a) => _truncate(JSON.stringify(a)));
    return { args: serialized };
  } catch {
    return { error: "unserializable" };
  }
}

function _safeSerializeOutput(result) {
  if (result === null || result === undefined) return null;
  try {
    return _truncate(JSON.stringify(result));
  } catch {
    return "unserializable";
  }
}

function _truncate(s, maxLen = 2000) {
  if (s.length > maxLen) {
    return s.slice(0, maxLen) + "... (truncated)";
  }
  return s;
}

function _uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

module.exports = {
  configure,
  setConversationId,
  setTurn,
  incrementTurn,
  trace,
  traceSync,
  logTrace,
  traceLangChain,
};
