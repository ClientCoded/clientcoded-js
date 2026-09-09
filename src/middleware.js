const { extractTestContext, runWithTestContext } = require('./context');

/**
 * Express/Connect middleware
 * Usage: app.use(clientcoded.expressMiddleware())
 */
function expressMiddleware() {
  return (req, res, next) => {
    const ctx = extractTestContext(req.headers);
    if (ctx.test_run_id) {
      runWithTestContext(ctx, () => next());
    } else {
      next();
    }
  };
}

/**
 * Fastify plugin
 * Usage: fastify.register(clientcoded.fastifyPlugin)
 */
function fastifyPlugin(fastify, opts, done) {
  fastify.addHook('onRequest', (request, reply, next) => {
    const ctx = extractTestContext(request.headers);
    if (ctx.test_run_id) {
      runWithTestContext(ctx, () => next());
    } else {
      next();
    }
  });
  done();
}

module.exports = { expressMiddleware, fastifyPlugin };
