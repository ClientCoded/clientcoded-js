const { AsyncLocalStorage } = require('node:async_hooks');

const testContextStorage = new AsyncLocalStorage();

function extractTestContext(headers) {
  const raw = headers['x-clientcoded-context'] || headers['X-Clientcoded-Context'];
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }
  return {};
}

function getTestContext() {
  return testContextStorage.getStore() || {};
}

function runWithTestContext(ctx, fn) {
  return testContextStorage.run(ctx, fn);
}

module.exports = { extractTestContext, getTestContext, runWithTestContext };
