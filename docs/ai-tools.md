# Which AI tools did you use?

Paste the section below into the submission field. It separates tools used **to build** Recall from
models that **ship inside** it, because the two are different claims.

> ⚠️ Written from what the repository evidences. If you used anything else — ChatGPT, Copilot, an
> editor assistant — add it; this list only covers what is visible here.

---

**Building it**

- **Claude Code** — the main development tool throughout, and the repository's commit history is
  largely its output. It was used for implementation, but the places it earned its keep were
  diagnostic: tracing a semantic-recall bug to a similarity figure we had measured wrong (we had
  embedded the bare query; the server prepends an instruction prefix first), and then to the real
  cause, which was that our retrieval thresholds belonged to the embedding model rather than to our
  code. It also found the class of bug that tests cannot see — four console pages that had data only
  because someone had been testing by hand, and a deployed environment variable still set to the
  wrong timezone after the demo moved regions.
- **Claude Desktop** — used as the **Alexa+ stand-in** for the first three weeks. There is no way to
  point real Alexa+ at a self-hosted MCP server outside the Preview programme, so connecting Claude
  over Streamable HTTP was how the tools were exercised like an assistant would exercise them,
  before our own simulated Alexa+ existed.
- **Ollama — `qwen3:8b` and `qwen3-embedding:0.6b`** — run locally for fact extraction, rule parsing
  and embeddings during development, so iterating on prompts and retrieval cost nothing and worked
  offline. Swapping to Bedrock for production was a provider class and an environment variable —
  and the swap is what exposed the threshold bug above, because the two models score similarity on
  completely different scales.

**Shipping inside the product**

- **Amazon Bedrock — Nova Lite** for fact extraction, the deduplication judge, and as the assistant
  in our simulated Alexa+.
- **Amazon Bedrock — Titan Text Embeddings V2** for semantic recall and duplicate detection.
- **Amazon Polly** for the assistant's spoken replies.

**One deliberate limit.** No model is on the read path. Extraction, judging and embedding run as
background jobs; retrieval, per-person access control and rule enforcement are pure functions with
tests. An AI tool helped write those functions — it is not consulted when they run.
