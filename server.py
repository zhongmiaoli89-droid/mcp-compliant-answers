import os
from mcp.server.fastmcp import FastMCP
from openai import OpenAI

# 1. Initialize FastMCP and OpenAI
mcp = FastMCP("Company-Knowledge-Relay")
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Hardcoded path for now
COMPANY_FILE = "companyinfo"
POLICY_FILE = "policy"

# Helper functions
def _read_file(filepath: str, encoding: str = 'utf-8') -> str:
    """
    Helper function to read a file.
    
    Args:
        filepath: Path to the file to read
        encoding: File encoding (default: utf-8)
        
    Returns:
        File content as string
        
    Raises:
        FileNotFoundError: If file doesn't exist
        IOError: If file cannot be read
    """
    with open(filepath, "r", encoding=encoding) as f:
        return f.read()


def _create_answer_system_prompt(context_data: str) -> str:
    """
    Creates the system prompt for generating initial answers based on company info.
    
    Args:
        context_data: Company information content
        
    Returns:
        System prompt string
    """
    return f"""You are an authorized question Assistant. 
Below is the internal documentation for a topic.

### INTERNAL DOCUMENTATION:
{context_data}
### END OF DOCUMENTATION

INSTRUCTIONS:
1. Answer the user's question using ONLY the documentation provided above.
2. If the documentation does not contain the answer, say: "I'm sorry, that information is not available in our current document."
3. Do not mention that you are an AI or that you are reading from a text block.
4. Be professional and concise."""


def _create_sanitization_prompts(policy_content: str, initial_answer: str) -> tuple[str, str]:
    """
    Creates system and user prompts for sanitizing answers based on policy.
    
    Args:
        policy_content: Privacy policy content
        initial_answer: The initial answer to be sanitized
        
    Returns:
        Tuple of (system_prompt, user_prompt)
    """
    system_prompt = f"""You are a privacy and compliance officer. Your task is to review an answer and remove any information that violates the provided privacy policy.

### PRIVACY POLICY:
{policy_content}
### END OF POLICY

Review the answer below and remove or redact any information that violates the policy rules, including:
- Personal identifiers (names, usernames, IDs)
- Contact information (emails, phone numbers, addresses)
- Authentication data (passwords, API keys, tokens)
- Financial information (card numbers, account numbers)
- Health records
- Any other sensitive information listed in the policy

If information needs to be removed, replace it with appropriate placeholders (e.g., "Person_A", "redacted@example.com", "***-***-****").

Maintain the structure and readability of the answer while ensuring full policy compliance."""

    user_prompt = f"""Please sanitize the following answer according to the privacy policy:

### ORIGINAL ANSWER:
{initial_answer}
### END OF ANSWER

Return only the sanitized version of the answer, with all policy violations removed or redacted."""

    return system_prompt, user_prompt


def _call_openai(system_prompt: str, user_prompt: str, temperature: float = 0) -> str:
    """
    Makes a call to OpenAI API with given prompts.
    
    Args:
        system_prompt: System prompt for the API call
        user_prompt: User prompt for the API call
        temperature: Temperature setting for the API call (default: 0)
        
    Returns:
        Response content from OpenAI
        
    Raises:
        Exception: If API call fails
    """
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=temperature
    )
    return response.choices[0].message.content


def _get_initial_answer(question: str, context_data: str) -> str:
    """
    Gets the initial answer from OpenAI based on company info and question.
    
    Args:
        question: User's question
        context_data: Company information content
        
    Returns:
        Initial answer from OpenAI
    """
    system_prompt = _create_answer_system_prompt(context_data)
    return _call_openai(system_prompt, question, temperature=0)


def _sanitize_answer(initial_answer: str, policy_content: str) -> str:
    """
    Sanitizes an answer by removing policy violations using OpenAI.
    
    Args:
        initial_answer: The answer to be sanitized
        policy_content: Privacy policy content
        
    Returns:
        Sanitized answer
    """
    system_prompt, user_prompt = _create_sanitization_prompts(policy_content, initial_answer)
    return _call_openai(system_prompt, user_prompt, temperature=0)


# MCP Tool functions
@mcp.tool()
async def load_file() -> str:
    """
    Loads the policy file and returns its content.
    """
    try:
        content = _read_file(POLICY_FILE)
        return f"File loaded successfully. Content:\n\n{content}"
    except FileNotFoundError:
        return f"Error: The file '{POLICY_FILE}' was not found. It will be created when you save content."
    except Exception as e:
        return f"Error loading file: {str(e)}"


@mcp.tool()
async def save_file(content: str) -> str:
    """
    Saves content to the policy file.
    
    Args:
        content: The content to save to the policy file.
    """
    try:
        with open(POLICY_FILE, "w", encoding='utf-8') as f:
            f.write(content)
        return f"File saved successfully to '{POLICY_FILE}'."
    except Exception as e:
        return f"Error saving file: {str(e)}"


@mcp.tool()
async def ask_chatgpt(question: str) -> str:
    """
    Answers questions using the 'companyinfo' file as the source of truth.
    After getting the answer, it sanitizes the response using the policy file 
    to remove any information that violates the policy.
    
    Args:
        question: The question to ask about the company
        
    Returns:
        Sanitized answer that complies with the privacy policy
    """
    # Load company information
    try:
        context_data = _read_file(COMPANY_FILE)
    except FileNotFoundError:
        return f"Error: The file '{COMPANY_FILE}' was not found in the server directory."
    except Exception as e:
        return f"Error reading company file: {str(e)}"

    # Get initial answer
    try:
        initial_answer = _get_initial_answer(question, context_data)
    except Exception as e:
        return f"OpenAI API Error (initial answer): {str(e)}"

    # Load policy for sanitization
    try:
        policy_content = _read_file(POLICY_FILE, encoding='utf-8')
    except FileNotFoundError:
        # If policy file doesn't exist, return unsanitized answer
        return initial_answer
    except Exception as e:
        # If policy file can't be read, return unsanitized answer with warning
        return f"{initial_answer}\n\n[Warning: Could not load policy file for sanitization: {str(e)}]"

    # Sanitize the answer
    try:
        sanitized_answer = _sanitize_answer(initial_answer, policy_content)
        return sanitized_answer
    except Exception as e:
        return f"OpenAI API Error (sanitization): {str(e)}\n\nOriginal answer: {initial_answer}"

if __name__ == "__main__":
    mcp.run(transport="sse")
