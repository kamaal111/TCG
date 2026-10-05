# Logging

Server logging uses structured events with flat, snake_case fields. Normal output is JSON;
`DEBUG=true` selects `pino-pretty` output for local development. Domain accessors constrain their
event and field vocabulary. This document is the contract: read it before adding a log line.

## Where log lines come from

`@hono/structured-logger` owns the request lifecycle. `server/src/logging/middleware.ts` configures it;
`server/src/logging/index.ts` constructs the root pino logger and request child loggers:

- It creates one pino child logger per request and stores it on `c.var.logger`.
- It times the handler and emits exactly **one request lifecycle** line per request — `request.completed`
  for a returned response (including an error status), or one of
  `request.error` / `request.validation.failed` / `request.failed` when the handler throws.
  Domain and auth events can emit additional lines for the same request.
- It must stay registered after `requestId()`, whose value it reads.

These fields are bound once, for the whole request, and **must never be passed by a call site**:

| Field                                 | Source                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `service`, `mode`                     | pino base bindings                                                             |
| `request_id`                          | `hono/request-id`, from the `tcg-request-id` header                            |
| `method`, `path`, `url`, `user_agent` | the incoming request                                                           |
| `user_id`                             | `bindSessionUser` in `server/src/auth/module.ts`, once the session is resolved |
| `level`, `time`, `msg`                | pino                                                                           |

The domain field types deliberately do not declare any of them, so passing one in a domain
accessor's object literal is a compile error rather than a silently shadowed value.

`server/src/exceptions/handler.ts` shapes error responses and does **not** log — the middleware's `onError` hook
records every failure. Logging in both would duplicate every error line.

## The domain logger

Each application domain owns one `logging.ts` declaring its events and fields, and exports an
accessor. Logger construction stays in `server/src/logging/index.ts`. Auth events and their field
vocabulary are supplied by `@kamaalio/kamaal-auth-hono`, which receives the request logger.

| Module                               | Events      | Accessor                                                 |
| ------------------------------------ | ----------- | -------------------------------------------------------- |
| `server/src/cards/logging.ts`        | `cards.*`   | `cardsLogger(c)`                                         |
| `server/src/card-pricing/logging.ts` | `pricing.*` | `pricingLogger(c)`                                       |
| `server/src/card-images/logging.ts`  | `images.*`  | `imagesLogger(c)` / `processImagesLogger()`              |
| `server/src/logging/request.ts`      | `request.*` | `requestLogger(c)`                                       |
| `server/src/logging/server.ts`       | `server.*`  | `serverLogger()` — process lifecycle, not request-scoped |

A domain module looks like this:

```ts
export const CARDS_EVENTS = ['cards.create', 'cards.list' /* … */] as const;

export type CardsLogFields = DomainLogFields<(typeof CARDS_EVENTS)[number]> & {
  card_id?: string;
  result_count?: number;
  game?: CardGame;
};

export const cardsLogger = (c: HonoContext): DomainLogger<CardsLogFields> => getDomainLogger(c);
```

`DomainLogFields` (in `server/src/logging/index.ts`) contributes the shared fields: a **required** `outcome`, plus
optional `error_code` and `duration_ms`. Domain fields are optional, so a domain's events share one field type
without per-event bookkeeping.

A call site:

```ts
cardsLogger(c).info(
  { event: 'cards.delete', outcome: 'success', card_id: cardId },
  'Deleted an owned card from the collection.',
);
```

In a class that holds the context, expose it once:

```ts
private get logger() {
  return pricingLogger(this.c);
}
```

## What the compiler catches

There is no index signature anywhere in the field types, so on an object literal:

| Written                                             | Result                                                    |
| --------------------------------------------------- | --------------------------------------------------------- |
| `event: 'cards.deleted'`                            | error — the event union is closed                         |
| `{ event: 'cards.list', card_count: 3 }`            | error — `card_count` is not a `CardsLogFields` field      |
| `{ event: 'cards.list', lock_wait_ms: 5 }`          | error — pricing fields cannot leak into a cards line      |
| `pricingLogger(c).info({ event: 'cards.list', … })` | error — events do not cross domains                       |
| `{ event: 'cards.list', request_id: id }`           | error — request-scoped fields are bound by the middleware |
| `{ event: 'cards.list' }`                           | error — `outcome` is required                             |

> **Always pass an object literal.** TypeScript's excess-property check only fires on literals; spreading a
> pre-built variable into the call silently bypasses the whole guarantee.

What the compiler does **not** check is which fields a _specific_ event requires — `card_id` is optional across all
`cards.*` events. That is a deliberate trade: the guarantee lands at the domain boundary, which is where the
vocabulary actually drifted.

## Rules

**Event names** — `<domain>.<action>[.<detail>]`, lower snake within a segment, prefix matching the domain.
`server/src/logging/tests/events.test.ts` enforces this and rejects duplicates.

**Field names** — snake_case. Values are scalars or arrays of scalars, so every line stays greppable and every
field is safe to index. The one object ever logged is `err`, which pino's standard serializer expands.

**Levels**

| Level   | Use for                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `info`  | An expected outcome — work completed, a cache was consulted, a request finished.                                                        |
| `warn`  | A handled failure, usually caused by the caller: validation, a missing resource, a provider being unavailable. Always set `error_code`. |
| `error` | An unexpected server failure. Always pass `err`.                                                                                        |

**Never log** tokens, JWTs, cookies, session material, passwords, email addresses, request or response bodies,
whole entities, lock keys, or raw user search terms. Log the _shape_, not the value — `lock_key_type`, not
`lock_key`. Redaction in `createLoggerOptions` is a backstop for dependencies that log a vocabulary we do not
control, not a licence to pass secrets.
The request logger removes the query string from the incoming `url` before binding it.
This keeps raw set filters, search terms, and credentials in query parameters out
of every request and domain log. Top-level redaction does not sanitize values
embedded in URLs; never bind the original request URL elsewhere.

**`console` is banned** in `server/src` (oxlint `no-console`). The CLI scripts under `server/scripts` are exempt.

## Recipes

**Add an event to an existing domain** — add the name to that domain's `*_EVENTS` array. If it needs a field the
domain does not have yet, add it as an optional member of the domain's field type. Then log it.

**Add a new domain** — create `<domain>/logging.ts` following the shape above, and register its `*_EVENTS` in
`server/src/logging/tests/events.test.ts`.

**Log an error**

```ts
pricingLogger(c).error(
  { event: 'pricing.search.completed', outcome: 'failure', error_code: 'PRICING_PROVIDER_UNAVAILABLE', err },
  'Card pricing search failed unexpectedly.',
);
```

**Assert on logs in a test** — use the `withRequestId` and `getLogsForRequestId` fixtures:

```ts
integrationTest('logs the deletion', async ({ app, getLogsForRequestId, withRequestId }) => {
  const { headers, requestId } = withRequestId(sessionHeaders(token));
  await app.request(path, { method: 'DELETE', headers });

  expect(getLogsForRequestId(requestId)).toEqual(
    expect.arrayContaining([expect.objectContaining({ event: 'cards.delete', card_id: cardId })]),
  );
});
```

## Anti-patterns

- Inventing a synonym for a field that already exists (`card_count` next to `result_count`, `provider_source` next
  to `pricing_source`). Reuse the existing name, or rename everywhere.
- Re-binding a per-call `component` or `route`. `route` is emitted on `request.*` lines; correlate everything else
  by `request_id`.
- Logging in `app.onError()` — the middleware's `onError` already covers every failure.
- Calling `c.get('logger')` directly in application code. Its generic `RequestLogger` methods
  accept fields extending `DomainLogFields<string>`; they do not restrict event names to a closed
  domain union. Use a domain accessor to enforce the domain's event and field vocabulary.

## Pricing lock failures

`pricing.lock.completed` distinguishes acquisition failures from failures of the
protected operation. Acquisition timeouts use `PRICING_LOCK_TIMEOUT`; other
acquisition failures use `PRICING_PROVIDER_UNAVAILABLE`. Once acquired, provider
failures retain `lock_status: acquired` and use `PRICING_PROVIDER_UNAVAILABLE`;
unexpected operation failures use `PRICING_OPERATION_FAILED`. Provider warnings
remain visible when collection listing returns affected prices as `unavailable`.

Unexpected acquisition and operation failures log at error level, retaining the
original diagnostic cause in `err`. Their returned API exceptions expose the safe
`INTERNAL_SERVER_ERROR` response. Timeouts and provider failures remain warnings.
