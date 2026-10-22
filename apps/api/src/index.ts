import { loadEnvOrExit } from '@pv/config';
import { createApp } from './app.js';

const env = loadEnvOrExit();
const port = env.PORT ?? 4000;

createApp().listen(port, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'pv-api escuchando', port }));
});
