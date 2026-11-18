# A task market for unused AI subscription capacity

**Exploratory proposal.** Someone has half a weekly AI allowance left on the evening before it resets. Someone else has a task worth paying to finish tonight. Agent Commons could let the subscriber complete that task and use the earnings next week, when they need help themselves. What carries over is the reward for delivered work. The provider still controls when the subscription allowance resets.

The project began as a UI proposal and grew into a collaboration platform. This idea explores one further use for it. Today, an Agent's owner pays for commissioned work and builds a contribution record. Paying strangers for work would introduce a separate agreement and cross-account data sharing. The existing design defers that decision. [Commission economics, D13](../agent-commons.md) · [Cross-organization scope](P8-agent-commons.md#25-forward-cross-org-sharing--marketplace)

## What one transaction would look like

| Step | Who acts | What they agree to or deliver |
| --- | --- | --- |
| Post | Requester | Describe the work, share the inputs a contributor may inspect, state how completion will be checked, and offer a price. If a particular model and reasoning effort matter, specify both. |
| Claim | Subscriber contributing capacity | Read the task and price, decide whether the work is worth the quota, select a subscription, and confirm that it may be used for this task. The requester never receives the subscriber's login. |
| Run | Agent Commons and a participating model provider | Agent Commons sends the agreed task and its authorization to the provider through an official integration. The provider runs the task against the subscriber's allowance and returns the result directly to Agent Commons. |
| Verify and settle | Agent Commons | Check the deliverable against the posted terms. If the requester specified a model and effort, check the provider's evidence for both. Record completion and award the agreed payment once all the terms are met. |

**The hard dependency is evidence from the model provider.** Suppose a requester pays for a named model at high reasoning effort. A correct answer can satisfy the task's acceptance test while leaving open which model produced it. Signing in establishes who authorized a job. To certify the compute, the provider would also have to permit this use and identify the task, model, and effort it actually served. The current session relay accepts a reply from a connected session and cannot establish those facts about the upstream model. [Session-provider trust boundary](../delegated-cognition-provider.md#2-why--and-the-honest-boundary)

## Pricing and payment

Requesters set the reward for each task. Contributors can accept or pass, and requesters could exclude providers whose results they distrust. A platform operator would supply evidence about compute quality. The author accepted price swings and opportunities for arbitrage as participants work out what a task is worth. As models improve, the same earnings may buy more or less work.

The initial idea used credits for earning now and spending later. Two payment designs emerged in the discussion. A requester could pay directly in ordinary currency, or prepay a fully backed balance. In the latter example, one credit represents one yuan of balance. Its purchasing power in tasks depends on current offers. The proposed balance would need its own funding and settlement records. Today's contribution history records who did the work.

## First development slice

These are suggested experiments derived from the discussion. No provider partnership, payment mechanism, or initial customer segment was established.

1. **Find a task worth commissioning.** Try a bounded task with public inputs whose answer takes effort to produce and is cheap to check. For example, ask for a schedule satisfying a published set of constraints and run a checker against the submitted schedule. That example tests the mechanics. Evidence of demand would be a requester willing to post a second task at a price someone will accept.
2. **Exercise the agreement with a fixture.** Use a test reward and a clearly labeled simulated provider. Try two simultaneous claims, a changed task after consent, and a lost result acknowledgement. Acceptance means one contributor gets the claim, changed work needs fresh consent, and recovery never repeats a possibly charged run or pays twice. An uncertain run should stay open for review.
3. **Test the provider dependency separately.** With a willing provider, establish whether one job can be authorized, charged to the selected allowance, and tied to the actual model and effort in a result the platform can verify. A provider that cannot substantiate effort leaves that field unverified. Keep output quality and execution provenance visible as separate facts.
4. **Test a revision from the requester's own assistant.** Let the requester turn a conversation into a bounded work plan, submit it, inspect the result, and request a change. Use the same authorization and task state through the UI and authenticated Model Context Protocol (MCP) clients. Existing access parity supplies the pattern for these proposed operations. Before a paid pilot, decide who accepts a revision, what it costs, and how to settle a disputed or failed job. [MCP access model](../mcp-access.md)

## Discussion Q&A

The questions below paraphrase the group discussion in English. The answers reflect the project author's responses. Suggestions from other participants and questions left open are identified where they affect the design.

| Question raised | Answer from the discussion |
| --- | --- |
| Can I deposit my unused quota before the weekly reset? Does the platform buy it? | You need someone with work to offer. Completing their task before reset earns a reward you can spend later. The operator could post its own tasks on the same terms as anyone else. There is no standing offer to buy quota. |
| Why would I use this instead of renting out an account or using a relay? | You choose the work and authorize a particular job. The proposed provider integration keeps your sign-in with the provider and delivers the result to the platform. A relay alone leaves the buyer to trust whoever supplies the answer. |
| What keeps a contributor from supplying a cheaper model? | The author's preferred answer was direct provider execution with evidence of model and effort. Participants suggested output fingerprints, random checks, and reputation. The author suggested comparing several samples and letting requesters filter providers. These checks can flag poor results. They cannot certify a particular run. |
| Could someone use my allowance for an unrelated task and get my account suspended? What about private inputs? | The contributor would inspect the work before confirming. The grant would cover only that task, and the platform would submit it directly to the provider. The suggested starting point was work safe to disclose. Provider permission and the remaining account risk are open. |
| My work takes several rounds of conversation. Must I open the site and post everything again? | Keep planning and reviewing in your own assistant. Once a step is clear, ask it to submit that work through MCP. It can request follow-up work from the same conversation. Live dialogue inside a claimed run and the price of revisions were left open. |
| If models and prices change, what does a credit buy? | Under the prepaid option it represents a funded currency amount. The requester posts a price and contributors judge it against the work. Direct payment would also work. Neither approach promises the same quantity or quality of inference next month. |
| What if everyone has spare quota and nobody has work? | A participant recalled an earlier service where contributors could find no jobs. The author agreed that the market needs enough paying requesters as well as willing contributors. How to attract recurring demand remains open. |
| Who pays to host it, and will model providers participate? | The author's goal was to build useful open-source software. An independent operator could host it and set fees. Operating costs, commercial viability, and provider adoption remain open. The discussion referred to LGPLv3. The repository's current license is **AGPL-3.0-only**, which permits paid hosting under its terms. [Project licensing](../../LICENSING.md) |
