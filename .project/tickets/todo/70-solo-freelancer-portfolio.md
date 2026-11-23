# 70 — Solo freelancer portfolio + $5k–$10k pipeline

**Status:** todo

## Goal

Ship a personal portfolio site that positions you as a specialist who delivers high-stakes product work at **$5,000–$10,000 per project**, and use it as the public front door while you leave full-time employment and make freelancing the primary income.

This ticket covers (1) the portfolio product and (2) the operating checklist to win and close those projects.

## Depends on

- None (personal / side work; not blocked by AgentOS platform tickets)
- Optional: reuse design taste from AgentOS UI work; do **not** couple the portfolio to the AgentOS monorepo unless you explicitly decide to host it as a separate consumer app

## Scope

### Portfolio site (build)

- One clear offer (not a menu of 12 services)
- Proof: 3–6 case studies with problem → approach → outcome (numbers when possible)
- Trust: process, timeline, pricing band, FAQ
- Conversion: single primary CTA (book a call / request a proposal)
- Tech: fast, mobile-first, custom domain, analytics, contact form or calendar embed

### Freelancer operating system (run)

- Positioning, pipeline, sales, delivery, and runway so $5k–$10k projects can replace salary

## Done when

### Portfolio

- [ ] Positioning one-liner + niche written (who you help + what outcome)
- [ ] Site live on custom domain (HTTPS)
- [ ] Home: brand, offer, proof, CTA — one composition, not a dashboard
- [ ] 3+ case studies (or strong project write-ups if client NDAs block logos)
- [ ] Services / engagement page with pricing band ($5k–$10k) and what’s included
- [ ] About + process (how you work, typical timeline)
- [ ] Contact / booking path works end-to-end (form or calendar)
- [ ] Mobile + desktop QA; Lighthouse performance acceptable
- [ ] Analytics + basic lead capture (email or calendar)

### Business readiness (leave-job path)

- [ ] Monthly burn + runway calculated (savings ÷ expenses)
- [ ] Target: enough booked/closed work to cover 1.5–2× monthly burn before resigning
- [ ] Pipeline tracker exists (leads → discovery → proposal → close → delivery)
- [ ] Proposal + contract + invoice templates ready
- [ ] First 3 warm outreach / referral asks completed
- [ ] At least one paid project at the target band closed (or a paid pilot that ladders up)

## Notes — Solo freelancer checklist ($5k–$10k)

Use this as the operating checklist. Check items off as you execute; keep the portfolio ticket Done-when boxes in sync where they overlap.

### 1. Positioning (charge premium or stay busy cheap)

- [ ] Pick **one** primary offer (e.g. “ship a production MVP in 4–6 weeks”, “rebuild your SaaS frontend”, “Agent/AI product slice end-to-end”)
- [ ] Name the **buyer** (founder, Head of Product, eng manager) — not “anyone who needs a website”
- [ ] Write a one-liner: _I help [buyer] achieve [outcome] without [pain]_
- [ ] List 3 problems you solve that hurt enough to pay $5k–$10k
- [ ] Kill “I do everything” from the site and pitches

### 2. Proof that justifies the price

- [ ] Rewrite past work as **outcomes** (revenue, time saved, conversion, launch date), not feature lists
- [ ] Prepare 3 case studies: context, constraints, your decisions, result, testimonial if possible
- [ ] Collect 2–3 written recommendations (LinkedIn or email OK)
- [ ] Record a 60–90s Loom: who you help + one proof story + CTA
- [ ] If light on logos: ship a sharp public sample / teardown / open brief that shows taste and rigor

### 3. Offer & packaging (so $5k–$10k feels fair)

- [ ] Package as a **fixed-scope product**, not hourly (hourly caps your rate and invites scope fights)
- [ ] Define what’s in / out for a $5k, $7.5k, and $10k tier (or one flagship + add-ons)
- [ ] Publish a **starting-at** band on the site (filters tire-kickers)
- [ ] Standard timeline (e.g. discovery 1 week → build 3–5 weeks → handoff)
- [ ] Change-order rule written into every proposal

### 4. Pipeline (never rely on one lead)

- [ ] Warm list: 30 people who already trust you (ex-coworkers, managers, founders you’ve helped)
- [ ] Weekly cadence: 5 personal outreaches + 2 follow-ups + 1 public proof post
- [ ] Channels that work for premium: referrals, LinkedIn DMs, communities, agencies needing overflow, Product Hunt / indie founder circles — not race-to-bottom job boards
- [ ] Ask every happy contact: “Who else should I talk to about X?”
- [ ] Keep a simple CRM (Notion/Sheet): source, stage, next action, $ estimate

### 5. Sales process (protect your time)

- [ ] Qualify before long calls: budget band, decision maker, timeline, problem urgency
- [ ] Discovery call script: goals, constraints, success metric, stakeholders, deadline
- [ ] Same-day or next-day proposal (speed wins)
- [ ] Proposal = outcome, scope, milestones, price, payment schedule, assumptions
- [ ] Payment terms: **40–50% upfront**, milestone, remainder on handoff (no net-60 for solo)
- [ ] Walk away when budget is “$500” or scope is infinite

### 6. Delivery quality (so they pay again and refer)

- [ ] Kickoff checklist: access, design refs, decision SLA, comms channel
- [ ] Weekly visible progress (Loom or short written update)
- [ ] Definition of done agreed in writing
- [ ] Handoff pack: repo, deploy notes, env list, loom walkthrough
- [ ] Ask for testimonial + referral within 7 days of launch
- [ ] Optional maintenance retainer only after a clean fixed project

### 7. Money & leaving the job

- [ ] Know monthly personal burn (rent, food, insurance, tax set-aside)
- [ ] Target runway: **6+ months** expenses in cash before quitting (or equivalent booked backlog)
- [ ] Tax: set aside ~25–35% (jurisdiction-dependent); open a separate business account
- [ ] Insurance: health plan plan for after employer coverage ends
- [ ] Legal basics: contract, IP assignment, liability cap, late-fee clause
- [ ] Income rule of thumb before resign: **2–3 months of target income booked or in late-stage close**
- [ ] Soft bridge option: reduce to part-time / notice period while first retainers land

### 8. Weekly operating rhythm

- [ ] Mon: pipeline + outreach
- [ ] Tue–Thu: deep delivery
- [ ] Fri: proposals, invoices, admin, content (1 proof artifact)
- [ ] Cap billable at a sustainable load; leave buffer for sales (no sales → feast/famine)

## Out of scope (this ticket)

- Building AgentOS platform features
- Agency hiring / subcontracting network (can be a later ticket)
- Content engine at scale (newsletter, YouTube) until the portfolio + first closes exist

## Verify

- Portfolio URL loads on phone + desktop
- CTA reaches calendar or inbox
- One stranger can explain your offer after 30 seconds on the home page
- Checklist sections 1–7 have enough boxes checked to resign without panic

## Research notes (web scan)

Sources reviewed: Muzli top portfolios, uikreative.com, blakealmanza.dev, felixmacovei.com, shawnjenkins.design, mariepoulin.com/work-with-me, Brittany Chiang / Josh Comeau patterns, kokil/alexberman/showproof conversion guides, Pact MSA template, UK freelance legal-pages guidance, sample freelancer privacy/terms pages.

### Portfolio pattern that converts ($5k+)

| Layer    | Pattern                                                                          |
| -------- | -------------------------------------------------------------------------------- |
| Hero     | Outcome offer + who you help + availability, not job title dump                  |
| Proof    | 3–5 case studies: problem → role → decisions → business metric                   |
| Trust    | Named testimonials, logos/brands, years/clients, “you work with me directly”     |
| Offer    | Services as packages or engagement types + starting price band                   |
| Process  | 3–5 steps discovery → build → handoff                                            |
| CTA      | One primary action (book call / start conversation), repeated after case studies |
| Site map | Home, Work, Services, About, Contact (+ footer legal)                            |

Avoid: skills grids for recruiters, screenshot-only galleries, competing CTAs, Awwwards spectacle unless that _is_ the product you sell.

### Reference sites

- **Conversion / freelance offer:** [uikreative.com](https://uikreative.com/) — offer, selected work → case studies, services buckets, trust stats, email CTA
- **Outcome metrics:** [blakealmanza.dev](https://blakealmanza.dev/) — project + metric (“1,100+ students”)
- **Full-lifecycle designer-engineer:** [felixmacovei.com](https://www.felixmacovei.com/)
- **Packaged services page:** [mariepoulin.com/work-with-me](https://mariepoulin.com/work-with-me/)
- **Scanability (dev):** Brittany Chiang — sticky pitch + selected work
- **Expertise as content:** Josh Comeau — writing proves depth (add hire CTA if freelancing)
- **Creative-dev spectacle:** bruno-simon.com — only if selling interactive/WebGL craft

### Legal stack (two layers)

**A. Public website (footer)**

- Privacy policy (forms, analytics, retention, third parties, rights)
- Cookie notice / consent if non-essential cookies (e.g. GA)
- Website terms of use (browsing, no warranty on site content)
- Optional: Terms of business summary linking to full contract

**B. Project contracts (not just a footer page)**

Prefer **MSA + SOW** for repeat clients; single engagement contract for one-offs.

Must-have clauses:

1. Parties + independent contractor status
2. SOW protocol (written scope / change orders)
3. Fees, milestones, late fees, taxes
4. Term + termination (convenience + cause + pay for work done)
5. Warranties (professional manner) + disclaimer of implied warranties
6. IP: client gets deliverables **on full payment**; you keep pre-existing / reusable components with embedded license
7. Confidentiality
8. Liability cap (often fees paid under the SOW) + scoped indemnification
9. Governing law / disputes

Payment norm for solo: deposit + milestones; Net 14–30; IP assignment triggers on payment.

Not legal advice — use a lawyer for your jurisdiction, regulated data, or >~$50k/year relationships.
