# SplitMate — Product Requirements Document (PRD)

| Field        | Value                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| Product      | **SplitMate** — collaborative expense management for shared households          |
| Document     | Product Specification (Deliverable #3)                                          |
| Version      | 1.0                                                                             |
| Author       | Oded (RUNI CS 2026, Internet Technologies Final Project)                        |
| Status       | Approved for implementation                                                     |
| Related docs | [Architecture](./02-architecture.md) · [Technical Spec](./03-technical-spec.md) |

---

## 1. Executive Summary

SplitMate is a web application that lets people who **share living costs but not a bank account** track shared expenses, split them fairly, and settle debts with a minimum number of transfers.

A household creates a shared workspace, invites its members, and logs every shared cost — rent, electricity, groceries, the internet bill, the new kettle. Each expense is split using whichever rule the household agrees on (equally, by exact amounts, by percentage, or by weighted shares). SplitMate continuously derives every member's net position and, when someone wants to settle up, computes the **smallest set of payments** that clears the entire household's debts.

Around that spine sits everything that makes the habit stick: a real-time shared shopping list that converts directly into an expense at checkout, photographed receipts attached to expenses, automatic reminders for recurring bills, and a monthly analytics dashboard.

> **The one-sentence pitch:** SplitMate removes the awkward conversation from shared living by making "who owes whom, and why" objective, transparent, and one tap away from settled.

---

## 2. The Problem

### 2.1 What actually goes wrong

Shared households do not fail at _arithmetic_. They fail at **record-keeping, fairness, and social friction**. Three distinct failure modes:

**Failure mode 1 — The ledger lives in someone's head.**
The default tools are a WhatsApp group and memory. Expenses are announced ("I bought toilet paper, 40 shekels") and then lost in the scroll. Within two weeks nobody can reconstruct the month. The person with the best memory — or the loudest voice — ends up with the most favourable settlement.

**Failure mode 2 — "Split equally" is often the wrong answer, but it's the only easy one.**
Real households are not uniform. One roommate has the master bedroom. One is abroad for three weeks. One is vegetarian and doesn't want to pay for the meat run. Two of five roommates share a car. Existing lightweight tools push everything toward an equal split because anything else is tedious, so households either accept an unfair result or abandon the tool.

**Failure mode 3 — Nobody wants to be the one who asks for money.**
This is the real killer. Even when the numbers are known, chasing ₪180 from a friend you live with is socially expensive. Debts accumulate silently, resentment builds, and the eventual reckoning is a fight. Research into shared-living disputes consistently ranks money as the top source of conflict, above cleanliness and noise.

### 2.2 Why existing solutions leave a gap

Manual approaches (a shared spreadsheet, a Notes file, WhatsApp) are free and flexible but have no integrity guarantees, no notion of identity, no automatic balance calculation, and no way to prove what was agreed. General-purpose expense splitters solve the arithmetic but treat the household as a one-off event rather than an ongoing shared operation — they have no concept of the _shopping list that becomes the grocery expense_, no recurring rent automation, and no per-household analytics. Banking apps see the transaction but not the split.

**SplitMate's wedge:** treat the household as a persistent, multi-user, permissioned workspace with an append-only financial ledger — and then wrap the ledger in the day-to-day workflows (shopping, receipts, reminders) that make people open the app when they _aren't_ thinking about money.

### 2.3 Problem statement

> People in shared households lack a trusted, shared, always-current record of who paid for what and how it should be divided. The absence of that record converts ordinary domestic spending into recurring social conflict and unrecovered money.

---

## 3. Target Users

### 3.1 Primary segment

Adults aged 20–35 sharing a residence with two to six people, in an urban rental market, who transact digitally and already use instant peer-to-peer payment apps (Bit, Paybox, Venmo, Revolut). They are comfortable with web apps and expect a mobile-quality experience in the browser.

### 3.2 Personas

**Maya, 23 — the Organiser.** Third-year student, shares a four-bedroom flat near campus. She is the one who currently maintains the spreadsheet and sends the monthly "please transfer me" message. She is the buyer and the champion: she will create the household and invite everyone.
_Her job-to-be-done:_ stop being the household's unpaid accountant, and stop feeling like a nag.
_Success for her:_ the app sends the reminders so she doesn't have to.

**Yonatan, 26 — the Casual Participant.** Works full time, contributes but doesn't want to manage anything. He will log an expense only if it takes under fifteen seconds, and he will never open a settings page.
_His job-to-be-done:_ prove he already paid his share without keeping receipts.
_Success for him:_ opens the app, sees "you owe Maya ₪124", taps settle, done.

**Noa, 22 — the Fairness Sceptic.** Lives in the small room, travels often, and is quietly convinced she overpays. She is the reason flexible splits and full history exist.
_Her job-to-be-done:_ verify that the split reflects reality, and challenge it when it doesn't.
_Success for her:_ she can open any expense, see exactly how it was divided, see who edited it and when, and see a receipt photo.

**Tal, 30 — the Couple-in-a-Shared-Flat.** Shares the flat with two others but splits their own portion proportionally to income with a partner. Represents the weighted-share use case.

### 3.3 Secondary segments (validate later, do not build for now)

Friend groups on shared trips; families splitting costs with adult children; small co-working or hobby groups with a shared kitty.

### 3.4 User vs. Customer

The rubric distinguishes these deliberately, and for SplitMate they are worth separating:

**In the launch model, the user is the customer.** Households self-serve, and monetisation is a per-household subscription. The person who pays is typically the Organiser persona, because she captures the most value (she stops doing manual work).

**The credible expansion is B2B2C: student housing operators and co-living companies.** For them, roommate financial disputes are a measurable operational cost — support tickets, mediation, mid-lease move-outs, and unit turnover. A white-labelled SplitMate bundled into a tenancy is a retention product. In that model the operator is the customer and the tenant is the user. We are not building this, but the architecture (multi-tenant households with role-based permissions and per-household isolation) does not preclude it, which is the point worth making.

---

## 4. Business Goals & Success Metrics

### 4.1 Goals

1. **Become the household's default financial record within one week of signup.** A household that logs expenses for two consecutive weeks rarely churns, because the accumulated history is itself the switching cost.
2. **Convert free households into paying households through storage and insight**, not through paywalling the core ledger. The ledger must stay free — a partially-paywalled ledger loses the network effect, because one unpaid roommate breaks the group.
3. **Grow virally through the invitation loop.** Every household creation invites 1–5 new users at zero acquisition cost. This is the single most important growth mechanic and it is why the invite flow gets disproportionate engineering attention.
4. **Establish trust through transparency.** Every mutation is attributed and logged. Trust is the product; a single unexplained balance change destroys it.

### 4.2 Metrics

| Metric                       | Definition                                                                               | Target                          |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------- |
| **Activation rate**          | % of new households reaching: ≥2 members joined **and** ≥3 expenses logged within 7 days | 40%                             |
| **Invite acceptance**        | % of sent invitations accepted within 72h                                                | 60%                             |
| **Weekly active households** | Households with ≥1 expense, settlement, or shopping-item event in a 7-day window         | Primary retention metric        |
| **Settlement completion**    | % of suggested settlements marked paid within 14 days                                    | 50%                             |
| **Time-to-log**              | Median seconds from "New expense" to saved                                               | < 20s                           |
| **Ledger integrity**         | Expenses whose splits do not sum to the total                                            | **0, enforced by the database** |

The last row is not a vanity metric. It is a hard invariant enforced by a database constraint, and it is the metric that protects goal #4.

### 4.3 Monetisation (designed, not implemented)

|                              | **Free**      | **Pro** (~₪15/household/month) |
| ---------------------------- | ------------- | ------------------------------ |
| Members                      | Up to 6       | Unlimited                      |
| Expenses & settlements       | Unlimited     | Unlimited                      |
| Analytics history            | Last 3 months | Unlimited                      |
| Receipt storage              | 50 receipts   | Unlimited                      |
| Recurring expense automation | 1 rule        | Unlimited                      |
| CSV export                   | —             | Yes                            |
| Email reminders              | —             | Yes                            |

Billing integration is an explicit non-goal for this version (see §8.3). The tier structure is documented because it justifies which features exist, and because "how would this make money" is a graded question. The quota fields (`plan`, limits) are present in the schema so the boundary is real, even though no payment provider is wired up.

---

## 5. Product Principles

These are the tie-breakers used whenever a design decision is ambiguous.

1. **The ledger is sacred.** Financial records are append-only and attributed. Nothing is hard-deleted; corrections are new facts, not silent overwrites. This is why expenses are soft-deleted and revised rather than mutated in place.
2. **Money is never approximate.** All amounts are integers in minor units. A split must sum to exactly the expense total — enforced in the database, not merely in the UI.
3. **Fairness must be visible.** Any member can inspect how any expense was split, by whom it was created, and how it changed over time. Transparency is cheaper than arbitration.
4. **Optimise for the fifteen-second interaction.** The common case is logging a grocery run while standing in a queue. Defaults must be smart and every extra field must justify itself.
5. **Isolation by default.** A household's data is invisible to everyone outside it, enforced at the database layer so that an application bug cannot leak it.

---

## 6. Capabilities Required to Support the Business Goals

This section maps business goals to the software capabilities that must exist — the rubric's "what software capabilities need to be built."

| #   | Capability                               | Serves goal | Notes                                                       |
| --- | ---------------------------------------- | ----------- | ----------------------------------------------------------- |
| C1  | Identity & authentication                | All         | Passwordless magic link + Google OAuth; no password storage |
| C2  | Multi-tenant household workspaces        | 1, 4        | A user may belong to several households simultaneously      |
| C3  | Role-based permissions                   | 4           | Owner / Admin / Member with distinct rights                 |
| C4  | Invitation & onboarding system           | 3           | Email invite and shareable link, expiring and revocable     |
| C5  | Expense ledger with flexible splitting   | 1           | Four split strategies over an append-only ledger            |
| C6  | Revision history & audit log             | 4           | Every mutation attributed and reversible in reading         |
| C7  | Balance derivation engine                | 1           | Net position per member, computed not stored                |
| C8  | Debt simplification engine               | 1           | Minimal transfer set to clear all debts                     |
| C9  | Settlement recording                     | 1           | Records that a real-world payment occurred                  |
| C10 | Real-time collaborative shopping list    | 1, 3        | Multi-user live editing; converts to an expense             |
| C11 | Receipt capture & secure storage         | 2, 4        | Private bucket, signed URLs, per-household quota            |
| C12 | Recurring expense automation & reminders | 2           | Scheduled generation of predictable bills                   |
| C13 | Analytics & reporting                    | 2           | Category/member/time breakdowns; CSV export                 |
| C14 | Notification system                      | 1, 3        | In-app centre, optional email                               |
| C15 | Data isolation & security enforcement    | 4           | Row-Level Security on every table                           |

---

## 7. Key User Processes

The rubric asks explicitly what key processes the product enables. Each process below is written as a testable workflow; the Test Plan document derives its scenarios directly from these.

### P1 — Registration & Authentication

1. Visitor lands on the marketing page and chooses _Get started_.
2. They enter an email address and receive a one-time magic link, **or** continue with Google.
3. Following the link establishes a session; a profile row is created automatically on first sign-in.
4. First-time users are asked for a display name (how roommates will identify them), then routed to onboarding.
5. Returning users land on their dashboard. Sessions persist across refresh and are refreshed transparently.

_Edge cases:_ expired or already-used magic link; link opened in a different browser than requested; a user who signs in with Google using an email that already has a magic-link identity (same identity, linked by email); a user who arrives via an invite link while signed out (the invitation is preserved through the auth round-trip and applied on return).

### P2 — Household Creation

1. A new user with no households sees a focused onboarding screen: create a household or enter an invite code.
2. Creating requires a name and a currency (default ₪ ILS, fixed for the household's lifetime).
3. The creator becomes **Owner** automatically.
4. The household is seeded with default expense categories (Rent, Utilities, Groceries, Household, Internet, Transport, Entertainment, Other) and one shopping list ("Shopping").
5. The user is prompted immediately to invite roommates — this is the highest-leverage moment in the funnel.

### P3 — Inviting & Joining

1. An Owner or Admin opens _Members → Invite_.
2. They either send an email invitation or copy a shareable link. Both carry a single opaque token.
3. The token is stored **hashed** with an expiry (7 days) and an intended role.
4. The invitee opens the link. If signed out, they authenticate first and are returned to the same invitation.
5. They see a preview — household name, who invited them, current members — and accept or decline.
6. On acceptance a membership row is created, the invitation is marked accepted, the household is notified, and an activity entry is written.

_Edge cases:_ expired token; revoked token; already-accepted token; a user who is already a member (idempotent no-op with a friendly message); an invitation addressed to email A opened by a user signed in as email B (allowed for link invites, blocked for email-targeted invites); a household at its member cap.

### P4 — Logging an Expense

1. From the household home, the user taps _Add expense_.
2. They enter: description, amount, who paid (defaults to themselves), date (defaults to today), category, and optionally a note and a receipt photo.
3. They choose participants (defaults to all current members) and a split method:
   - **Equally** — the total divided among participants, with any indivisible remainder distributed deterministically so the sum is exact.
   - **Exact amounts** — the user enters each participant's share; the form blocks saving until the shares sum to the total, showing the live remainder.
   - **Percentages** — must total 100%; converted to minor units with largest-remainder rounding.
   - **Shares/weights** — integer weights (e.g. 2 : 1 : 1) for proportional splits.
4. A live preview shows each participant's resulting share before saving.
5. On save, the expense, its splits, and an activity entry are written **in a single transaction**. Balances update immediately.

_Edge cases:_ zero or negative amounts (rejected); amount above a sane ceiling (rejected); no participants selected (rejected); payer not in the participant set (allowed — they fronted money for others); a participant who has since left the household (blocked at the database level); duplicate rapid submissions (guarded by an idempotency key); a receipt upload that fails after the expense is saved (the expense persists; the receipt can be retried).

### P5 — Editing, Deleting & History

1. The payer, an Admin, or the Owner may edit any field of an expense.
2. Saving writes a **revision record** capturing the before and after state and the editor's identity.
3. Any member can open an expense's history and see every change.
4. Deleting is a **soft delete**: the expense leaves balances and lists but remains in the audit trail and is restorable by an Admin.

_Edge cases:_ two members editing concurrently (last-write-wins with an optimistic-concurrency check on `updated_at`, surfacing a "this changed while you were editing" conflict rather than silently clobbering); editing an expense that a settlement was based on (permitted — balances simply recompute, since balances are derived).

### P6 — Viewing Balances

1. The household home shows a compact summary: _You are owed ₪X_ or _You owe ₪Y_, plus a per-member breakdown.
2. Each member's net position is derived as: `paid − owed + settlements_sent − settlements_received`.
3. A cross-household dashboard aggregates positions for users in multiple households.
4. Balances always sum to zero across the household — a useful self-check that is asserted in tests.

### P7 — Settling Up

1. The user opens _Settle up_.
2. SplitMate presents the **simplified transfer set**: the minimum list of payments that clears every debt in the household. With four members and tangled debts this typically reduces five or six transfers to two.
3. The user picks a suggested transfer (or records a custom one), confirms the amount — partial payments are allowed — chooses a method label (Bit / bank transfer / cash / other), and confirms.
4. A settlement record is written; balances recompute; both parties are notified.
5. The receiving party can dispute a settlement, which voids it (leaving the void in the audit trail).

_Edge cases:_ settling more than is owed (allowed but warned — it flips the balance direction); settling with yourself (rejected); settling with a non-member (rejected); a settlement recorded while a concurrent expense changes the balance (both are ledger facts, so the result is simply the new sum — no lost update is possible).

### P8 — Shared Shopping List (real-time)

1. Any member opens the household's shopping list and adds items, with optional quantity and estimated price.
2. Every other member's open list updates **live**, without refresh.
3. At the store, a member checks off items as they buy them; check-offs are attributed and appear live to everyone.
4. Tapping **Checkout** opens the expense form pre-filled with the checked items' estimated total, the "Groceries" category, and a description summarising the items. The user corrects the real total and saves.
5. The purchased items are archived and linked to the created expense, so any expense can be traced back to what was actually bought.

_Edge cases:_ two members checking off the same item simultaneously (idempotent — first write wins, both UIs converge); an item added and deleted in rapid succession while another client is mid-render (reconciled by the realtime event stream); working offline (optimistic updates are rolled back with a toast if the write fails); checkout with no checked items (blocked).

### P9 — Receipts

1. A photo can be attached while creating an expense or added later.
2. Images are compressed client-side before upload (target ≤ 1 MB) to protect quota and upload time.
3. Files are stored in a **private** bucket under a `household_id/expense_id/` path.
4. Viewing generates a short-lived signed URL; the file is never publicly addressable.
5. Deleting an expense retains the receipt for the audit trail until the expense is permanently purged.

_Edge cases:_ non-image or oversized file (rejected client- and server-side); upload interrupted (expense still saves); a member of another household guessing the storage path (blocked by storage policies, not obscurity).

### P10 — Recurring Expenses & Reminders

1. An Admin defines a recurring rule: template expense (description, amount, category, split configuration) plus a frequency (monthly on day N, weekly, etc.).
2. A scheduled job runs daily, finds rules due today, and creates the corresponding expense automatically.
3. Members are notified that the expense was created, with a link to review or adjust it.
4. Rules can be paused, edited, or deleted; editing a rule never rewrites expenses it already generated.

_Edge cases:_ "the 31st" in a 30-day month (clamped to the last day); a rule whose split references a member who has left (the job skips the rule and notifies an Admin rather than writing an invalid expense); the job running twice in one day (idempotent — a uniqueness guard on rule + period prevents duplicates); time-zone boundaries (all scheduling evaluated in the household's timezone).

### P11 — Analytics & Reporting

1. The Insights page shows, for a selectable month or range: total household spend, spend by category, spend per member (paid vs. consumed), month-over-month trend, and the largest individual expenses.
2. A "fairness" view highlights members who consistently front money — the cash-flow burden that balances alone don't reveal.
3. All aggregations are computed **in the database** and returned pre-aggregated.
4. Pro households can export the underlying rows as CSV.

### P12 — Notifications

In-app notification centre with unread badge, covering: you were added to a household; an expense involving you was created, edited, or deleted; someone recorded a settlement with you; a recurring bill was generated; an invitation you sent was accepted. Email is sent for invitations and, optionally, settlement requests.

---

## 8. Scope

### 8.1 Roles & permissions

| Action                                              | Owner | Admin | Member |
| --------------------------------------------------- | :---: | :---: | :----: |
| View household data (expenses, balances, activity)  |  ✅   |  ✅   |   ✅   |
| Create expenses & shopping items                    |  ✅   |  ✅   |   ✅   |
| Edit / delete **own** expense (as payer or creator) |  ✅   |  ✅   |   ✅   |
| Edit / delete **any** expense                       |  ✅   |  ✅   |   ❌   |
| Record a settlement **they are party to**           |  ✅   |  ✅   |   ✅   |
| Invite members                                      |  ✅   |  ✅   |   ❌   |
| Change member roles                                 |  ✅   |  ❌   |   ❌   |
| Remove a member                                     |  ✅   |  ✅   |   ❌   |
| Manage recurring rules & categories                 |  ✅   |  ✅   |   ❌   |
| Rename household / change settings                  |  ✅   |  ✅   |   ❌   |
| Archive or delete the household                     |  ✅   |  ❌   |   ❌   |
| Leave the household                                 |  ✅*  |  ✅   |   ✅   |

\* An Owner must transfer ownership before leaving. Any member with a non-zero balance must settle (or be force-settled by an Owner, which writes an explicit written-off settlement) before removal — otherwise the ledger would lose a counterparty.

### 8.2 In scope for v1

Everything in §6 (C1–C15) and §7 (P1–P12).

### 8.3 Explicit non-goals

Each of these was considered and deliberately excluded; the reasoning matters more than the exclusion.

| Non-goal                                            | Why excluded                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Real money movement** (Stripe, Bit, open banking) | Regulatory and PCI burden far beyond course scope. SplitMate records that a payment happened; the payment itself occurs in the app the household already uses. Deep-linking to a P2P app is a plausible v2.                                                          |
| **Subscription billing**                            | The tier model is designed and the schema supports it, but wiring a payment provider adds a webhook surface and failure modes without demonstrating new engineering skill.                                                                                           |
| **Multi-currency with FX**                          | One currency per household, chosen at creation. Real multi-currency requires historical exchange rates, a rate provider, and a decision about _when_ a debt is converted — genuinely hard and easy to get subtly wrong. Documented as a v2 with a proposed approach. |
| **OCR receipt scanning**                            | Attractive in a demo, but reliable extraction is an ML problem; a flaky version is worse than none. Receipts are stored and viewable, not parsed.                                                                                                                    |
| **Native mobile apps**                              | A responsive, installable PWA-grade web app covers the use case.                                                                                                                                                                                                     |
| **Chat / messaging**                                | Households already have WhatsApp. Competing with it is a losing scope expansion.                                                                                                                                                                                     |

### 8.4 Assumptions

Members have their own email address and a device with a camera and browser; households are small (2–8 people); all members trust each other enough to share a household (SplitMate reduces friction, it does not adjudicate fraud); real-world payments happen outside the app and are recorded honestly — SplitMate is a shared ledger, not an escrow.

---

## 9. Release Plan

| Milestone                     | Contents                                       | Definition of done                                             |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| **M1 — Specification**        | PRD, architecture, technical spec              | Documents reviewed and approved                                |
| **M2 — Data foundation**      | Schema, constraints, RLS, SQL functions, seeds | Database rejects unbalanced expenses and cross-household reads |
| **M3 — Identity & groups**    | P1, P2, P3                                     | Two real users share one household in production               |
| **M4 — Ledger**               | P4, P5, P6                                     | Balances correct across all four split methods                 |
| **M5 — Settlement**           | P7, P12 (partial)                              | Debts clear with a minimal transfer set — **end-to-end MVP**   |
| **M6 — Live deployment**      | Vercel + hosted Supabase                       | Public URL usable by a stranger                                |
| **M7 — Collaboration**        | P8, P9                                         | Two browsers see the same list update live                     |
| **M8 — Automation & insight** | P10, P11, P12                                  | A recurring bill generates unattended                          |
| **M9 — Quality**              | Test plan + implementation                     | Core workflows and data isolation covered by tests             |
| **M10 — Hardening**           | Security & scalability documents and fixes     | Documented, measured, and mitigated                            |
| **M11 — Delivery**            | README, wiki, slide deck, Q&A prep             | Presentable end to end                                         |

---

## 10. Risks

| Risk                                                | Impact                    | Mitigation                                                                                            |
| --------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| Scope creep across 12 workflows                     | Late, unstable product    | MVP is complete at M5; everything after is additive and independently droppable                       |
| Split rounding bugs producing wrong money           | Destroys product trust    | Pure, exhaustively unit-tested domain layer plus a database constraint as a backstop                  |
| RLS misconfiguration leaking data across households | Critical security failure | Integration tests that query as two distinct real users and assert empty results                      |
| Realtime complexity (races, duplicate events)       | Confusing UX              | Idempotent operations, server-authoritative reconciliation, optimistic updates that roll back visibly |
| Deployment discovered broken at the deadline        | Catastrophic              | Deploy at M6, mid-project, and keep every subsequent change deployed continuously                     |

---

## 11. Glossary

**Household** — a shared workspace containing members, expenses, settlements, and lists. The tenancy boundary of the entire system.
**Expense** — a purchase paid by one member on behalf of some or all members.
**Split** — one participant's obligated share of one expense, in minor units.
**Minor units** — the smallest indivisible unit of the currency (agorot for ILS, cents for USD). All amounts are stored as integers in minor units.
**Balance / net position** — a derived figure: what a member paid, minus what they owed, adjusted by settlements.
**Settlement** — a record that one member paid another in the real world. A ledger fact, not a transfer.
**Debt simplification** — computing the minimal set of transfers that brings every net position to zero.
**Activity log** — the append-only, attributed record of every mutation in a household.
