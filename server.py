import os
from pathlib import Path
from mcp.server.fastmcp import FastMCP
from openai import OpenAI

# Configuration
COMPANY_NAME = "NexusFlow"
KNOWLEDGE_BASE_DIR = "knowledge_base"
COMPANY_INFO_FILENAME = "companyinfo"
POLICY_FILENAME = "policy"

# Initialize FastMCP and OpenAI
mcp = FastMCP("Company-Knowledge-Relay")
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _get_company_base_path() -> Path:
    """
    Gets the base path for the company's knowledge base folder.
    This enforces that all files are loaded from a single company folder.
    
    Returns:
        Path object pointing to knowledge_base/{COMPANY_NAME}/
        
    Raises:
        ValueError: If COMPANY_NAME is not set or invalid
    """
    if not COMPANY_NAME:
        raise ValueError("COMPANY_NAME must be set")
    
    base_path = Path(KNOWLEDGE_BASE_DIR) / COMPANY_NAME
    
    # Ensure the directory exists
    base_path.mkdir(parents=True, exist_ok=True)
    
    return base_path


def _get_company_file_path(filename: str) -> Path:
    """
    Gets the full path to a file in the company's knowledge base folder.
    This enforces that files are only loaded from the designated company folder.
    
    Args:
        filename: Name of the file (e.g., "companyinfo", "policy")
        
    Returns:
        Path object to the file in the company's knowledge base folder
    """
    return _get_company_base_path() / filename

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
    Loads the policy file from the company's knowledge base folder and returns its content.
    This function enforces loading only from knowledge_base/{COMPANY_NAME}/policy.
    """
    try:
        policy_path = _get_company_file_path(POLICY_FILENAME)
        content = _read_file(str(policy_path))
        return f"File loaded successfully from {policy_path}. Content:\n\n{content}"
    except FileNotFoundError:
        policy_path = _get_company_file_path(POLICY_FILENAME)
        return f"Error: The file '{policy_path}' was not found. It will be created when you save content."
    except Exception as e:
        return f"Error loading file: {str(e)}"


@mcp.tool()
async def save_file(content: str) -> str:
    """
    Saves content to the policy file in the company's knowledge base folder.
    This function enforces saving only to knowledge_base/{COMPANY_NAME}/policy.
    
    Args:
        content: The content to save to the policy file.
    """
    try:
        policy_path = _get_company_file_path(POLICY_FILENAME)
        with open(policy_path, "w", encoding='utf-8') as f:
            f.write(content)
        return f"File saved successfully to '{policy_path}'."
    except Exception as e:
        return f"Error saving file: {str(e)}"


@mcp.tool()
async def ask_chatgpt(question: str) -> str:
    """
    Answers questions using the 'companyinfo' file from the company's knowledge base folder.
    After getting the answer, it sanitizes the response using the policy file 
    from the same folder to remove any information that violates the policy.
    
    This function enforces loading files only from knowledge_base/{COMPANY_NAME}/.
    
    Args:
        question: The question to ask about the company
        
    Returns:
        Sanitized answer that complies with the privacy policy
    """
    # Load company information from the company's knowledge base folder
    try:
        company_info_path = _get_company_file_path(COMPANY_INFO_FILENAME)
        context_data = _read_file(str(company_info_path))
    except FileNotFoundError:
        company_info_path = _get_company_file_path(COMPANY_INFO_FILENAME)
        return f"Error: The file '{company_info_path}' was not found in the knowledge base folder."
    except Exception as e:
        return f"Error reading company file: {str(e)}"

    # Get initial answer
    try:
        initial_answer = _get_initial_answer(question, context_data)
    except Exception as e:
        return f"OpenAI API Error (initial answer): {str(e)}"

    # Load policy for sanitization from the company's knowledge base folder
    try:
        policy_path = _get_company_file_path(POLICY_FILENAME)
        policy_content = _read_file(str(policy_path), encoding='utf-8')
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
