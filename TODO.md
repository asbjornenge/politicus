# TODO

Deferred work — things that we decided to revisit later rather than ship now.

## Issue composition at scale

The current `composeIssue` pipeline sends every candidate bit's metadata
to Sonnet in one prompt. That's fine for tens of bits but won't survive
thousands a day. Two open problems:

1. **Pre-filtering without locking in engagement bias.** The obvious move
   is a rule-based score on `yay - nay + log(replies + 1) + recency_decay`
   and feed the top 30-40 to the LLM. But a substantive bit that hasn't
   accumulated engagement yet will get filtered out, and the front page
   becomes a popularity feedback loop. Worth thinking about how to
   surface high-substance, low-engagement work too.

2. **Score-on-arrival.** Idea: instead of scoring all bits at compose
   time, run a small classifier on each bit as it lands (topic,
   substance signal, novelty vs. recent posts). Persist the score per
   bit. Compose then just sorts by score within the window and picks
   top-N — fast, doesn't grow with daily volume. Open question is what
   model and what features make a useful "substance" signal that isn't
   just engagement in disguise.

Worth doing once volume actually justifies it; not yet a problem.
