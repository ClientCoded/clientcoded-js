content = open('src/index.js').read()

# Edit 1: Add require for context at the top
old1 = "const https = require('https');"
new1 = "const https = require('https');\nconst { getTestContext } = require('./context');"
content = content.replace(old1, new1)
print('Edit 1 done - added context require')

# Edit 2: Add test context to _sendTrace payload
old2 = "      timestamp: Date.now(),"
new2 = "      timestamp: Date.now(),\n      test_run_id: getTestContext().test_run_id || null,\n      question_index: getTestContext().question_index != null ? getTestContext().question_index : null,"
# Only replace the first occurrence (in _sendTrace)
content = content.replace(old2, new2, 1)
print('Edit 2 done - added context to _sendTrace')

# Edit 3: Add exports for middleware and context
old3 = "module.exports = {"
new3 = """const { extractTestContext, runWithTestContext } = require('./context');
const { expressMiddleware, fastifyPlugin } = require('./middleware');

module.exports = {
  extractTestContext,
  getTestContext: require('./context').getTestContext,
  runWithTestContext,
  expressMiddleware,
  fastifyPlugin,"""

# Need to replace module.exports = { with the new version
# First, let's find what's after module.exports = {
content = content.replace("module.exports = {", new3, 1)
print('Edit 3 done - added middleware exports')

open('src/index.js', 'w').write(content)
print('All edits applied')
