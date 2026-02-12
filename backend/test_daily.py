import os
import asyncio
import aiohttp
import time
from dotenv import load_dotenv

load_dotenv()

async def test_room_creation():
    api_key = os.getenv("DAILY_API_KEY")
    if not api_key:
        print("DAILY_API_KEY not found in .env")
        return

    print(f"Testing room creation with API key: {api_key[:10]}...")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.daily.co/v1/rooms",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"properties": {"exp": int(time.time()) + 3600}} 
            ) as resp:
                print(f"Status: {resp.status}")
                text = await resp.text()
                print(f"Response: {text}")
                if resp.status == 200:
                    print("SUCCESS: Room created!")
                else:
                    print(f"FAILED: Room creation failed with status {resp.status}")
    except Exception as e:
        print(f"ERROR: {str(e)}")

if __name__ == "__main__":
    asyncio.run(test_room_creation())
