import { buildApp } from './app.js';

const { app } = await buildApp();
const port = parseInt(process.env.PORT || '8787', 10);
app.listen(port, () => {
  console.log(`TurboCanal rodando em http://localhost:${port}`);
});
