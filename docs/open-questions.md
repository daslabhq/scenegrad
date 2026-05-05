# Open questions

The protocol is small; the unsolved problems around it are not. These are invitations, not gaps in the v0.0.1 implementation.

If you have an opinion on any of these, open an issue or PR. The protocol document is meant to evolve with the conversation.

---

## 1. What's a *good* distance function over a typed scene?

Default: weighted sum of unmet-assertion gaps. It works for most demos. It breaks the moment assertions are correlated, when satisfied-but-shaky beats unsatisfied-but-stable, or when the agent should be rewarded for *partial* progress on hard assertions vs *complete* progress on easy ones.

Open questions:
- Should the framework offer principled aggregations (max, log-sum-exp, learned-from-data) as built-ins?
- How do you handle assertions whose gap units differ (rows vs cells vs cosine similarity)?
- Is there a domain-independent distance, or is distance fundamentally a domain-author craft?

## 2. How do you compute *semantic* diffs?

v0 ships a top-level key-set diff. That's clearly insufficient for typed scenes (you want `EmailPatch` not `Patch{changed_keys: ["draft"]}`). [scenecast](https://github.com/daslabhq/scenecast) defines canonical scene shapes; the diff types should hang off those.

Open questions:
- What's the right per-canonical-asset diff shape? (`EmailPatch`, `MessagePatch`, `RowPatch`, `EventPatch`, …)
- Should diff types support partial / approximate matches (e.g. for LLM-rewritten text)?
- How do you diff scenes whose shape *itself* changed (schema migration mid-trajectory)?

## 3. What's the right scoring rubric for a Predictor?

`evalWorldModel` v0 reports outcome accuracy, scene-match (deep equal), delta-match (key-set), confidence, and 10-bin ECE. Deep equality is brittle; a predictor that gets the structure right but a value slightly wrong scores 0%.

Open questions:
- Should scene-match be replaced with a typed equivalence (using scenecast canonical shapes)?
- What's the right metric for "predicted the right *reason* something happened" (a richer success signal than scene equality)?
- How do you compose accuracy across heterogeneous task suites (AutomationBench + τ-bench + LeRobot)?
- Is there a calibration metric better suited to this domain than ECE?

## 4. How do gradients compose across multi-actor scenes?

Today, one agent acts on one scene. Real systems are multi-agent (orchestrator + sub-agents), multi-actor (humans + agents share the scene), and multi-time (some assertions only become checkable later).

Open questions:
- What's the protocol shape for "this assertion can only be evaluated 24h later"?
- How does the trajectory format handle two actors interleaving steps on the same scene?
- Can predictors model *human* responses as part of the scene? (Reply prediction, approval prediction, …)

## 5. Scene design as a teachable craft

Scenes are the unit of agent work, but there's no equivalent of "single responsibility principle" or "keep components small" for them yet.

Open questions:
- What heuristics actually work? (We have intuitions: "include only what's needed for the next action," "don't conflate snapshot with derived view." We don't have laws.)
- Is there a pattern language? (Trigger-scene, summary-scene, diff-scene, plan-scene, …?)
- When should a scene split into two? When should two scenes merge?
- Is there an analog of "code smells" — *scene smells* — that flag a poorly-designed scene before it causes failures?

## 6. The cold-start moat

The thesis is that per-org learned predictors compound — more traces → better predictions → defensible flywheel. But on day one a customer has zero traces.

Open questions:
- What's the best cross-org prior to bootstrap from? (Trained on canonical scene shapes? On benchmark trajectories?)
- How do you transfer a predictor from a Gmail-rich org to an Outlook org?
- What's the minimum trace volume for a kNN predictor to beat an LLM predictor on the same env?

## 7. Adversarial scenes

If a tool can affect a scene field that an assertion checks, an adversarial agent (or an over-eager one) can satisfy assertions without doing the work.

Open questions:
- Is there a notion of "tamper-evident" scenes — fields that prove their own provenance?
- Should assertions distinguish "achieved by intended means" from "achieved at all"?
- How do you stress-test an assertion suite against gaming?

---

## Want to push back?

These are working-state, not committed. If you've thought hard about any of these, the issues tab is the right place. Especially welcome: counter-examples that break a current default, or pattern languages you've found load-bearing in your own agent work.
