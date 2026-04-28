import asyncio
import base64
from playwright.async_api import async_playwright, Browser, Page, Playwright

class BrowserController:
    """Persistent Chromium instance controlled by natural language commands via GPT-4o."""

    def __init__(self):
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._page: Page | None = None
        self._lock = asyncio.Lock()

    async def _ensure_started(self):
        if self._browser is None:
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=True,  # must be headless for Cloud Run
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            self._page = await self._browser.new_page(
                viewport={"width": 1280, "height": 800}
            )

    async def execute(self, command: str, openai_client) -> dict:
        """
        Convert natural language command to Playwright actions via GPT-4o,
        execute them, capture screenshot, return result dict.
        """
        async with self._lock:
            await self._ensure_started()

            current_url = self._page.url

            plan_resp = await openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You control a Playwright browser. Convert the user's command into a "
                            "Python async code snippet using `page` (already defined). "
                            "Available helpers: page.goto(url), page.click(selector), "
                            "page.fill(selector, text), page.keyboard.press(key), "
                            "page.wait_for_load_state('networkidle'). "
                            "Output ONLY valid Python code, no markdown fences, no explanation. "
                            "Keep it under 20 lines. Use try/except for robustness. "
                            "Do not import anything — only use `page` and `asyncio`."
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Current URL: {current_url}\nCommand: {command}",
                    },
                ],
                temperature=0,
            )
            code = plan_resp.choices[0].message.content.strip()
            # Strip possible markdown fences if model disobeys
            if code.startswith("```"):
                code = "\n".join(
                    line for line in code.splitlines()
                    if not line.startswith("```")
                )

            print(f"DEBUG browser: executing:\n{code}")

            exec_error = None
            try:
                exec_globals = {"page": self._page, "asyncio": asyncio}
                exec(f"async def _cmd(page, asyncio):\n" + "\n".join(f"    {l}" for l in code.splitlines()), exec_globals)
                await exec_globals["_cmd"](self._page, asyncio)
            except Exception as e:
                exec_error = str(e)
                print(f"DEBUG browser exec error: {e}")

            await asyncio.sleep(0.5)  # let page settle before screenshot

            screenshot_bytes = await self._page.screenshot(type="png", full_page=False)
            screenshot_b64 = base64.b64encode(screenshot_bytes).decode()

            new_url = self._page.url
            page_title = await self._page.title()

            return {
                "success": exec_error is None,
                "error": exec_error,
                "url": new_url,
                "title": page_title,
                "screenshot_b64": screenshot_b64,
            }

    async def close(self):
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None


# Module-level singleton — shared across all pipeline runs
browser_controller = BrowserController()
