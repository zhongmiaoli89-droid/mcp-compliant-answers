import asyncio
import argparse
import sys
from mcp import ClientSession
from mcp.client.sse import sse_client

async def run_client(user_question: str):
    url = "http://localhost:8000/sse"
    
    try:
        async with sse_client(url) as (read, write):
            async with ClientSession(read, write) as session:
                # 1. Establish the connection
                await session.initialize()
                
                print(f"--- Relaying Question: {user_question} ---")
                
                # 2. Call the 'ask_chatgpt' tool on your relay server
                result = await session.call_tool("ask_chatgpt", arguments={"question": user_question})
                
                # 3. Print the relayed answer
                if result.content:
                    print(f"\nGemini's Answer:\n{result.content[0].text}")
                else:
                    print("\nNo response received from the server.")
                    
    except Exception as e:
        print(f"❌ Client Error: {e}")

if __name__ == "__main__":
    # Setup argument parsing
    parser = argparse.ArgumentParser(description="MCP Gemini Relay Client")
    parser.add_argument("question", type=str, help="The question you want to ask Gemini via the MCP relay.")
    
    args = parser.parse_args()

    # Run the async client
    asyncio.run(run_client(args.question))
