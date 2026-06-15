# Governance

Octopus is an open-source project with a small group of maintainers and a wider contributor community. This document describes how decisions get made, who has authority over what, and how anyone can earn more influence over the project's direction.

## Roles

### Contributors

Anyone who opens issues, files bugs, writes documentation, submits PRs, or participates in Discussions. No formal application; participation is the qualification.

### Maintainers

The people listed in [MAINTAINERS.md](MAINTAINERS.md) and [.github/CODEOWNERS](.github/CODEOWNERS). Maintainers can:

- Merge PRs in their areas of ownership
- Triage and label issues
- Promote items from **Proposed** to **Up Next** on the [Roadmap](ROADMAP.md)
- Cut releases and publish to GHCR

### Lead maintainer

The lead maintainer (currently [@redoh](https://github.com/redoh)) has final say on:

- Project scope and direction
- License changes
- Adding or removing maintainers
- Decisions that don't reach consensus among maintainers

## How decisions get made

### PR review

PRs are reviewed by the [CODEOWNERS](.github/CODEOWNERS) for the touched paths. One maintainer approval is sufficient to merge for routine changes. Architectural or breaking changes require a second maintainer or an RFC (see below).

The Octopus reviewer bot also reviews every PR. Its **4+/5 quality rating** is a soft gate — maintainers may merge below it for trivial changes, but findings tagged 🔴 Critical must be addressed or explicitly waived in the PR description.

### Roadmap changes

Items move from **Proposed** → **Up Next** when a maintainer adds the `roadmap` label and ideally finds an owner. Anyone can open a [roadmap proposal](.github/ISSUE_TEMPLATE/roadmap_proposal.yml).

### RFCs (architectural changes)

For changes that touch multiple subsystems, break public APIs, or change the social contract (governance, license, security policy), open an issue labeled `rfc` with:

- The problem you're solving
- Your proposed approach
- Alternatives considered
- Migration plan if applicable

RFCs sit open for at least 7 days for community input before a maintainer merges or rejects.

### Disagreements

If maintainers disagree, the discussion happens publicly on the issue or PR. If consensus doesn't form within a week, the lead maintainer decides. The decision and its rationale are recorded on the issue for future reference.

## Becoming a maintainer

There's no rigid formula, but the typical path is:

1. Sustained, high-quality contributions over a few months (PRs that merge cleanly, issue triage, helpful Discussion answers)
2. Demonstrated judgment in one or more areas (review pipeline, integrations, UI, infra)
3. An existing maintainer nominates you in a private discussion
4. Other maintainers either agree or surface specific concerns
5. The lead maintainer extends the invitation

New maintainers usually start with ownership over a narrow area before getting broader review rights.

## Removing a maintainer

Inactive maintainers (no review activity for 6+ months) may be moved to **emeritus** status — credited but no longer holding review responsibilities. Reinstatement is straightforward if the person returns.

Maintainers can also be removed for violations of the [Code of Conduct](CODE_OF_CONDUCT.md). The lead maintainer makes this call after consulting with other maintainers; the rationale is recorded in a sealed enforcement record.

## Changes to this document

Amend by PR. Material changes require sign-off from the lead maintainer. Spelling fixes, formatting, and link updates do not.
