// Local development / self-hosted server. On Netlify, netlify/functions/api.js is used instead.
import { createApp } from './app.js';
import { ready } from './boot.js';

const port = Number(process.env.PORT) || 3000;

ready()
  .then(() => {
    createApp().listen(port, () => console.log(`Server running at http://localhost:${port}`));
  })
  .catch((err) => {
    console.error('Startup failed. Check DATABASE_URL and the database connection.', err);
    process.exit(1);
  });
