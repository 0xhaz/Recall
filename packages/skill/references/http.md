# Calling Recall over HTTP

Recall is an MCP server on Streamable HTTP. With an MCP client configured, use the tools directly —
this is the fallback for when there is no client, or for checking something by hand.

## What you need

- The endpoint, ending in `/mcp` (`http://localhost:3100/mcp` when run locally).
- A household token: `Authorization: Bearer <token>`. A token belongs to one household and is how
  the server knows whose memory is being asked for.

## The shape of a call

Tools are JSON-RPC over POST. The `accept` header must list both types or the request is refused.

```sh
curl -s -X POST "$RECALL_URL" \
  -H "Authorization: Bearer $RECALL_TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"session_brief",
                 "arguments":{"speaker":"Emma","speaker_confidence":0.95,
                              "device":"kitchen-echo","hint":"what should we cook tonight?"}}}'
```

`tools/list` with no params returns the full surface with its schemas.

The reply may come back as an SSE frame — a `data: ` prefix on the JSON. Strip it before parsing,
and read the tool's own payload from `result.content[0].text`, which is itself JSON.

## Two things that will bite

**The speaker is not optional in practice.** Omit it and you get household facts only, plus
`ask_who_is_speaking: true`. That is correct behaviour, not an error: Recall will not guess who is
talking, and neither should you.

**A token is a household, not a person.** It says which household is being asked about. Who is
speaking comes from the `speaker` argument, and what that person may see follows from their
membership. A token does not let you read one person's memory as another.

## Health and latency

- `GET /health` — database and model reachability.
- `GET /metrics/latency` — p50/p95 per tool against its budget. Empty until tools have been called,
  and the first call after a restart pays the model's cold start; read it warm.
