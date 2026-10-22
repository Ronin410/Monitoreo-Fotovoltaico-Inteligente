import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 4000);

createApp().listen(port, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'pv-api escuchando', port }));
});
