import { createApp } from './app';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = createApp();
app.listen(PORT, () => {
  console.log(`openapi-spec-scorer API listening on port ${PORT}`);
});
