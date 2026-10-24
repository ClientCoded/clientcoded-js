// ClientCoded JavaScript/TypeScript SDK v0.5.0
// npm install clientcoded
//
// 0.5.0
//   * FIX: 0.4.0 threw "getTestContext is not defined" from every traced
//     function once configure() was called, breaking the customer's own
//     code. Tracing can no longer throw into the caller.
//   * Traces go to https://api.clientcoded.com/traces by default (was the
//     n8n AP-35 webhook). configure({ traceUrl }) or CLIENTCODED_TRACE_URL
//     still override it.
//   * Parent/child links use AsyncLocalStorage, so concurrent requests in
//     one process no longer get each other's steps as parents.
//   * Long inputs/outputs cut to 2,000 characters now say how long they
//     were and how many items/rows, e.g. "(truncated: 21,840 characters, 128 rows)".
//   * One console warning per rejection reason (bad API key, wrong agent,
//     rate limit) instead of failing silently.

const { AsyncLocalStorage } = require("node:async_hooks");
const { extractTestContext, getTestContext, runWithTestContext } = require("./context");
const { expressMiddleware, fastifyPlugin } = require("./middleware");

const DEFAULT_API =
  (typeof process !== "undefined" && process.env && process.env.CLIENTCODED_TRACE_URL) ||
  "https://api.clientcoded.com/traces";
const MAX_TRACE_CHARS = 2000;
const _parentStore = new AsyncLocalStorage();
const _warned = new Set();

let _config = {
  agentId: (typeof process !== "undefined" && process.env && process.env.CLIENTCODED_AGENT_ID) || null,
  apiKey: (typeof process !== "undefined" && process.env && process.env.CLIENTCODED_API_KEY) || null,
  traceUrl: DEFAULT_API,
};

let _conversationId = null;
let _turn = null;
// Parent step for the code currently running. Kept per async call chain
// (AsyncLocalStorage), not in one shared variable, so concurrent requests
// don't adopt each other's steps as parents.
function _currentParent() {
  return _parentStore.getStore() || null;
}
const _instrumented = new Set();

/**
 * Configure the SDK globally.
 */
function configure(config = {}) {
  _config.agentId = config.agentId || _config.agentId;
  _config.apiKey = config.apiKey || _config.apiKey;
  if (config.traceUrl) {
    _config.traceUrl = config.traceUrl;
  }
}

/**
 * Set the current conversation ID.
 */
function setConversationId(conversationId) {
  _conversationId = conversationId;
  _turn = 0;
}

/**
 * Set the current turn number.
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
 * Wrap an async function with tracing and parent-child nesting.
 */
function trace(name, fn) {
  return async function (...args) {
    const traceId = _uuid();
    const parentId = _currentParent();

    const start = Date.now();
    let error = null;
    let result = null;

    try {
      result = await _parentStore.run(traceId, () => fn.apply(this, args));
      return result;
    } catch (e) {
      error = (e && e.message) || String(e);
      throw e;
    } finally {
      _sendTrace({
        traceId,
        parentTraceId: parentId,
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
 * Wrap a synchronous function with tracing and parent-child nesting.
 */
function traceSync(name, fn) {
  return function (...args) {
    const traceId = _uuid();
    const parentId = _currentParent();

    const start = Date.now();
    let error = null;
    let result = null;

    try {
      result = _parentStore.run(traceId, () => fn.apply(this, args));
      return result;
    } catch (e) {
      error = (e && e.message) || String(e);
      throw e;
    } finally {
      _sendTrace({
        traceId,
        parentTraceId: parentId,
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
 * Manual trace logging.
 */
function logTrace(toolName, data = {}) {
  _sendTrace({
    traceId: _uuid(),
    parentTraceId: _currentParent(),
    toolName,
    input: data.input ? _safeSerializeInput([data.input]) : null,
    output: data.output ? _safeSerializeOutput(data.output) : null,
    error: data.error || null,
    latencyMs: data.latencyMs || null,
  });
}

/**
 * Auto-instrument supported frameworks.
 * 
 * Usage:
 *   const clientcoded = require('clientcoded');
 *   clientcoded.configure({ agentId: 'xxx', apiKey: 'xxx' });
 *   clientcoded.autoInstrument({ frameworks: ['openai', 'anthropic'] });
 */
function autoInstrument(options = {}) {
  const frameworks = options.frameworks || ['openai', 'anthropic'];

  for (const framework of frameworks) {
    if (_instrumented.has(framework)) continue;

    if (framework === 'openai') _instrumentOpenAI();
    if (framework === 'anthropic') _instrumentAnthropic();
    if (framework === 'langchain') _instrumentLangChain();

    _instrumented.add(framework);
  }
}

function _instrumentOpenAI() {
  try {
    const openai = require('openai');
    const OpenAI = openai.default || openai.OpenAI || openai;

    if (!OpenAI || !OpenAI.prototype) return;

    const origChat = OpenAI.prototype.chat;
    if (!origChat) return;

    const origCreate = origChat?.completions?.create;
    if (!origCreate) return;

    // Monkey-patch at the instance level via proxy
    const origConstructor = OpenAI;
    const patchedConstructor = function (...args) {
      const instance = new origConstructor(...args);

      const originalCreate = instance.chat.completions.create.bind(instance.chat.completions);
      instance.chat.completions.create = async function (...createArgs) {
        const traceId = _uuid();
        const parentId = _currentParent();
        const start = Date.now();
        let error = null;
        let result = null;

        try {
          result = await originalCreate(...createArgs);
          return result;
        } catch (e) {
          error = e.message || String(e);
          throw e;
        } finally {

          let output = null;
          let inputTokens = null;
          let outputTokens = null;

          if (result?.choices?.[0]?.message?.content) {
            output = result.choices[0].message.content.slice(0, 500);
          }
          if (result?.usage) {
            inputTokens = result.usage.prompt_tokens;
            outputTokens = result.usage.completion_tokens;
          }

          _sendTrace({
            traceId,
            parentTraceId: parentId,
            toolName: 'openai.chat.completions',
            input: {
              kwargs: {
                model: createArgs[0]?.model || 'unknown',
                messages_count: String(createArgs[0]?.messages?.length || 0),
              }
            },
            output,
            error,
            latencyMs: Date.now() - start,
            extra: { input_tokens: inputTokens, output_tokens: outputTokens },
          });
        }
      };

      return instance;
    };

    // Copy static properties
    Object.setPrototypeOf(patchedConstructor, origConstructor);
    patchedConstructor.prototype = origConstructor.prototype;

  } catch (e) {
    // OpenAI not installed, skip silently
  }
}

function _instrumentAnthropic() {
  try {
    const anthropic = require('@anthropic-ai/sdk');
    const Anthropic = anthropic.default || anthropic.Anthropic || anthropic;

    if (!Anthropic || !Anthropic.prototype) return;

    const origConstructor = Anthropic;
    const patchedConstructor = function (...args) {
      const instance = new origConstructor(...args);

      const originalCreate = instance.messages.create.bind(instance.messages);
      instance.messages.create = async function (...createArgs) {
        const traceId = _uuid();
        const parentId = _currentParent();
        const start = Date.now();
        let error = null;
        let result = null;

        try {
          result = await originalCreate(...createArgs);
          return result;
        } catch (e) {
          error = e.message || String(e);
          throw e;
        } finally {

          let output = null;
          let inputTokens = null;
          let outputTokens = null;

          if (result?.content) {
            const textBlocks = result.content
              .filter(b => b.type === 'text')
              .map(b => b.text);
            output = textBlocks.join(' ').slice(0, 500);
          }
          if (result?.usage) {
            inputTokens = result.usage.input_tokens;
            outputTokens = result.usage.output_tokens;
          }

          _sendTrace({
            traceId,
            parentTraceId: parentId,
            toolName: 'anthropic.messages',
            input: {
              kwargs: {
                model: createArgs[0]?.model || 'unknown',
                messages_count: String(createArgs[0]?.messages?.length || 0),
              }
            },
            output,
            error,
            latencyMs: Date.now() - start,
            extra: { input_tokens: inputTokens, output_tokens: outputTokens },
          });
        }
      };

      return instance;
    };

    Object.setPrototypeOf(patchedConstructor, origConstructor);
    patchedConstructor.prototype = origConstructor.prototype;

  } catch (e) {
    // Anthropic not installed, skip silently
  }
}

function _instrumentLangChain() {
  try {
    const { BaseTool } = require('@langchain/core/tools');

    if (!BaseTool || !BaseTool.prototype) return;

    const originalInvoke = BaseTool.prototype.invoke;

    BaseTool.prototype.invoke = async function (input, config, ...rest) {
      const traceId = _uuid();
      const parentId = _currentParent();
      const start = Date.now();
      let error = null;
      let result = null;

      try {
        result = await originalInvoke.call(this, input, config, ...rest);
        return result;
      } catch (e) {
        error = e.message || String(e);
        throw e;
      } finally {

        _sendTrace({
          traceId,
          parentTraceId: parentId,
          toolName: 'langchain.tool.' + (this.name || this.constructor.name),
          input: _safeSerializeInput([input]),
          output: _safeSerializeOutput(result),
          error,
          latencyMs: Date.now() - start,
        });
      }
    };
  } catch (e) {
    // LangChain not installed, skip silently
  }
}

// === Internal functions ===

function _sendTrace({ traceId, parentTraceId, toolName, input, output, error, latencyMs, extra }) {
  // Tracing must never throw into the customer's code.
  try {
    if (!_config.apiKey) return;
    const ctx = getTestContext() || {};
    // agentId is required for live traffic; test traces are filed under the
    // test run's agent server-side, so they may be sent without one.
    if (!_config.agentId && !ctx.test_run_id) return;

    const payload = {
      agent_id: _config.agentId,
      api_key: _config.apiKey,
      trace_id: traceId,
      parent_trace_id: parentTraceId || null,
      conversation_id: _conversationId,
      turn: _turn,
      tool_name: toolName,
      input: input,
      output: output,
      error: error,
      latency_ms: latencyMs,
      timestamp: Date.now() / 1000,
      test_run_id: ctx.test_run_id || null,
      question_index: ctx.question_index != null ? ctx.question_index : null,
    };
    if (extra) payload.extra = extra;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    fetch(_config.traceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res && res.status >= 400) {
          let msg = "";
          try { msg = (await res.json()).message || ""; } catch { /* ignore */ }
          const key = res.status + "|" + msg;
          if (!_warned.has(key)) {
            _warned.add(key);
            console.warn("[clientcoded] trace rejected (" + res.status + "): " + (msg || "see the ClientCoded dashboard"));
          }
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
  } catch {
    // Never break the customer's agent
  }
}

function _safeSerializeInput(args) {
  try {
    const serialized = args.map((a) => _truncate(JSON.stringify(a), MAX_TRACE_CHARS, _describe(a)));
    return { args: serialized };
  } catch {
    return { error: "unserializable" };
  }
}

function _safeSerializeOutput(result) {
  if (result === null || result === undefined) return null;
  try {
    return _truncate(JSON.stringify(result), MAX_TRACE_CHARS, _describe(result));
  } catch {
    return "unserializable";
  }
}

// Short size summary for lists/results, e.g. "128 rows".
function _describe(v) {
  try {
    if (Array.isArray(v)) return v.length.toLocaleString("en-US") + " items";
    if (v && typeof v === "object") {
      if (typeof v.rows_returned === "number") return v.rows_returned.toLocaleString("en-US") + " rows";
      for (const k of ["result", "results", "rows", "data", "items", "records", "documents"]) {
        if (Array.isArray(v[k])) {
          const unit = ["result", "results", "rows", "records"].includes(k) ? " rows" : " items";
          return v[k].length.toLocaleString("en-US") + unit;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

function _truncate(s, maxLen = MAX_TRACE_CHARS, desc = null) {
  if (typeof s !== "string") return s;
  if (s.length > maxLen) {
    let note = s.length.toLocaleString("en-US") + " characters";
    if (desc) note += ", " + desc;
    return s.slice(0, maxLen) + "... (truncated: " + note + ")";
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
  extractTestContext,
  getTestContext,
  runWithTestContext,
  expressMiddleware,
  fastifyPlugin,
  configure,
  setConversationId,
  setTurn,
  incrementTurn,
  trace,
  traceSync,
  logTrace,
  autoInstrument,
};
