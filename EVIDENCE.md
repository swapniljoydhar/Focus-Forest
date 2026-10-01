# Evidence, limits, and ethical design

**Reviewed:** 2026-10-02 · **Applies to:** Intent Grove 0.3.7 and later

Intent Grove is a private self-reflection tool. It is not a blocker, clinical intervention, treatment, or a proven way to reduce screen time. Its current implementation records browser navigation structure and elapsed estimates; it cannot infer whether a page is relevant, whether a person is attentive, or what they intended to do. Individual benefit is not established by the existence of these features.

## What the research supports

- A 2021 systematic review of technology-based self-regulated learning interventions found substantial variation in study methods and outcomes. Monitoring and awareness can be useful components, but should not be treated as sufficient on their own. [Biedermann et al., *Journal of Computer Assisted Learning* (2021)](https://onlinelibrary.wiley.com/doi/10.1111/jcal.12581).
- A systematic review and meta-analysis of digital self-control tools describes a diverse, still-developing evidence base, rather than a single reliably effective design. [Roffarello & De Russis, *ACM Transactions on Computer-Human Interaction* (2023)](https://iris.polito.it/handle/11583/2972709).
- A 2026 scoping review covering studies through 2025 found that the literature is concentrated on smartphones and total-use measures, with limited theory use and short evaluation periods. This constrains what can be inferred about a desktop browser reflection extension. [2026 scoping review, PubMed](https://pubmed.ncbi.nlm.nih.gov/42778172/).
- A 2025 perspective on digital interventions emphasizes supporting autonomy and more intentional use, rather than treating less use as automatically better. [Skeggs & Orben, *Nature Human Behaviour* (2025)](https://selfdeterminationtheory.org/wp-content/uploads/2025/06/2025_SkeggsOrben_SocialMedia.pdf).

These papers do not validate Intent Grove specifically. Their subjects, devices, and interventions differ. The design decisions below are cautious applications of general findings, not claims that a particular prompt or animation has a proven psychological effect.

## Product choices and guardrails

- **Make signals observable and modest.** The tree represents recorded navigation paths. The extension reports branch depth and elapsed estimates, never a relevance score or attention claim.
- **Keep agency with the user.** Continue, return, save, pause, and start a new mission remain available. Reminder thresholds and firmer wording are optional and can be changed or disabled.
- **Avoid coercive pressure.** No shaming, public comparison, streak loss, punishment, deceptive urgency, variable-ratio rewards, or content-triggered persuasion. Optional random notes are bounded, transparent, local, and unrelated to depth or presumed success.
- **Keep the intervention private.** Browsing data stays on-device; mission text is sent only to the selected search provider when the user plants a mission. There is no analytics or cloud telemetry.
- **Offer a calm exit.** Users can pause reminders and clear local data. A reminder should not make a user feel watched or obligated to continue using the product.

“Subtle pressure” should mean a clear, user-chosen cue that helps someone compare a recorded path with their own stated intention. It should not mean covert psychological manipulation. Shame is deliberately excluded: it is not necessary for the product goal and could undermine trust or autonomy.

## How to evaluate whether it helps

The extension currently has engineering and interaction tests, not a user-outcome trial. Product usefulness should be evaluated with voluntary, local-only reflection rather than inferred from more browsing data. A future opt-in study could ask users, after a week, whether reminders helped them notice a mismatch, whether they felt respected, whether they could dismiss or change reminders easily, and whether the tool created guilt or distraction. Report both positive and negative responses, include people who stopped using it, and avoid treating reduced browsing time as the only success measure. No study telemetry should be added to the extension without a separate explicit design and consent review.

A practical personal check is simpler: after a few sessions, ask whether the reminder helped you make a choice you endorse. If it added stress or did not help, soften or disable it. Intent Grove cannot decide that outcome for you.