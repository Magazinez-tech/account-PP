// Netlify Function that serves the whole /api surface through the Express app.
import serverless from 'serverless-http';
import { createApp } from '../../server/app.js';
import { ready } from '../../server/boot.js';

const app = createApp();

// Netlify may pass the function path (/.netlify/functions/api/...) instead of /api/...; map it back.
const FUNCTION_PREFIX = '/.netlify/functions/api';
const wrapped = serverless(app, {
  request(req) {
    if (req.url.startsWith(FUNCTION_PREFIX)) req.url = `/api${req.url.slice(FUNCTION_PREFIX.length)}`;
  },
});

export const handler = async (event, context) => {
  await ready();
  return wrapped(event, context);
};
