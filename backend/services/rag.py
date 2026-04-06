"""
RAG (Retrieval-Augmented Generation) Service
Insurance domain knowledge base — powers a voice AI insurance assistant.

Use case: customers can speak naturally to get instant answers about their
policy, coverage, claims, premiums, and more — 24/7, no hold music.

This showcases how a Pipecat pipeline (Speechmatics STT → GPT-4o text LLM
→ Cartesia TTS) delivers full voice-agentic RAG at a fraction of the cost
of OpenAI Realtime API.
"""
import numpy as np
from openai import AsyncOpenAI

# ---------------------------------------------------------------------------
# Insurance Knowledge Base
# Covers: auto, health, home, life — common customer queries
# ---------------------------------------------------------------------------
KNOWLEDGE_BASE = [
    # ── AUTO INSURANCE ──────────────────────────────────────────────────────
    {
        "id": "auto_coverage_types",
        "title": "Auto Insurance Coverage Types",
        "content": (
            "We offer six auto coverage types: "
            "(1) Liability — covers bodily injury and property damage you cause to others; required by law in most states. "
            "(2) Collision — covers damage to your car from accidents regardless of fault. "
            "(3) Comprehensive — covers non-collision damage: theft, fire, flood, hail, vandalism, and animal strikes. "
            "(4) Uninsured/Underinsured Motorist — protects you when the at-fault driver has no or insufficient insurance. "
            "(5) Medical Payments (MedPay) — covers medical bills for you and passengers, regardless of fault. "
            "(6) Personal Injury Protection (PIP) — broader than MedPay; also covers lost wages and rehabilitation. "
            "A full-coverage policy typically combines liability + collision + comprehensive."
        ),
    },
    {
        "id": "auto_deductibles",
        "title": "Auto Insurance Deductibles",
        "content": (
            "Your deductible is the amount you pay out-of-pocket before insurance pays the rest. "
            "Common deductible options: $250, $500, $1,000, $1,500, $2,000. "
            "Higher deductible = lower monthly premium; lower deductible = higher monthly premium. "
            "Example: with a $500 deductible and a $3,200 repair bill, you pay $500 and we pay $2,700. "
            "Deductibles apply separately for collision and comprehensive claims. "
            "Liability claims have no deductible — we pay the other party directly."
        ),
    },
    {
        "id": "auto_premiums",
        "title": "Auto Insurance Premium Factors",
        "content": (
            "Your auto premium is calculated based on: "
            "driving record (accidents and violations in the past 3–5 years), "
            "age and gender (young males typically pay more), "
            "vehicle make, model, year, and safety ratings, "
            "annual mileage (less driving = lower risk), "
            "credit score (in most states), "
            "location (urban areas have higher theft and accident rates), "
            "coverage limits and deductibles chosen. "
            "Average annual auto premium in the US: $1,771 (2024). "
            "Safe driver discounts of up to 25% are available for 3+ years with no claims. "
            "Bundling auto + home saves an average of 15%."
        ),
    },
    {
        "id": "auto_claims",
        "title": "How to File an Auto Insurance Claim",
        "content": (
            "Step 1 — Ensure safety: move to a safe location and call 911 if there are injuries. "
            "Step 2 — Document the scene: take photos of all vehicles, license plates, road conditions, and injuries. "
            "Step 3 — Exchange information: get the other driver's name, license number, insurance company, and policy number. "
            "Step 4 — Report the claim: call our 24/7 claims line at 1-800-555-CLAIM or file online at myinsurance.com/claims. "
            "Step 5 — Claims adjuster: an adjuster will contact you within 24 hours to assess damage. "
            "Step 6 — Repair: use any shop in our preferred network for a lifetime repair guarantee, or choose your own shop. "
            "Step 7 — Settlement: most claims are settled within 7–10 business days. "
            "Do NOT admit fault at the scene — let the adjusters determine liability."
        ),
    },
    {
        "id": "auto_roadside",
        "title": "Roadside Assistance",
        "content": (
            "Roadside assistance is included at no extra cost on all Platinum and Gold auto policies. "
            "Silver and Basic policyholders can add it for $3/month. "
            "Services covered: towing up to 50 miles, flat tire change, battery jump-start, "
            "lockout service (locked keys in car), fuel delivery up to 3 gallons, and winching if stuck in mud or snow. "
            "To request roadside assistance: call 1-800-555-ROAD (available 24/7), "
            "or use the MyInsurance mobile app for GPS-enabled dispatch. "
            "Average response time: 28 minutes."
        ),
    },
    # ── HEALTH INSURANCE ────────────────────────────────────────────────────
    {
        "id": "health_plan_types",
        "title": "Health Insurance Plan Types",
        "content": (
            "We offer four main health plan structures: "
            "(1) HMO (Health Maintenance Organization) — lower premiums; must use in-network providers; requires referrals to see specialists. "
            "(2) PPO (Preferred Provider Organization) — higher premiums; can see any doctor without referral; out-of-network covered at higher cost. "
            "(3) EPO (Exclusive Provider Organization) — mid-range premiums; in-network only except emergencies; no referrals needed. "
            "(4) HDHP (High Deductible Health Plan) — low premiums, high deductible ($1,600+ individual); compatible with a Health Savings Account (HSA). "
            "Our most popular plan is the Gold PPO for families and the Silver HDHP for healthy young adults."
        ),
    },
    {
        "id": "health_copays",
        "title": "Health Insurance Copays and Deductibles",
        "content": (
            "Copay: a fixed amount you pay per visit or service. "
            "Typical copays on our Gold plan: Primary care $25, Specialist $50, Urgent care $75, ER $250. "
            "Deductible: the amount you pay before insurance starts covering costs (except preventive care, which is always free). "
            "2024 plan deductibles: Bronze $6,000 individual, Silver $3,500, Gold $1,200, Platinum $0. "
            "Out-of-pocket maximum: the most you pay in a year. After this, insurance covers 100%. "
            "2024 OOP max: Bronze $9,450, Silver $7,800, Gold $5,200, Platinum $2,500. "
            "Copays count toward your out-of-pocket maximum."
        ),
    },
    {
        "id": "health_prescriptions",
        "title": "Prescription Drug Coverage",
        "content": (
            "All plans include prescription drug coverage (formulary). Drugs are grouped into tiers: "
            "Tier 1 (generic): $10 copay. "
            "Tier 2 (preferred brand): $35 copay. "
            "Tier 3 (non-preferred brand): $75 copay. "
            "Tier 4 (specialty drugs): 20% coinsurance after deductible. "
            "90-day supply via mail order saves you one month's copay. "
            "To check if your medication is covered, use the formulary lookup at myinsurance.com/drugs or call member services. "
            "Prior authorization is required for Tier 3 and Tier 4 drugs. "
            "Generic substitution is recommended when available — same active ingredient, significantly lower cost."
        ),
    },
    {
        "id": "health_open_enrollment",
        "title": "Open Enrollment and Special Enrollment Periods",
        "content": (
            "Open Enrollment Period (OEP): November 1 – January 15 each year. "
            "Coverage starts February 1 if you enroll by January 15. "
            "If you enroll by December 15, coverage starts January 1. "
            "Special Enrollment Period (SEP): triggered by qualifying life events — "
            "losing job-based coverage, marriage, divorce, having a baby, adoption, moving to a new coverage area, or turning 26 and losing parent's plan. "
            "You have 60 days from the qualifying event to enroll. "
            "Medicaid and CHIP have year-round enrollment. "
            "Missing OEP without a qualifying event means you cannot get coverage until the next OEP."
        ),
    },
    # ── HOME INSURANCE ──────────────────────────────────────────────────────
    {
        "id": "home_coverage",
        "title": "Home Insurance Coverage",
        "content": (
            "A standard homeowner's policy (HO-3) covers: "
            "Dwelling — the structure of your home against 16 named perils (fire, wind, hail, lightning, theft, vandalism, etc.). "
            "Other Structures — fences, garages, sheds (typically 10% of dwelling coverage). "
            "Personal Property — furniture, electronics, clothing (typically 50–70% of dwelling coverage). "
            "Loss of Use — living expenses if your home is uninhabitable during repairs (typically 20% of dwelling coverage). "
            "Liability — if someone is injured on your property; covers legal fees and settlements up to $300,000. "
            "Medical Payments — covers guests' medical bills regardless of fault, typically $1,000–$5,000. "
            "NOT covered: floods (requires separate NFIP or private flood policy), earthquakes, normal wear and tear, pest damage."
        ),
    },
    {
        "id": "home_claims",
        "title": "How to File a Home Insurance Claim",
        "content": (
            "Step 1 — Prevent further damage: make temporary repairs (tarping a roof, boarding windows) and keep receipts — we reimburse reasonable emergency repairs. "
            "Step 2 — Document everything: photograph and video all damage before cleaning up. "
            "Step 3 — File the claim: call 1-800-555-HOME or file at myinsurance.com/claims within 72 hours of the incident. "
            "Step 4 — Adjuster visit: a claims adjuster will inspect within 3–5 business days. "
            "Step 5 — Estimate and payout: you receive an initial estimate. If you disagree, you can request a re-inspection or invoke the appraisal clause. "
            "Step 6 — Contractor: we have a vetted contractor network for fast, guaranteed repairs. "
            "Average home claim settlement: 14 days. "
            "Claims do NOT automatically raise your premium — only frequent or high-value claims may trigger a review."
        ),
    },
    {
        "id": "home_discounts",
        "title": "Home Insurance Discounts",
        "content": (
            "Available discounts for homeowners: "
            "Bundle discount: save 15% when combining home + auto. "
            "New home discount: 15% for homes built within the last 10 years. "
            "Security system: 5% for monitored burglar/fire alarm, 10% for smart home security. "
            "Loyalty discount: 3% per year with us, up to 15%. "
            "Claims-free discount: 10% after 5 years with no claims. "
            "Impact-resistant roof: up to 20% in hail-prone areas. "
            "Senior discount: 10% for policyholders aged 65+. "
            "HOA discount: 5% if your community has a homeowners association. "
            "Call us or log in to myinsurance.com to see which discounts apply to your policy."
        ),
    },
    # ── LIFE INSURANCE ──────────────────────────────────────────────────────
    {
        "id": "life_types",
        "title": "Life Insurance Types",
        "content": (
            "We offer three main life insurance products: "
            "(1) Term Life — the most affordable option; provides coverage for a fixed period (10, 20, or 30 years); pays a death benefit if you die during the term; no cash value. "
            "Best for: income replacement, mortgage protection, young families. "
            "(2) Whole Life — permanent coverage with a guaranteed death benefit; builds cash value you can borrow against; premiums are fixed for life. "
            "Best for: estate planning, lifelong dependents. "
            "(3) Universal Life — flexible premiums and adjustable death benefit; cash value earns interest based on market rates. "
            "Best for: those who want flexibility. "
            "Rule of thumb: buy term life coverage equal to 10–12x your annual income."
        ),
    },
    {
        "id": "life_claims",
        "title": "How to File a Life Insurance Claim",
        "content": (
            "To file a life insurance claim after a policyholder's death: "
            "Step 1 — Obtain a certified copy of the death certificate (typically from the funeral home or county clerk). "
            "Step 2 — Locate the policy number (on the original policy document or by calling member services with the insured's SSN). "
            "Step 3 — Submit the claim: mail or upload the completed Life Claim form + death certificate to claims@myinsurance.com or fax to 1-800-555-LFAX. "
            "Step 4 — Verification: we verify the claim within 5 business days. "
            "Step 5 — Payout: the death benefit is paid to the named beneficiary by check or bank transfer within 10–15 business days. "
            "Suicide exclusion: most policies have a 2-year exclusion period. "
            "Contestability period: claims filed within the first 2 years of the policy may be reviewed for misrepresentation."
        ),
    },
    # ── GENERAL POLICY & BILLING ─────────────────────────────────────────────
    {
        "id": "payment_options",
        "title": "Payment Options and Billing",
        "content": (
            "Premium payment frequency options: monthly, quarterly, semi-annual, or annual. "
            "Annual payment discount: save 5% by paying the full year upfront. "
            "Accepted payment methods: credit/debit card, bank ACH transfer, check, and the MyInsurance app. "
            "AutoPay discount: save $5/month when you enroll in automatic payments. "
            "Grace period: 30 days after the due date before your policy lapses. "
            "If your policy lapses: you lose coverage immediately and may face a reinstatement fee of $25–$75 plus back-payment of missed premiums. "
            "To update payment info: log in at myinsurance.com/billing or call 1-800-555-PAY."
        ),
    },
    {
        "id": "cancel_and_refund",
        "title": "Cancellation and Refund Policy",
        "content": (
            "You may cancel your policy at any time. "
            "How to cancel: call 1-800-555-HELP, email cancel@myinsurance.com, or submit a written cancellation request. "
            "Refund for prepaid premiums: calculated on a pro-rata basis (you are refunded for unused days of coverage). "
            "Example: if you paid $1,200 for the year and cancel after 3 months, you receive a refund of $900. "
            "Cancellation processing time: 3–5 business days. "
            "Early cancellation fee: none for policyholders. "
            "If we cancel your policy (due to non-payment or fraud), you receive 30 days' written notice. "
            "Note: cancelling auto insurance without a replacement policy may result in a license suspension in most states."
        ),
    },
]


class RAGService:
    """
    In-memory vector store using OpenAI text-embedding-3-small.
    Searches the insurance knowledge base for the most relevant documents
    to ground the voice AI's answers.
    """

    EMBEDDING_MODEL = "text-embedding-3-small"  # $0.02 / 1M tokens

    def __init__(self, openai_api_key: str):
        self.client = AsyncOpenAI(api_key=openai_api_key)
        self.documents = KNOWLEDGE_BASE
        self._embeddings: list[tuple[str, np.ndarray]] = []
        self.initialized = False

    async def initialize(self):
        """Pre-embed all knowledge base documents at startup."""
        print(f"RAG: Embedding {len(self.documents)} insurance documents...")
        texts = [f"{doc['title']}: {doc['content']}" for doc in self.documents]

        response = await self.client.embeddings.create(
            model=self.EMBEDDING_MODEL,
            input=texts,
        )

        self._embeddings = [
            (doc["id"], np.array(emb.embedding, dtype=np.float32))
            for doc, emb in zip(self.documents, response.data)
        ]
        self.initialized = True
        print(f"RAG: Ready — {len(self._embeddings)} insurance documents indexed.")

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))

    async def search(self, query: str, top_k: int = 3) -> list[dict]:
        """Find the top_k most relevant documents for a voice query."""
        if not self.initialized:
            await self.initialize()

        response = await self.client.embeddings.create(
            model=self.EMBEDDING_MODEL,
            input=[query],
        )
        query_vec = np.array(response.data[0].embedding, dtype=np.float32)

        scored = [
            (doc_id, self._cosine_similarity(query_vec, emb))
            for doc_id, emb in self._embeddings
        ]
        scored.sort(key=lambda x: x[1], reverse=True)

        results = []
        for doc_id, score in scored[:top_k]:
            doc = next(d for d in self.documents if d["id"] == doc_id)
            results.append(
                {
                    "title": doc["title"],
                    "content": doc["content"],
                    "relevance": round(score, 3),
                }
            )
        return results

    def format_context(self, results: list[dict]) -> str:
        """Format search results into a compact context string for the LLM."""
        if not results:
            return "No relevant information found in the knowledge base."
        parts = []
        for r in results:
            parts.append(f"**{r['title']}** (relevance: {r['relevance']})\n{r['content']}")
        return "\n\n---\n\n".join(parts)
