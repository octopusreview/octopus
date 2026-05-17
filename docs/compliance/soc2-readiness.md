# SOC 2 Readiness Self-Assessment

**Status:** Pre-audit · Internal working document
**Owner:** Maintainers (see [MAINTAINERS.md](../../MAINTAINERS.md))
**Last reviewed:** May 2026

Octopus is not SOC 2 certified. This document is an honest self-assessment against the SOC 2 Type II Common Criteria, intended to help enterprise prospects evaluate which controls are in place today versus on the roadmap.

We will not claim "SOC 2 compliant" or "SOC 2 in progress" externally until we have engaged an auditor and started gap remediation. This document is the raw internal view.

## How to read this

Each control is rated:

- ✅ **In place** — implemented and demonstrably operating
- 🟡 **Partial** — implemented but missing audit trail, evidence, or coverage
- ❌ **Not yet** — not implemented; on the roadmap
- N/A — not applicable to Octopus's scope

Evidence column points to the code, doc, or operational artefact that backs the claim.

## CC1 — Control Environment

| # | Control | Status | Evidence |
|---|---|---|---|
| CC1.1 | Code of conduct in place | ✅ | [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) — Contributor Covenant 3.0 with enforcement ladder |
| CC1.2 | Governance documented | 🟡 | GOVERNANCE.md drafted in PR #55; maintainer set is small and changes are ad-hoc |
| CC1.3 | Roles & responsibilities documented | 🟡 | [MAINTAINERS.md](../../MAINTAINERS.md) + CODEOWNERS; no formal role descriptions for non-maintainer staff |
| CC1.4 | Personnel screening | ❌ | No formal background-check process; small team |
| CC1.5 | Disciplinary process | ✅ | Code of Conduct enforcement ladder |

## CC2 — Communication and Information

| # | Control | Status | Evidence |
|---|---|---|---|
| CC2.1 | Internal info quality | 🟡 | Documentation exists but inconsistent across components |
| CC2.2 | Internal communication of objectives | 🟡 | ROADMAP.md published; no formal cadence for internal updates |
| CC2.3 | External communication of objectives | ✅ | Public roadmap, changelog, status page |

## CC3 — Risk Assessment

| # | Control | Status | Evidence |
|---|---|---|---|
| CC3.1 | Risk identification process | 🟡 | Ad-hoc; no formal quarterly review |
| CC3.2 | Fraud risk assessment | ❌ | No formal assessment |
| CC3.3 | Changes to controls assessed | 🟡 | Major architectural changes go through RFCs (GOVERNANCE.md) |
| CC3.4 | Vendor risk assessment | 🟡 | Sub-processors enumerated at `/docs/sub-processors`; no formal risk score per vendor |

## CC4 — Monitoring Activities

| # | Control | Status | Evidence |
|---|---|---|---|
| CC4.1 | Monitoring activities defined | 🟡 | Status page + CI alerts; no formal SLOs |
| CC4.2 | Deficiencies communicated | ✅ | Public status page + incident post-mortems within 30 days |

## CC5 — Control Activities

| # | Control | Status | Evidence |
|---|---|---|---|
| CC5.1 | Control activities for technology | ✅ | CI (lint, typecheck, build, security review) gates every PR |
| CC5.2 | Policies and procedures | 🟡 | Most processes are documented but not formal "policies" |
| CC5.3 | Policies enforced | ✅ | Octopus reviewer + CI block non-compliant PRs |

## CC6 — Logical and Physical Access Controls

| # | Control | Status | Evidence |
|---|---|---|---|
| CC6.1 | Logical access provisioned per role | ✅ | Better Auth + per-org RBAC (owner/admin/member); audit log records role changes |
| CC6.2 | Identification & authentication | ✅ | OAuth (GitHub/Google) + magic-link email; no password store |
| CC6.3 | Authorization for system access | ✅ | Role-checked at every authenticated endpoint via `authenticateApiToken` / session middleware |
| CC6.4 | Restrict physical access | ✅ | AWS-managed datacentre access; self-hosters control their own |
| CC6.5 | Secure data transmission | ✅ | TLS 1.2+ everywhere |
| CC6.6 | Vulnerability management | 🟡 | Dependabot + CodeQL + automated security review on PRs; no scheduled pen tests |
| CC6.7 | Restrict data transmission to trusted parties | ✅ | Sub-processor list enumerates all egress points |
| CC6.8 | Prevent unauthorised software | ✅ | Self-hosters control their own; hosted Octopus runs only the published image |

## CC7 — System Operations

| # | Control | Status | Evidence |
|---|---|---|---|
| CC7.1 | Monitoring infrastructure | 🟡 | CloudWatch + Pubby live-update; no centralised SIEM |
| CC7.2 | Detect security events | 🟡 | Audit log records mutating actions; no automated anomaly detection |
| CC7.3 | Evaluate security events | 🟡 | Manual triage of audit log + bug bounty submissions |
| CC7.4 | Respond to security incidents | 🟡 | Incident-response runbook drafted in `/docs/security-overview`; no formal tabletop exercises |
| CC7.5 | Disaster recovery | 🟡 | Encrypted backups (30-day retention); no formal RTO/RPO targets |

## CC8 — Change Management

| # | Control | Status | Evidence |
|---|---|---|---|
| CC8.1 | Changes follow defined process | ✅ | All changes via PR; required approvals from CODEOWNERS |
| CC8.2 | Changes tested before deployment | ✅ | CI (lint + typecheck + build + tests + security review) blocks merge on failure |
| CC8.3 | Emergency change process | 🟡 | Hot-fix path exists but undocumented |

## CC9 — Risk Mitigation

| # | Control | Status | Evidence |
|---|---|---|---|
| CC9.1 | Identify and select responses | 🟡 | Ad-hoc; no formal risk register |
| CC9.2 | Vendor management lifecycle | 🟡 | Sub-processors listed; no contract review cadence |

## Roadmap to certification

To pursue formal SOC 2 Type II, the gaps to close (in order of priority) are:

1. **Formal risk register + quarterly review** (CC3.1, CC3.2, CC9.1)
2. **Scheduled penetration tests** (CC6.6) — at least annually
3. **Centralised SIEM / log aggregation** (CC7.1, CC7.2)
4. **Documented incident-response runbook + annual tabletop** (CC7.4)
5. **Formal RTO/RPO targets + DR test** (CC7.5)
6. **Personnel background checks** (CC1.4) — required for staff with production access
7. **Engage a SOC 2 auditor** — typical timeline 12-18 months for Type II from kickoff

Expected duration: 12-18 months from prioritised execution.

## How customers should use this document

This is an **internal honest assessment**, not a marketing artefact. If you are evaluating Octopus for an enterprise deployment:

- Use this as the input to your vendor risk assessment
- Specific controls you need certified can be added to a paid engagement scope
- For prospects with hard SOC 2 / ISO 27001 / HIPAA requirements: self-host. The control surface narrows to your own infrastructure, which you already certify.

Questions: [security@octopus-review.ai](mailto:security@octopus-review.ai).
