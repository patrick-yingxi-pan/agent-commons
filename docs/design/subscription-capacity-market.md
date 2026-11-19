# A task market for unused AI subscription capacity

**Exploratory proposal.** Someone has half a weekly AI allowance left on the evening before it resets. Someone else has a task worth paying to finish tonight. Agent Commons could let the subscriber complete that task and use the earnings next week, when they need help themselves. What carries over is the reward for delivered work. The provider still controls when the subscription allowance resets.

This is one use of the proposed task coordination system. A subscriber can earn a funded reward, and a requester can require proof that a particular model performed the work. Volunteer tasks and tasks that accept any means of producing a verifiable answer use the same coordination design. [Task coordination](task-coordination.md)

Today, an Agent's owner pays for commissioned work and builds a contribution record. Paying strangers for work would introduce a separate agreement and cross-account data sharing. The existing design defers that decision. [Commission economics, D13](../agent-commons.md) · [Cross-organization scope](P8-agent-commons.md#25-forward-cross-org-sharing--marketplace)

## What one transaction would look like

| Step | Who acts | What they agree to or deliver |
| --- | --- | --- |
| Draft | Requester | Describe the work and the inputs a contributor may inspect. Specify the reward and an acceptance rule that Agent Commons or the accepted custodian can execute. If a particular model and reasoning effort matter, specify both and name the provider whose evidence is acceptable. |
| Fund and publish | Requester, custodian and Agent Commons | Deposit the full reward with Agent Commons or a trusted third party. Agent Commons publishes after verifying the custodian has reserved it for this task. A funding badge names the custodian. |
| Claim | Subscriber contributing capacity | Read the task and reward, decide whether the work is worth the quota, select a subscription, and confirm that it may be used for this task. The requester never receives the subscriber's login. |
| Run | Agent Commons and a participating model provider | Agent Commons sends the agreed task and its authorization to the provider through an official integration. The provider runs the task against the subscriber's allowance and returns the result directly to Agent Commons. |
| Verify and settle | Agent Commons and the named custodian | The designated party runs the agreed acceptance rule on the deliverable. When model and effort are required, verify the provider's evidence for that run as well. Once the terms are met, the custodian releases the reserved reward and Agent Commons records settlement. |

Suppose a requester requires a named model at high reasoning effort. A correct answer can satisfy the task's acceptance test while leaving open which model produced it. Signing in establishes who authorized a job. To certify the compute, the provider would also have to permit this use and identify the task, model, and effort it actually served. A separate compute provenance badge names the provider once Agent Commons verifies that evidence. The current session relay accepts a reply from a connected session and cannot establish those facts about the upstream model. [Session-provider trust boundary](../delegated-cognition-provider.md#2-why--and-the-honest-boundary)

## Pricing and payment

Requesters set the price for paid tasks. Contributors can accept or pass, and requesters could exclude providers whose results they distrust. A platform operator could publish quality comparisons alongside evidence supplied by participating providers. The author accepted price swings and opportunities for arbitrage as participants work out what a task is worth. As models improve, the same earnings may buy more or less work.

The discussion considered pricing work in ordinary currency or in fully backed credits. A requester can also offer a noncash reward if the custodian can reserve it in full and deliver it under the posted terms. Ordinary currency allows a requester to fund one task without opening a credit balance. In the credit example, one credit represents one yuan of balance. The subscriber can save the earnings and spend them against future offers at their posted prices. The proposed balance would need its own funding and settlement records. Today's contribution history records who did the work.

## First development slice

These are suggested experiments derived from the discussion. No provider partnership, payment mechanism, or initial customer segment was established.

1. **Find a task worth commissioning.** Try a bounded task with public inputs whose answer takes effort to produce and is cheap to check. For example, ask for a schedule satisfying a published set of constraints and run a checker against the submitted schedule. That example tests the mechanics. Evidence of demand would be a requester willing to post a second task at a price someone will accept.
2. **Exercise the agreement with a fixture.** Simulate a provider and a custodian, and label both. Try publishing with a partial deposit, then with the full test reward reserved. Only the fully funded offer should become visible, with the correct custodian named. Try two simultaneous claims, a changed task after consent, and a lost result acknowledgement. One contributor gets this claim, changed work needs fresh consent, and recovery never repeats a possibly charged run or pays twice. An uncertain run should stay open for review.
3. **Test the provider dependency separately.** With a willing provider, establish whether one job can be authorized, charged to the selected allowance, and tied to the actual model and effort in a result the platform can verify. A provider that cannot substantiate effort leaves that field unverified. Keep output quality and execution provenance visible as separate facts.
4. **Test a revision from the requester's own assistant.** Let the requester turn a conversation into a bounded work plan, submit it, inspect the result, and request a change. Use the same authorization and task state through the UI and authenticated Model Context Protocol (MCP) clients. Existing access parity supplies the pattern for these proposed operations. Before a paid pilot, decide who accepts a revision, what it costs, and how to settle a disputed or failed job. [MCP access model](../mcp-access.md)

## Discussion Q&A

The questions below paraphrase the original group discussion in English. The answers reflect the project author's responses at the time. The later task design clarifies that an offer denominated directly in ordinary currency also needs a confirmed deposit before publication. [Task coordination](task-coordination.md)

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
