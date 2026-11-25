import './env.ts';

// Validate the environment before loading the server runtime and its dependencies.
const { default: App } = await import('./runtime/node/app.ts');

const app = new App({});

app.serve();
