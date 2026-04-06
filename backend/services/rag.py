"""
RAG (Retrieval-Augmented Generation) Service
Provides a voice-queryable knowledge base using OpenAI embeddings + cosine similarity.
This showcases how Pipecat's modular pipeline can add RAG to voice AI at a fraction
of the cost of OpenAI Realtime API.
"""
import numpy as np
from openai import AsyncOpenAI

# ---------------------------------------------------------------------------
# Sample knowledge base — replace with your own documents for production use.
# This demo uses a fictional SaaS company's internal FAQ / product knowledge.
# ---------------------------------------------------------------------------
KNOWLEDGE_BASE = [
    {
        "id": "pricing_starter",
        "title": "Starter Plan Pricing",
        "content": (
            "The Starter plan costs $29 per month and includes up to 3 team members, "
            "10,000 API calls per month, basic analytics dashboard, email support with "
            "48-hour response time, and 5 GB of data storage. Ideal for small teams and "
            "early-stage startups exploring the platform."
        ),
    },
    {
        "id": "pricing_pro",
        "title": "Pro Plan Pricing",
        "content": (
            "The Pro plan is $99 per month and supports up to 20 team members, "
            "500,000 API calls per month, advanced analytics with custom reports, "
            "priority email and chat support with 4-hour response time, 50 GB storage, "
            "custom integrations via webhooks, and SSO (Single Sign-On). "
            "Most popular for growing companies."
        ),
    },
    {
        "id": "pricing_enterprise",
        "title": "Enterprise Plan",
        "content": (
            "Enterprise pricing is custom and negotiated based on usage. It includes "
            "unlimited team members, unlimited API calls with SLA guarantees, dedicated "
            "account manager, 24/7 phone and chat support, unlimited storage, "
            "on-premise deployment option, custom contracts, and SOC 2 Type II compliance reports. "
            "Contact sales@example.com for a quote."
        ),
    },
    {
        "id": "leave_policy",
        "title": "Employee Leave Policy",
        "content": (
            "Employees receive 20 days of paid time off (PTO) per year, accruing monthly. "
            "Sick leave is separate: 10 days per year, not accrued. "
            "Parental leave: primary caregivers get 16 weeks fully paid; secondary caregivers get 4 weeks paid. "
            "PTO can be carried over up to 10 days into the next calendar year. "
            "Unused PTO above the carry-over limit is forfeited at year-end."
        ),
    },
    {
        "id": "remote_work",
        "title": "Remote Work Policy",
        "content": (
            "Employees may work remotely up to 3 days per week by default. "
            "Full-time remote work requires written manager approval and VP sign-off. "
            "All remote employees must be available between 10 AM and 3 PM in their local timezone. "
            "A $500 annual home-office equipment allowance is provided. "
            "International remote work is allowed for up to 30 consecutive days with HR notification."
        ),
    },
    {
        "id": "benefits",
        "title": "Employee Benefits Package",
        "content": (
            "Benefits include: comprehensive medical, dental, and vision insurance for employees and dependents; "
            "401(k) retirement plan with 4% company match (vesting after 1 year); "
            "$2,000 annual learning and development budget for courses, books, and conferences; "
            "free gym membership or $50/month wellness stipend; "
            "mental health support via Employee Assistance Program (EAP); "
            "home internet reimbursement of $50/month for remote employees."
        ),
    },
    {
        "id": "onboarding",
        "title": "New Employee Onboarding",
        "content": (
            "Onboarding follows a 30-60-90 day plan. "
            "Week 1: admin setup, equipment delivery, system access, team introductions, and company overview. "
            "Days 8–30: shadowing senior teammates, attending key meetings, light contributions to live projects. "
            "Days 31–60: independent tasks with weekly 1:1 check-ins with manager. "
            "Days 61–90: full productivity expected, first performance check-in, OKR goal setting. "
            "Every new hire is assigned a buddy for the first 90 days."
        ),
    },
    {
        "id": "api_authentication",
        "title": "API Authentication",
        "content": (
            "The API uses Bearer token authentication. Generate an API key from the Dashboard under Settings > API Keys. "
            "Pass the key in the Authorization header: 'Authorization: Bearer YOUR_API_KEY'. "
            "API keys do not expire but can be revoked at any time. "
            "For webhook signatures, use HMAC-SHA256 with your webhook secret to verify payloads. "
            "Rate limits: Starter = 100 req/min; Pro = 1,000 req/min; Enterprise = custom."
        ),
    },
    {
        "id": "api_errors",
        "title": "Common API Errors",
        "content": (
            "401 Unauthorized: API key is missing, invalid, or revoked. Check your Authorization header. "
            "403 Forbidden: Your plan does not include this feature or you've exceeded your quota. "
            "429 Too Many Requests: Rate limit exceeded. Implement exponential back-off and retry. "
            "500 Internal Server Error: Transient server issue. Retry after 30 seconds. "
            "Check our status page at status.example.com for ongoing incidents."
        ),
    },
    {
        "id": "data_privacy",
        "title": "Data Privacy & Compliance",
        "content": (
            "We are SOC 2 Type II certified and GDPR compliant. "
            "Customer data is encrypted at rest (AES-256) and in transit (TLS 1.3). "
            "Data is stored in AWS us-east-1 by default; EU data residency is available on Enterprise plans. "
            "Data retention: active account data is kept indefinitely; deleted account data is purged within 30 days. "
            "You can request a full data export or deletion via your account settings or by emailing privacy@example.com."
        ),
    },
    {
        "id": "integrations",
        "title": "Available Integrations",
        "content": (
            "Native integrations available: Slack, Microsoft Teams, Salesforce, HubSpot, Zapier, "
            "GitHub, Jira, Notion, Google Workspace, and Stripe. "
            "Webhook support is available on Pro and Enterprise plans for custom integrations. "
            "REST API and Python/Node.js/Go SDKs are publicly available. "
            "An integration marketplace with 200+ community-built connectors is accessible from the Dashboard."
        ),
    },
    {
        "id": "performance_reviews",
        "title": "Performance Review Process",
        "content": (
            "Performance reviews happen twice a year: mid-year in June and annual in December. "
            "Ratings: Exceptional, Exceeds Expectations, Meets Expectations, Needs Improvement. "
            "Compensation increases are determined at the annual December review. "
            "Promotions can happen outside the review cycle with manager and HR approval. "
            "360-degree peer feedback is collected for all employees at the senior level and above."
        ),
    },
]


class RAGService:
    """
    In-memory vector store using OpenAI text-embedding-3-small.
    Cheap, fast, and accurate enough for production RAG at scale.
    """

    EMBEDDING_MODEL = "text-embedding-3-small"  # $0.02 / 1M tokens — very cheap

    def __init__(self, openai_api_key: str):
        self.client = AsyncOpenAI(api_key=openai_api_key)
        self.documents = KNOWLEDGE_BASE
        self._embeddings: list[tuple[str, np.ndarray]] = []
        self.initialized = False

    async def initialize(self):
        """Pre-embed all knowledge base documents at startup."""
        print(f"RAG: Embedding {len(self.documents)} documents...")
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
        print(f"RAG: Ready — {len(self._embeddings)} documents indexed.")

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
