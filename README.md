# n8n-nodes-starreview

This is an n8n community node for [StarReview](https://www.starreview.ch), the review reply service for local businesses. It lets your workflows list unanswered reviews, pull review context and stats, draft replies, and submit replies to the owner's approval queue.

[n8n](https://n8n.io/) is a fair-code licensed workflow automation platform.

## The safety model

This node is a thin client over StarReview's hosted agent API. It can draft and submit, nothing more:

- Your workflow (or an AI agent inside it) drafts a reply or picks a drafted variant.
- Every submitted reply lands in the owner's approval queue inside StarReview.
- The owner approves, and StarReview publishes the reply from its own infrastructure.
- The node can never publish a reply itself, on any platform.
- Platforms without a reply API (for example TripAdvisor) come back as `awaitingManualPost` with a deep link; the owner posts through the platform's own portal.

## Installation

Self-hosted n8n:

1. Open Settings > Community Nodes.
2. Select Install and enter `n8n-nodes-starreview`.

Alternatively, install it into your custom nodes folder:

```
cd ~/.n8n/custom
npm i n8n-nodes-starreview
```

## Credentials

1. Log in to StarReview and open Settings, section Agent-Zugang.
2. Create an agent API key (it starts with `sragt_`).
3. In n8n, create a StarReview API credential and paste the key. Leave the base URL at `https://mcp.starreview.ch/`.

The key is scoped to your business. If it is ever exposed, revoke it in the same settings section and create a new one.

## Nodes

### StarReview

| Resource | Operation | What it does |
| --- | --- | --- |
| Location | List | Lists every connected location across review platforms |
| Review | List Unanswered | Lists reviews awaiting a reply (one n8n item per review) |
| Review | Get Stats | Review KPIs: totals, average rating, response rate, backlog, per-provider breakdown |
| Review | Get Context | Full context for one review, including every drafted reply variant |
| Reply | Draft | Generates reply draft variants for a pending review |
| Reply | Submit for Approval | Sends one drafted variant (optionally edited) to the owner approval queue |
| Reply | Submit Own Reply | Sends your own reply text to the owner approval queue |

Provider values (`google`, `tripadvisor`, ...) are open-ended. New platforms appear as they are connected, so never hardcode the list in your workflows.

### StarReview Trigger

Polling trigger for the event "New Unanswered Review". It checks for unanswered reviews on the schedule you set, remembers which reviews it has already seen, and emits only new ones (one item per review). A manual test run emits the latest unanswered review without marking it as seen.

## Example workflow

1. **StarReview Trigger**: New Unanswered Review, polling every 15 minutes.
2. **StarReview**: Reply > Draft, with Review ID set to `{{ $json.reviewId }}`.
3. **Slack**: notify the owner with the draft text and a note that the reply is waiting for approval in StarReview.

The owner then approves in StarReview, which handles publishing.

## Compatibility

Requires n8n 1.x and Node.js 20 or newer. Tested against the hosted StarReview agent endpoint.

## Resources

- [StarReview](https://www.starreview.ch)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
