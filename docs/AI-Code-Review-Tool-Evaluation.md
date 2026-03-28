# AI Code Review Tool Evaluation for GitLab Integration

**Author:** Elis Salobehaj | **Date:** March 28, 2026 | **Audience:** VP of Technology

---

## Executive Summary

This document evaluates three AI-powered code review options for our self-hosted GitLab environment: **GitLab Duo**, **CodeRabbit**, and **Git Gandalf**. The intent is not to declare a universal winner. The intent is to give leadership a defensible basis for deciding where to sit on the build-vs-buy spectrum.

The decision reduces to three strategic choices:

- **Choose GitLab Duo** if the primary objective is rapid rollout, low operational burden, and alignment with the existing GitLab platform roadmap.
- **Choose CodeRabbit** if the primary objective is the richest out-of-the-box review experience, including organizational learning, analytics, and more opinionated review automation.
- **Choose Git Gandalf** if the primary objective is maximum control, full data sovereignty, and the ability to tailor review behavior without vendor dependency.

The trade-offs are not symmetrical:

- **GitLab Duo** has the strongest platform alignment and the lowest change-management burden, but some packaging details and feature maturity vary by product path.
- **CodeRabbit** has the strongest commercially packaged review workflow, but introduces third-party processing in SaaS mode and requires vendor diligence for Enterprise self-hosting.
- **Git Gandalf** has the highest architectural control and lowest direct software cost, but also the highest execution risk because the organization owns reliability, support, and long-term maintenance.

**Recommendation framing:** if leadership wants the fastest low-risk adoption path, GitLab Duo is the pragmatic default. If leadership wants the strongest commercial review product and is comfortable with third-party vendor review processing, CodeRabbit is the strongest buy option. If leadership views data sovereignty and internal control as strategic rather than tactical, Git Gandalf remains the most controllable option but requires deliberate production hardening.

This revision prioritizes claims that are explicitly supported by vendor documentation. Where public documentation is ambiguous, inconsistent, or incomplete, the document flags that ambiguity instead of presenting it as settled fact.

It also reflects Git Gandalf's newly implemented `.gitgandalf.yaml` repo-review-config foundation, but only credits shipped behavior today: repo-root discovery, YAML parsing, strict validation, documented schema, and safe fallback defaults. Planned downstream consumers such as diff filtering, prompt injection, and output shaping are not scored as delivered yet.

---

## Solution Overview

| | GitLab Duo | CodeRabbit | Git Gandalf |
|---|---|---|---|
| **Type** | Native GitLab feature | Third-party SaaS (+ self-hosted Enterprise option) | Custom-built, self-hosted |
| **Vendor** | GitLab Inc. (NASDAQ: GTLB) | CodeRabbit Inc. | In-house |
| **Market presence** | Part of GitLab's core AI suite; adopted across GitLab's enterprise customer base | 2M+ repositories; customers include NVIDIA, TaskRabbit, Visma, Clerk, Linux Foundation | Internal tool; limited to our organization |
| **Maturity** | Classic Code Review is GA; Code Review Flow is GA in GitLab 18.8+; adjacent Duo features vary by feature | Commercially available; SOC 2 Type II, ISO 27001, GDPR compliant | Functional prototype with solid engineering foundations; pre-production |
| **GitLab support** | GitLab.com and Self-Managed; Duo Self-Hosted Code Review requires GitLab 18.3+ | GitLab.com + Self-Managed 16.x+ | Any GitLab instance with webhook support |
| **Compliance certifications** | GitLab Trust Center lists SOC 2 Type II, ISO 27001, GDPR, and additional certifications | SOC 2 Type II, ISO 27001, GDPR | Inherits organization's certifications |

---

## 1. Review Architecture & AI Depth

### GitLab Duo

GitLab Duo offers **two code review features** — which one runs depends on the requesting user's entitlements and instance configuration:

- **GitLab Duo Code Review** (seat-based Duo add-on): Analyzes MR title, description, diffs, file contents, and filenames using GitLab-managed LLMs. Returns inline review comments. Supports custom review instructions via `.gitlab/duo/mr-review-instructions.yaml` with per-file-pattern targeting (glob-based YAML). This is a single-pass analysis.
- **Code Review Flow** (Duo Agent Platform, credit-based): The newer agentic variant built on GitLab's evolving Agent Platform. Analyzes code changes, MR comments, and linked issues with multi-step reasoning. Provides enhanced understanding of repository structure and cross-file dependencies. Runs as a CI/CD pipeline session. Available on GitLab.com and Self-Managed.

**Strengths:**
- Zero deployment — enable automatic reviews via project, group, or instance-level settings toggles.
- Cascading configuration: instance → group → project settings with override capability.
- Custom review instructions with per-file-pattern targeting and language-specific rulesets.
- Interactive follow-up via `@GitLabDuo` mentions in discussion threads.
- Self-hosted model support allows fully on-premises deployments with supported LLM backends (vLLM, AWS Bedrock, Azure OpenAI) via a self-hosted AI Gateway.
- Part of a broader AI suite that also includes adjacent features such as code suggestions, merge request summaries, merge commit message generation, root cause analysis, vulnerability explanation, and SDLC trends reporting. Several of these adjacent features are still beta or experiment in GitLab's current documentation.
- Code Review Flow's agentic architecture is actively being enhanced — GitLab's investment in AI is substantial and ongoing.

**Limitations:**
- Feedback on one MR does not influence future reviews (no organizational learning; feature request tracked in GitLab issue #560116).
- Cost modeling still requires workload assumptions, even though GitLab now publishes credit pricing and the current Code Review Flow multiplier.
- Code Review Flow runs on CI/CD infrastructure, requiring runner availability and pipeline permissions.
- Self-hosted model deployment requires hosting an AI Gateway and LLM backend — non-trivial infrastructure effort.
- GitLab's public documentation is not perfectly consistent on classic Code Review packaging: the comparison page says Duo Pro or Enterprise, while the dedicated classic Code Review page is tagged Duo Enterprise. This should be confirmed during procurement.

### CodeRabbit

CodeRabbit markets an **agentic, codebase-aware architecture** purpose-built for code review:

- CodeRabbit states it uses the latest foundational LLMs; its public trust and DPA materials list Anthropic and OpenAI among its AI subprocessors.
- "Codegraph" is positioned as codebase intelligence that helps reason about dependencies across files; CodeRabbit also advertises AST-based instructions.
- Integrates 40+ linters and SAST scanners alongside AI analysis to reduce false positives.
- Learns from team feedback via a "Learnings" system — natural language corrections are retained and applied to future reviews.
- Supports path-based and AST-based custom review instructions via YAML configuration.
- Produces PR summaries, walkthrough documentation, and architecture diagrams automatically.
- Incremental reviews: full analysis on new PRs, focused review on subsequent commits, without manual configuration.

**Strengths:**
- Most feature-complete commercial offering for pure code review.
- Codegraph + 40 linters plus richer AI context gives the broadest analysis surface evaluated.
- "Learnings" system enables organizational feedback loops — corrections are retained and applied across future reviews. This is a meaningful differentiator that neither competitor offers.
- One-click fix application and "Fix with AI" button for complex remediation.
- Conversational: teams can reply to comments, give feedback, and request alternatives inline.
- SOC 2 Type II, ISO 27001, and GDPR compliant. Published Trust Center with named subprocessors.
- Used by recognizable enterprises (NVIDIA — "We're using CodeRabbit all over NVIDIA," per CEO Jensen Huang).
- Built-in analytics dashboard with review metrics, trends, and team reporting — valuable for engineering leadership visibility.
- IDE and CLI review products complement PR-level reviews.

**Limitations:**
- SaaS by default — merge request diffs are sent to CodeRabbit's cloud infrastructure (webhook endpoint: `coderabbit.ai/gitlabHandler`). CodeRabbit states zero data retention post-review, but code does transit their systems.
- Self-hosted Enterprise option exists, but CodeRabbit's public docs route this through sales, position it for Enterprise customers with 500+ seats, and do not publicly document the deployment architecture in detail.
- IP allowlisting required for self-managed GitLab instances (`35.222.179.152/32`, `34.170.211.100/32`, `136.113.208.247/32`).
- No control over which LLM models power the review.
- Review logic is opaque — no visibility into exactly how findings are generated or weighted.

### Git Gandalf

Git Gandalf implements a **3-stage agentic pipeline** purpose-built for deep code review:

1. **Context & Intent Mapper** — Analyzes MR title, description, diff, and linked Jira tickets. Produces intent summary, change categories, and risk hypotheses.
2. **Socratic Investigator** — Tool-calling agent with access to `read_file`, `search_codebase` (ripgrep), and `get_directory_structure`. Runs up to 15 iterative loops to explore the cloned repository, investigating hypotheses identified in Stage 1.
3. **Reflection & Consolidation** — Validates findings, deduplicates, assigns severity, and can trigger one reinvestigation loop if warranted.

**Strengths:**
- Agents can read arbitrary files and search the full codebase — not limited to diff context — via a local shallow clone of the source branch.
- Multi-provider LLM fallback: AWS Bedrock (Claude Sonnet 4) → OpenAI (GPT-4o) → Google Gemini. Provider order is configurable, avoiding single-vendor lock-in.
- Incremental review via checkpoint system: machine-readable markers track reviewed SHA ranges; subsequent pushes review only new commits unless rebase/force-push is detected.
- Branch-scoped pipeline serialization prevents race conditions on rapid pushes.
- Jira integration pulls ticket context (summary, status, acceptance criteria) for richer analysis.
- Repo-owned review configuration now has a first-class foundation via `.gitgandalf.yaml`, giving teams a documented YAML contract for exclusions, review instructions, severity defaults, feature flags, linter-profile references, and output preferences without editing deployment env vars.
- Full source code access means prompts, agent behavior, and review logic can be modified without vendor dependencies.
- Strongest data sovereignty posture — no third-party review platform is involved, and the organization controls all LLM provider relationships directly.
- Lowest direct cost of any option (LLM tokens only, no per-seat licensing).

**Limitations — an honest assessment:**
- **Pre-production maturity.** Git Gandalf is a well-engineered prototype, not a battle-tested product. There is no production deployment history, no performance telemetry, no SLA documentation, and no operational runbook.
- **No built-in linter or SAST integration.** Review quality relies entirely on LLM reasoning. CodeRabbit's 40+ linter integrations and GitLab's separate SAST features provide additional coverage layers.
- **No organizational learning.** There is no feedback mechanism to improve reviews over time. CodeRabbit's "Learnings" system is a genuine competitive advantage here.
- **Repo config is only partially realized.** `.gitgandalf.yaml` is now loaded, validated, and documented, but most config-driven behavior is still planned rather than fully enforced in the live review pipeline.
- **No PR summary, walkthrough, or architecture diagram generation.** Git Gandalf outputs findings + a summary verdict only.
- **No analytics dashboard.** No way to measure review trends, finding rates, or team-level metrics without building custom reporting on structured logs.
- **Bus factor risk.** Currently a single-contributor project. While documentation is thorough, there is no secondary maintainer or contributor community.
- **No one-click fix application.** Suggestions use GitLab-compatible suggestion fences, but applying them requires the standard GitLab UI flow.
- **Queue system is architecturally sound but operationally unproven.** No load testing data, no monitoring integration, no documented capacity planning.
- **Review latency is non-trivial.** The 3-stage pipeline with up to 15 tool iterations means reviews may take 30–90+ seconds per MR. No performance telemetry exists to confirm actual latency percentiles.
- **Kubernetes manifests are scaffolding.** No HPA, no resource limits, no Helm chart, no ingress examples.
- **Engineering maintenance cost is hidden.** Direct LLM costs are low, but ongoing maintenance, incident response, and feature development represent real engineering time.

### Capability Comparison

| Capability | GitLab Duo | CodeRabbit | Git Gandalf |
|---|---|---|---|
| Multi-step agentic reasoning | Yes (Code Review Flow) | Yes | Yes (3-stage + reinvestigation) |
| Repository context (beyond diff) | Yes (Code Review Flow — repo structure awareness) | Yes (Codegraph / AST-based instructions) | Yes (clone + read_file + ripgrep) |
| Custom LLM model choice | Yes (self-hosted AI Gateway) | No | Yes (Bedrock/OpenAI/Gemini) |
| Incremental review (new commits only) | Not clearly documented | Yes | Yes (checkpoint ledger) |
| Linter / SAST integration | Separate GitLab SAST features | 40+ built-in | None |
| Interactive follow-up | Yes (@GitLabDuo) | Yes (@coderabbitai) | Yes (/ai-review) |
| Learns from feedback across MRs | No (feature requested) | Yes (Learnings system) | No |
| Jira context enrichment | No | Yes (Jira & Linear) | Yes (Jira read-only) |
| PR summary / walkthrough / diagram | Partial (adjacent Duo summary features exist, but no walkthrough/diagram equivalent is documented) | Yes (summary + walkthrough + diagram) | Verdict + findings summary only |
| One-click fix application | Not documented | Yes | No |
| Custom review instructions | Yes (YAML, per-file patterns) | Yes (YAML + AST + Learnings) | Yes (system prompts, source modification) |
| Analytics / reporting | Limited (sessions, GitLab Credits dashboard, broader GitLab reporting) | Built-in analytics dashboard | Structured logs (DIY) |

---

## 2. Data Privacy & Security

This is a critical evaluation axis for any organization handling sensitive source code or operating under regulatory constraints.

| | GitLab Duo | CodeRabbit | Git Gandalf |
|---|---|---|---|
| **Where code is processed** | GitLab AI Gateway (cloud) or self-hosted AI Gateway + supported LLMs | CodeRabbit cloud (SaaS); or self-hosted (Enterprise tier) | Application runs on company infrastructure; LLM inference via organization's chosen provider (e.g., AWS Bedrock in org's own account) |
| **Data leaves network** | Yes for cloud models; No if fully self-hosted AI Gateway + LLMs | Yes in SaaS mode (zero retention stated); Enterprise self-hosted option exists | Code diffs transit to the organization's chosen LLM provider; no third-party review platform involved |
| **Data retention** | GitLab privacy statement applies; Duo Self-Hosted keeps inference data on-network, while online-license deployments still send anonymized billing metadata | "Zero data retention post-review" and no code storage are public claims | Transient in-memory only |
| **LLM training on code** | GitLab states it will not use AI inputs to train language models without instruction or prior consent | Public materials reviewed did not expose the full training-policy answer reliably enough to treat as settled; confirm in diligence | N/A — organization controls the model |
| **Self-hosted option** | Yes (AI Gateway + supported LLM backends: vLLM, AWS Bedrock, Azure OpenAI); Code Review available 18.3+ | Enterprise tier; requires vendor engagement | Always self-hosted by design |
| **Compliance certs** | SOC 2 Type II, ISO 27001, GDPR, plus additional GitLab Trust Center credentials | SOC 2 Type II, ISO 27001, GDPR | Inherits org's certifications |
| **AI subprocessors** | Anthropic, Fireworks AI, Google Vertex for GitLab-managed models | Anthropic, OpenAI, GCP, and other listed subprocessors | Configured by organization (Bedrock, OpenAI, or Google) |
| **Private-network / custom trust options** | Strongest in self-hosted AI Gateway deployments | Public SaaS integration docs do not document a private-network path beyond Enterprise self-hosting | Full support (for example `GITLAB_CA_FILE`) |

**Assessment:** All three solutions offer paths to keep code processing on-premises, but maturity varies:

- **GitLab Duo Self-Hosted** (18.3+ for Code Review) provides a vendor-supported, documented path to fully on-premises LLM inference through a self-hosted AI Gateway. Inference data (including code inputs and model responses) does not leave the customer network. Anonymized billing metadata is sent to GitLab for usage tracking.
- **CodeRabbit SaaS** processes code through its cloud infrastructure. Its public materials state zero data retention post-review, no code storage, and published compliance artifacts. Enterprise self-hosted exists, but public documentation keeps the deployment specifics high level and routes evaluation through sales.
- **Git Gandalf** provides the strongest data sovereignty posture because no third-party review platform is involved. LLM API calls route to the organization's chosen provider (e.g., AWS Bedrock in the org's own account), with diffs included in prompts. The organization controls provider selection, DPA relationships, and network configuration.

---

## 3. Deployment & Operations

| | GitLab Duo (cloud) | GitLab Duo (self-hosted) | CodeRabbit (SaaS) | Git Gandalf |
|---|---|---|---|---|
| Setup effort | Minimal (toggle) | Moderate-High (AI Gateway + LLM backend) | Low (webhook + token) | Moderate (container + env config) |
| Ongoing ops | None | Moderate (AI Gateway + model maintenance) | None (vendor-managed) | Moderate-High (containers, queue, monitoring) |
| Infrastructure | None | AI Gateway + LLM serving | None | Docker/K8s + Valkey (optional) |
| Monitoring | Session visibility + GitLab Credits dashboard | Session visibility + GitLab Credits dashboard + self-hosted infra monitoring | Built-in analytics dashboard | DIY (structured JSON logs) |
| Scaling | Automatic | Manual | Automatic | Manual (worker replicas) |
| Air-gapped / custom CA | Via self-hosted config | Full support | Not supported (requires internet) | Full support |

---

## 4. Cost Analysis

### GitLab Duo

- **Code Review (classic)**: Seat-based Duo add-on pricing applies. GitLab's current public docs are inconsistent on whether classic Code Review is Duo Enterprise-only or available to Duo Pro and Enterprise users; confirm this directly with GitLab before procurement.
- **Code Review Flow**: Uses GitLab Credits. Premium includes $12 in credits/user/month; Ultimate includes $24/user/month. Additional on-demand credits are $1/credit.
- GitLab documents that one credit currently covers **four Code Review Flow requests**.
- **Important context**: If we are already paying for GitLab Premium or Ultimate, the base cost is sunk. The incremental cost for Duo is the add-on or credit overage, not the full subscription.

**Estimated incremental annual cost for 50 developers (on existing GitLab Premium):**
- Included GitLab Credits: **600 credits/month total** across 50 Premium users, which at the current published multiplier equates to roughly **2,400 Code Review Flow requests/month** before overage (assumes all included credits are allocated to code review; if other Agent Platform features are also used, available credits will be lower)
- If review volume stays within included credits: **$0 incremental for Code Review Flow usage**
- If credits exhaust: **$1/credit overage** (variable)
- Duo Enterprise add-on pricing: **vendor quote needed** (separate from base tier)

### CodeRabbit

- **Free tier**: PR summarization only; 14-day Pro trial included.
- **Pro**: $24/user/month (annual) or $30/user/month (monthly). Charges only for developers who create PRs. Unlimited reviews and repos.
- **Enterprise**: Custom pricing. Adds self-hosting, multi-org, SLA, RBAC, API access, dedicated CSM.

**Estimated annual cost for 50 developers:**
- Pro (annual): $24 × 50 × 12 = **$14,400/year**
- Enterprise: **Custom** (vendor quote required)
- Note: If fewer than 50 developers actively create PRs, actual seats charged may be lower.

### Git Gandalf

- **Software licensing**: $0
- **LLM API costs**: AWS Bedrock usage-based. 3–15+ LLM calls per review depending on investigator depth.
  - Estimated per-review: **$0.02–$0.15** per MR (varies with diff size and tool iterations)
  - At 200 MRs/month: **$4–$30/month** in LLM costs
- **Infrastructure**: Incremental container hosting + optional Valkey instance
- **Hidden costs**: Ongoing engineering time for maintenance, incident response, monitoring setup, and feature development. Estimated 0.5–1 FTE-month/year minimum.

**Estimated annual cost for 50 developers (200 MRs/mo):**
- Direct (LLM + infra): **~$500/year**
- Total cost of ownership including engineering time: **significantly higher** (depends on operational maturity investment)

| | GitLab Duo (incremental) | CodeRabbit Pro | Git Gandalf |
|---|---|---|---|
| Annual direct cost | $0 incremental for included Code Review Flow usage; overage at $1/credit; seat-based Duo add-ons quoted separately | ~$14,400 | ~$500 |
| Per-dev/month | Includes $12 credits per Premium user/month or $24 per Ultimate user/month | $24 | ~$0.80 direct |
| Pricing model | Included credits + overage for Flow; separate seat pricing for seat-based Duo add-ons | Per-seat | Usage-based (LLM tokens) |
| Hidden costs | None (vendor-managed) | None (vendor-managed) | Engineering maintenance time |

---

## 5. GitLab Integration Depth

| Capability | GitLab Duo | CodeRabbit | Git Gandalf |
|---|---|---|---|
| Inline MR review comments | Yes | Yes | Yes |
| Summary / walkthrough | Partial (separate Duo summary features exist, but no walkthrough/diagram equivalent is documented) | Yes (summary + walkthrough + diagram) | Verdict badge + findings list |
| Automatic review on MR creation | Yes (project/group/instance level) | Yes | Yes (webhook) |
| Manual review trigger | @GitLabDuo mention / assign reviewer | @coderabbitai mention | /ai-review comment |
| Draft MR handling | Skips drafts; reviews when marked ready | Automatic | Configurable flag |
| Code suggestion format | Native GitLab suggestions | One-click apply + "Fix with AI" | GitLab suggestion fences |
| Self-managed GitLab support | Yes; Duo Self-Hosted Code Review requires GitLab 18.3+ | Yes (16.x+; IP allowlisting required) | Yes (any version with webhooks) |
| MR description generation | Yes | No | No |
| Merge commit message generation | Yes | No | No |
| Analytics / reporting | Limited (sessions, credits visibility, broader GitLab reporting) | Built-in analytics | Structured logs (DIY) |
| Group-level rollout | Yes (cascading settings) | Yes (per-org in CodeRabbit UI) | Manual (per-project webhook) |

---

## 6. Customization & Extensibility

| | GitLab Duo | CodeRabbit | Git Gandalf |
|---|---|---|---|
| Custom review instructions | Yes (YAML, per-file patterns, language-specific) | Yes (YAML + AST + path-based + Learnings) | Yes (system prompts, source code) |
| Linter integration | Separate GitLab SAST pipeline | 40+ built-in linters + SAST | None |
| Custom agents/flows | Yes (Agent Platform) | No | Full control (source code) |
| Repo-owned review config | Yes (`.gitlab/duo/mr-review-instructions.yaml`) | Yes (`.coderabbit.yaml`) | Partial today (`.gitgandalf.yaml` foundation shipped; most runtime consumers still in progress) |
| Prompt engineering access | Not exposed | Not exposed | Full access |
| Integration extensibility | Agent Platform ecosystem | MCP servers, Jira, Linear | Any (source code) |
| Organizational learning | No (feature requested) | Yes (Learnings) | No |

---

## 7. Strengths & Weaknesses Summary

### GitLab Duo

| Strengths | Weaknesses |
|---|---|
| Zero deployment in GitLab-managed mode | Cost modeling still depends on workload assumptions |
| Cascading group/instance auto-review configuration | No organizational learning across MRs |
| Part of broader AI suite (summaries, commit gen, RCA, vuln explanation) | Self-hosted model deployment requires significant infra investment |
| Self-hosted model option for full data isolation (18.3+) | Code Review Flow requires CI/CD runner availability |
| Custom review instructions with per-file-pattern targeting | May require GitLab version or licensing changes |
| Public documentation covers both cloud and self-hosted paths | Public packaging details for classic Code Review should be confirmed with GitLab |
| Backed by public company with long-term viability | |
| Rapidly evolving Agent Platform with agentic code review | |

### CodeRabbit

| Strengths | Weaknesses |
|---|---|
| Most feature-rich review experience (summaries, walkthroughs, diagrams, one-click fixes) | Code transits vendor infrastructure in SaaS mode |
| Codegraph plus AST-based configuration for richer code context | $24/user/month; costs scale linearly |
| 40+ linter and SAST scanner integrations | Enterprise self-hosted requires vendor engagement |
| Organizational learning via "Learnings" system | Public docs provide limited detail on Enterprise self-hosted architecture |
| Built-in analytics dashboard for engineering leaders | IP allowlisting needed for self-managed GitLab |
| SOC 2 Type II + ISO 27001 + GDPR compliant | No control over model selection |
| Strong enterprise customer references (NVIDIA, Visma, TaskRabbit) | Review reasoning is opaque |
| IDE and CLI review products complement PR reviews | |

### Git Gandalf

| Strengths | Weaknesses |
|---|---|
| Strongest data sovereignty posture (no third-party review platform) | Pre-production; no deployment track record at scale |
| Lowest direct cost | No linter/SAST integration |
| Deep agentic review (3-stage + full repo access + reinvestigation) | No analytics dashboard |
| Multi-provider LLM fallback (no vendor lock-in) | Single contributor — bus factor risk |
| Repo-owned `.gitgandalf.yaml` contract for per-repo review instructions, exclusions, and future output controls | Most `.gitgandalf.yaml` fields are not yet enforced end-to-end in review execution |
| Full source code control and prompt customization | No organizational learning / feedback loop |
| Incremental review via checkpoint ledger | No PR summary/walkthrough/diagram generation |
| Jira ticket context enrichment | No one-click fix |
| Works with any GitLab version | Queue system operationally unproven |
| Custom CA / air-gapped network support | Review latency 30–90+ sec (higher than commercial) |
| | K8s deployment is scaffolding, not hardened |
| | Hidden engineering maintenance costs |

---

## 8. Risk Assessment

| Risk | GitLab Duo | CodeRabbit | Git Gandalf |
|---|---|---|---|
| **Data handling** | Low if self-hosted; Medium if cloud | Medium (zero-retention and no-storage claims, but code transits vendor in SaaS mode) | Lowest (no third-party review platform; LLM provider under org control) |
| **Vendor lock-in** | Medium (GitLab add-on; but GitLab is already our platform) | Low-Medium (webhook removal stops service) | None |
| **Cost escalation** | Medium (credit model clarity needed) | Low (per-seat, predictable, reassignable) | Low direct; Medium total (engineering time) |
| **Service availability** | High (tied to GitLab — already a dependency) | Medium (CodeRabbit SaaS uptime; status page published) | Self-managed (our SLA) |
| **Feature evolution** | High (GitLab's AI investment is significant) | High (active product; frequent updates) | Low-Medium (limited to internal capacity) |
| **Vendor stability** | Very Low risk (public-company incumbent) | Medium (private vendor; additional diligence warranted) | N/A |
| **Bus factor** | None | None | High (single contributor) |
| **Compliance burden** | Low (extend existing GitLab DPA) | Medium (new vendor; DPA + security review required) | Lowest (all internal) |
| **Production readiness** | High (GA, part of core product) | High (2M+ repos, enterprise customers) | Low (pre-production prototype) |

---

## 9. Evidence-Backed Scoring Rubric

This rubric is intended for decision support, not mathematical certainty. Scores are normalized to a 10-point scale, but each row now includes an explicit evidence basis and a confidence level to show where the judgment is firm versus where it relies on incomplete public information.

| Evaluation Criterion | Weight | Evidence Basis | Confidence | GitLab Duo | CodeRabbit | Git Gandalf |
|---|---|---|---|---|---|---|
| Review quality & depth | 20% | Publicly documented review architecture, repository context, tool access, learning mechanisms, and output formats | Medium | 6/10 | 8/10 | 8/10 |
| Data privacy & sovereignty | 20% | Vendor privacy/trust documentation, self-hosted architecture support, and where code is processed | High | 6/10 | 5/10 | 10/10 |
| Production readiness & maturity | 15% | GA status, commercial availability, deployment support, public maturity signals, and internal production history | High | 9/10 | 9/10 | 4/10 |
| Cost efficiency | 15% | Public pricing, published billing mechanics, and estimated internal operating cost assumptions | Medium | 7/10 | 5/10 | 8/10 |
| Ease of setup & operations | 10% | Required infrastructure, rollout steps, and day-2 operational burden | High | 9/10 | 8/10 | 5/10 |
| GitLab integration depth | 10% | Native workflow support, rollout controls, supported versions, and MR interaction patterns | Medium | 9/10 | 7/10 | 7/10 |
| Customization & extensibility | 5% | Review instructions, model/path configurability, source access, extensibility model, and shipped repo-owned configuration surface | Medium | 6/10 | 7/10 | 10/10 |
| Vendor risk / sustainability | 5% | Vendor posture, support model, ownership profile, and internal bus-factor risk | Medium | 9/10 | 6/10 | 5/10 |
| **Weighted Score** | **100%** | Weighted aggregate of the above rows | **Medium** | **7.4** | **6.9** | **7.4** |

### Score Notes

| Criterion | Why the score is defensible |
|---|---|
| Review quality & depth | CodeRabbit and Git Gandalf both score above GitLab Duo because their publicly described review context is broader. CodeRabbit adds organizational learning, linters, and diagrams. Git Gandalf adds repo-local tool access and multi-stage reasoning. GitLab Duo Flow is agentic, but its public feature envelope is still narrower in the reviewed materials. |
| Data privacy & sovereignty | Git Gandalf leads because the architecture remains entirely under internal control. GitLab Duo improves materially in self-hosted mode but remains a mixed story because cloud and self-hosted paths behave differently. CodeRabbit scores lowest here because the default SaaS path sends code through vendor infrastructure, even with strong trust claims. |
| Production readiness & maturity | GitLab Duo and CodeRabbit are both commercially mature offerings with operational models externalized to the vendor. Git Gandalf is intentionally penalized because it is still pre-production and lacks measured operational history. |
| Cost efficiency | GitLab Duo improves relative to the prior draft because the public GitLab Credits model is now better understood. Git Gandalf remains strong on direct cost, but not dominant enough to score higher than 8/10 because support and maintenance obligations sit entirely with us. |
| Ease of setup & operations | GitLab Duo leads because it is native. CodeRabbit is close behind because installation is lightweight in SaaS mode. Git Gandalf remains materially heavier because the organization owns deployment, queueing, monitoring, and long-term support. |
| GitLab integration depth | GitLab Duo leads as the native platform feature with cascading settings, draft handling, and description/commit message generation. CodeRabbit and Git Gandalf both integrate via webhook and inline commenting but neither has the same level of native workflow embedding. |
| Customization & extensibility | Git Gandalf now combines unrestricted source access with a shipped repo-owned `.gitgandalf.yaml` configuration contract. That closes part of the ergonomics gap with GitLab Duo and CodeRabbit, which both already expose repo-level YAML customization. The increase reflects the delivered configuration surface only; prompt injection, diff filtering, and output consumers are still planned. |
| Vendor risk / sustainability | GitLab Duo leads as a public-company incumbent already embedded in our infrastructure. CodeRabbit is a private vendor requiring additional diligence. Git Gandalf carries bus-factor risk from single-contributor ownership. |

**Interpretation:** on the rounded aggregate, GitLab Duo and Git Gandalf are now tied at 7.4. That tie should not be over-read: GitLab Duo still leads materially on maturity, rollout simplicity, and vendor accountability, while Git Gandalf leads on sovereignty and now has a more credible repo-level customization path. The practical takeaway remains the same: Git Gandalf wins only if leadership gives disproportionate weight to sovereignty and control while accepting internal ownership risk. If leadership instead prioritizes speed, predictability, and vendor accountability, GitLab Duo is still the stronger default operating choice.

---

## 10. Scenario-Based Recommendations

Rather than forcing a single answer, the recommendations below map the choice to the decision posture leadership wants to take.

### Scenario A: Data Sovereignty Is the Top Priority

**Recommended: Git Gandalf or GitLab Duo Self-Hosted** (depending on whether control or vendor support matters more)

If keeping source code entirely within the company network is non-negotiable — due to regulatory constraints, customer contracts, or organizational policy — these are the two strongest fits. Git Gandalf offers the most direct architectural control because it is self-built and self-hosted. GitLab Duo Self-Hosted offers a vendor-supported on-premises path, but with materially more infrastructure and commercial dependency.

**Required investment:** 2–3 engineering sprints to harden: monitoring integration, load testing, operational runbooks, secondary maintainer, and formalized SLA targets.

**Alternative framing:** choose Git Gandalf if maximum control and prompt-level customization outweigh vendor support; choose GitLab Duo Self-Hosted if vendor support and broader GitLab alignment outweigh flexibility.

### Scenario B: Fastest Time-to-Value with Minimal Risk

**Recommended: GitLab Duo** (cloud or hybrid model)

If the goal is AI reviews running across all projects within days, with no new vendor relationship and no infrastructure to deploy, GitLab Duo is the lowest-risk path. Enable automatic reviews at the group level, add custom review instructions via YAML, and iterate.

**Trade-off:** This is the safest operating choice, not necessarily the most feature-rich one. Review depth and packaging clarity still need to be weighed against GitLab's platform convenience.

### Scenario C: Deepest Review Quality with Enterprise Convenience

**Recommended: CodeRabbit Pro** (or Enterprise for self-hosted)

If review quality, developer experience, and organizational learning are the top priorities — and the organization is comfortable with a SaaS code review processor — CodeRabbit is the strongest option. Summaries, walkthroughs, one-click fixes, 40+ linters, feedback learning, and analytics out of the box.

**Trade-off:** This is the strongest packaged review experience, but it comes with vendor concentration, per-seat cost, and a heavier diligence burden around data handling and Enterprise deployment specifics.

### Scenario D: Start Simple, Evolve Over Time

**Recommended: Start with GitLab Duo → Evaluate Git Gandalf in parallel**

Enable GitLab Duo's automatic code reviews immediately if its packaging and included-credit model fit our subscription posture. In parallel, invest in hardening Git Gandalf for production. Compare review quality side-by-side over a 4–6 week period on the same MRs. Make a data-driven decision on whether Git Gandalf's deeper analysis justifies the operational investment, or whether GitLab Duo's improving platform narrows the gap sufficiently.

**Execution note:** this is likely the best path if leadership wants to preserve optionality. It creates a low-regret near-term deployment while buying time to validate whether the internal platform advantage is real enough to justify ownership.

---

## Appendix A: Key Vendor References

| Resource | URL |
|---|---|
| GitLab Duo Code Review docs | https://docs.gitlab.com/user/project/merge_requests/duo_in_merge_requests/ |
| GitLab Duo Code Review Flow | https://docs.gitlab.com/user/duo_agent_platform/flows/foundational_flows/code_review/ |
| GitLab Duo Self-Hosted Models | https://docs.gitlab.com/administration/gitlab_duo_self_hosted/ |
| GitLab Duo Custom Review Instructions | https://docs.gitlab.com/user/gitlab_duo/customize_duo/review_instructions/ |
| GitLab Duo Add-ons | https://docs.gitlab.com/subscriptions/subscription-add-ons/ |
| GitLab Credits and Usage Billing | https://docs.gitlab.com/subscriptions/gitlab_credits/ |
| GitLab Pricing | https://about.gitlab.com/pricing/ |
| CodeRabbit Documentation | https://docs.coderabbit.ai/ |
| CodeRabbit GitLab Integration | https://docs.coderabbit.ai/platforms/gitlab-com |
| CodeRabbit Self-Managed GitLab | https://docs.coderabbit.ai/platforms/self-hosted-gitlab |
| CodeRabbit Trust Center | https://trust.coderabbit.ai/ |
| CodeRabbit Platform Overview | https://docs.coderabbit.ai/platforms/overview |
| CodeRabbit Pricing | https://www.coderabbit.ai/pricing |

---

## Appendix B: Procurement Questions Before VP Decision

The following questions should be answered before any approval to buy, build, or roll out at scale.

### GitLab Duo

1. What exact entitlement is required for classic GitLab Duo Code Review in our deployment: Duo Pro, Duo Enterprise, or both depending on version and hosting model?
2. What features in our target deployment are GA versus beta versus experiment, and which of those statuses matter to our risk posture?
3. If we use Code Review Flow, what review volume would our current MR throughput generate in GitLab Credits each month?
4. If we use GitLab Duo Self-Hosted, what infrastructure must we run internally: AI Gateway, model serving, observability, and support coverage?
5. What internal teams would own the AI Gateway, model lifecycle, and incident response if we choose the self-hosted path?
6. Which GitLab-managed versus self-hosted model combinations are actually approved and supportable for our environment?

### CodeRabbit

1. What is the definitive Enterprise self-hosting architecture, and what components remain vendor-managed versus customer-managed?
2. Is the 500+ seat positioning a hard commercial threshold or a typical target profile?
3. What contractual commitments govern data retention, deletion timing, training restrictions, and subprocessor use?
4. Can CodeRabbit provide an authoritative answer on whether customer code is ever used to improve models, internal systems, or review quality outside the customer boundary?
5. What are the support SLAs, uptime commitments, and escalation paths for GitLab integrations?
6. What additional infrastructure, network rules, and security controls are required for a self-managed GitLab deployment?

### Git Gandalf

1. Who will own production support, on-call response, backlog management, and model/provider maintenance after launch?
2. What availability, latency, and review-completion targets are acceptable for an internally owned service?
3. What minimum production-hardening work is required before pilot approval: monitoring, alerting, load testing, runbooks, backup maintainers, and security review?
4. What is the acceptable blast radius if the tool fails or generates noisy reviews during rollout?
5. How will we measure review quality, false positives, review latency, adoption, and ROI relative to commercial alternatives?
6. What is the explicit annual engineering budget, in time not just dollars, that leadership is willing to invest in owning this platform?

### Cross-Option Decision Gates

1. Is full code residency inside the company network a hard requirement or a preference?
2. Is the organization optimizing for fastest rollout, best developer experience, lowest total cost, or maximum control?
3. Does leadership want a vendor-backed operational model or is it prepared to own a strategic internal platform?
4. What level of AI feature ambiguity is acceptable if the vendor roadmap is moving quickly?
5. What would count as a successful 60-day pilot: adoption, defect catch rate, reduced review time, or developer satisfaction?

---

*This evaluation is based on publicly available vendor documentation and internal codebase analysis as of March 28, 2026. Vendor features, pricing, and capabilities are subject to change. Cost estimates should be validated with vendor quotes before any procurement decision.*
