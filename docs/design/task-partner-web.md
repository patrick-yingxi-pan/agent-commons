# Task partners in the web workspace

**Proposed web UI.** A partner organization registers capabilities in a **Task partners** collection. A requester or contributor uses those capabilities on the existing Project work item. The work item owns its terms, discussion and submission timeline. Its compact Project row and MCP projection read the same authorized task state. The integration API supplies the partner's evidence. [Task terms](task-coordination.md) · [Resource page templates](resource-page-templates.md) · [Partner OpenAPI contract](task-partner-api.openapi.json)

## Registering a partner

The organization administrator opens **Task partners → Register partner**. Each application has one addressable page. The authorized site operator reaches the same page from a review queue. The following wireframe shows a sandbox application with a failed check. Names, amounts and outcomes here are illustrative.

```text
Task partners / Orchard Services                         Sandbox
Orchard Services                                         Sandbox testing

Organization     Orchard Services              Administrator   Lee
Capability       Reward custody                Handoff host    orchard.example
Signing key      Fingerprint …91af             Key proof       Passed

Conformance checks
  Reserve 3 vouchers                            Passed
  Return a reservation                          Passed
  Replay a delivery acknowledgement             Failed
    Expected the original delivery reference. Received a second reference.
    [View test evidence]  [Run sandbox checks again]

Application history
  Lee submitted the application  ·  Service key proved
```

| Who acts | Controls and result |
| --- | --- |
| Partner administrator | Enter the organization identity, operational contact, requested capabilities, public signing key and exact HTTPS handoff URL. Review what task data each capability receives. Generate the service-key proof in the partner's keystore and submit the signed challenge from the administrator's session. The page displays the key fingerprint, proof state and expiry. |
| Partner engineer working with the administrator | Use the contract and sandbox fixtures linked from the application. The partner service pulls assigned commands and submits receipts. The page shows the report reference, each capability's checks and actionable failures. After the sandbox report passes, the administrator starts a production application referencing that report and proves control of a separate production key. |
| Site operator | Open the submitted evidence. Check the organization, environment, handoff host, proof of the production key, supported asset or proof types, and passing sandbox report for each requested capability. Record approved capabilities and a reason for a rejection or narrower approval. Production selection is limited to the active, approved scope. The applicant sees the decision and next action on its application. |
| Partner administrator or site operator, within their authority | Inspect key fingerprints and validity windows, prove a replacement key and watch rotation complete. Before suspension or revocation, the operator reviews all capabilities on this application in the selected environment and every open obligation. Record the actor, time, scope and outcome in the application history. |

Partner administrators see their own applications. Review authority belongs to a separate site operator and is checked again on submission. Both use the session-authorized application list and detail. Task selectors read the environment's approved catalog. A historical badge opens the issuer details recorded on the task when the evidence was accepted, including the issuer identifier for partners with similar names. Private contacts, onboarding evidence, operational logs and other tenants' applications are restricted to their authorized views.

## Publishing a task

In **Project → Work**, the requester describes the deliverable. **Volunteer** can publish under the usual Project permissions with just that description. An acceptance check and a model receipt are each optional. A request for feedback can receive a submission and discussion without a verifier, deposit or acceptance verdict.

Selecting **Offer a reward** opens fields for the exact asset, quantity, holder, release and return terms. The requester chooses an executable acceptance rule and an approved party to run it. The editor lists capabilities appropriate to that asset, rule and deployment environment. Both the site and an accepted custodian can be the holder or the verifier. Show a blocking condition beside its field, such as “Waiting for Orchard Services to confirm all 3 vouchers.” A receipt for two vouchers cannot support the badge. Preserve the draft and show how to resolve the shortfall. Enable publication only when the server confirms both the verifier's ability to run the agreed rule and a full reservation bound to these terms. An edit that adds a reward to a volunteer task goes through the same checks.

The following work item has a custody receipt and an optional provenance requirement chosen by its requester. Each evidence row opens its own details on the task.

```text
Project / Work / Compare model answers                   Open for submissions
Compare model answers
Submit both answers and their scores using the published rubric.

Reward           3 service vouchers held by Orchard Services  [View terms]
Acceptance       Rubric checker v2 · Agent Commons            [View rule]
Execution        Receipt required from Summit Models          [View model and effort]

[Review task and authorize run]

Activity
  Offer published  ·  3 vouchers reserved  ·  Terms version 4
```

The rule details identify inputs, pass condition, verifier and winner policy. Reward details identify the reserved quantity and form, holder, and release and return conditions. Execution details identify the accepted issuer, model and effort for this task. The task's status and badge text come from verified server records. A rule can pass while the required model receipt is still pending. The UI displays both facts.

## Consent, submission and settlement

1. **Review the proposed use.** Three actions need a task-scoped account selection. The requester authorizes a reservation, a contributor authorizes use of their model allowance, or a contributor selects where to receive a reward. Show the partner, task version, exact asset and quantity or model and usage limits, and data to be sent. **Continue to partner** posts a one-use code to the registered HTTPS partner page. Display the destination before leaving. The user signs in and selects the account on that partner's site.
2. **Confirm on return.** Restore the same task. Retrieve the handoff status from Agent Commons and display the confirmed partner identity, masked account and terms to the initiating user for final confirmation. For a payout, an eligible contributor confirms the masked destination before the holder is authorized to deliver. Following a return link or reopening the task resumes the status read. An expired handoff offers a new authorization after checking the previous operation. Credentials, single-use codes and raw receipts stay out of task URLs, activity entries and share previews.
3. **Submit and inspect.** The work item shows the submission and any required evidence against the terms it was submitted under. A verified receipt changes the provenance row to “Execution attested by Summit Models.” A recorded check shows its verdict and verifier. The detail view explains a mismatch such as the wrong model or an unmet rule. An unverified submission on an open-ended volunteer task remains available for discussion.
4. **Track delivery.** After all release conditions pass, the eligible contributor sees delivery pending until the holder confirms. The task then shows the delivered asset, quantity and holder, or the confirmed return under the offer's terms. Claimants see their own delivery details. Other Project viewers see only the authorized outcome. A timeout shows when status was last confirmed and offers **Check status**. A refresh or a second click reconciles the original operation.

The operator's recovery view groups unresolved operations and outstanding reservations by partner and age. Each entry identifies the task version, last confirmed state and correlation reference. A confirmed reserve remains an open obligation until delivery or return is confirmed. Suspension stops new assignments for every approved capability on that application in the affected environment. The holder and latest confirmed status remain visible during reconciliation. Pending, rejected, returned and delivered are distinguishable in text, including at narrow widths and with a screen reader.

## Browser acceptance scenarios

These are implementation acceptance tests. Run them against isolated partner fixtures with separate administrator, operator, requester and contributor accounts. Exercise the same task through an authenticated MCP client where the scenario calls for a second projection.

| Scenario | Observable result |
| --- | --- |
| Submit a custody application, fail an idempotent-delivery sandbox check, correct it, then obtain operator approval for custody only. | The administrator sees the failing check and later approval. The applicant cannot approve itself. The holder appears in the production custody selector only after activation and never appears as a model provider. |
| Post feedback requested from volunteers with only a description. Submit a response through MCP. | The work item shows the response and discussion. No verifier, wallet or receipt is needed. A volunteer nonce challenge that opts into a checker shows that check's verdict. |
| Offer three vouchers with an executable rule. Try a partial reservation, then a full reservation with a missing rule, then satisfy both. | The first two offers stay drafts with a specific blocking reason. The published row names the holder of all three vouchers. The page identifies the verifier independently. |
| Return from a simulated model-provider flow before confirmation. Decline the displayed account, then authorize a fresh run. Repeat the account selection for a voucher payout. | The first attempt produces no attestation badge. The resumed task shows the masked account, purpose and limits before confirmation. A grant for another task version cannot authorize the run. Only the contributor sees the masked payout destination. |
| Supply a valid answer with a receipt for a different run, then inspect the task as requester and contributor. | The answer's verdict remains visible, the requested provenance remains unverified, and the custodian receives no release authorization for that submission. Raw receipts and private account details are absent from the shared page. |
| Lose the delivery acknowledgement, refresh the page and suspend the holder while the operation is pending. | The contributor and operator can see which delivery is unresolved. New assignments exclude the suspended application. Reconciliation associates one confirmed outcome with the existing operation without a second transfer. |
| Open another tenant's application by deep link. Revisit a permitted work item with the keyboard at a 320-pixel viewport. | The first response reveals no private application data. On the permitted item the user can reach each trust detail and recovery action, read text labels, and return focus to the opener. No critical amount, unit or issuer is clipped. |
