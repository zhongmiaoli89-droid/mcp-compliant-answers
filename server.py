import os
from mcp.server.fastmcp import FastMCP
from openai import OpenAI

# 1. Initialize FastMCP and OpenAI
mcp = FastMCP("Company-Knowledge-Relay")
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Hardcoded path for now
COMPANY_FILE = "companyinfo"

@mcp.tool()
async def ask_chatgpt(question: str) -> str:
    """
    Answers questions using the 'companyinfo' file as the source of truth.
    """
    # 2. Read the hardcoded file
    try:
        with open(COMPANY_FILE, "r") as f:
            context_data = f.read()
    except FileNotFoundError:
        return f"Error: The file '{COMPANY_FILE}' was not found in the server directory."

    # 3. The Necessary System Prompt
    # This instructs the AI to ignore outside knowledge and focus on your file.
    system_prompt = f"""
    You are an authorized question Assistant. 
    Below is the internal documentation for a topic.
    
    ### INTERNAL DOCUMENTATION:
    {context_data}
    ### END OF DOCUMENTATION

    INSTRUCTIONS:
    1. Answer the user's question using ONLY the documentation provided above.
    2. If the documentation does not contain the answer, say: "I'm sorry, that information is not available in our current document."
    3. Do not mention that you are an AI or that you are reading from a text block.
    4. Be professional and concise.
    """

    try:
        # 4. Call OpenAI with the injected context
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question}
            ],
            temperature=0  # Zero ensures the AI is factual and doesn't "guess"
        )
        return response.choices[0].message.content
        
    except Exception as e:
        return f"OpenAI API Error: {str(e)}"

if __name__ == "__main__":
    mcp.run(transport="sse")
