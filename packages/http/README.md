# Shared HTTP infrastructure

`@tcg/http` owns the Hono error handler, custom exception bases, validation/OpenAPI
helpers, request IDs, structured logging, HTTP constants, the Node logger factory and graceful Node server shutdown.
Both the production server and Devportal service import these implementations.
It does not import production configuration, application routes, persistence or
authentication. Callers import shared infrastructure directly from this package; application
domains retain their own routes, errors and logging declarations.

The production API supplies its own context and authentication. Devportal supplies
Tailscale identity authorization and release services. Importing this package
starts neither service. Both runtimes register the shared shutdown handler when starting;
it drains HTTP requests, disposes resources and enforces one shutdown deadline. Request logging keeps its existing event vocabulary and
redaction behavior; see `server/docs/logging.md`.
