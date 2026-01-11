import os
import re
from pathlib import Path
from typing import Optional, Tuple
from mcp.server.fastmcp import FastMCP
from openai import OpenAI
from rapidfuzz import fuzz

# Configuration
KNOWLEDGE_BASE_DIR = "knowledge_base"
COMPANY_INFO_FILENAME = "companyinfo"
POLICY_FILENAME = "policy"

# Initialize FastMCP and OpenAI
mcp = FastMCP("Company-Knowledge-Relay")
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _get_available_companies() -> list[str]:
    """
    Gets a list of available companies from the knowledge_base directory.
    
    Returns:
        List of company names (directory names in knowledge_base)
    """
    base_path = Path(KNOWLEDGE_BASE_DIR)
    if not base_path.exists():
        return []
    
    companies = []
    for item in base_path.iterdir():
        if item.is_dir():
            companies.append(item.name)
    
    return sorted(companies)


def _get_company_file_path(company_name: str, filename: str) -> Path:
    """
    Gets the full path to a file in the specified company's knowledge base folder.
    This enforces that files are only loaded from the designated company folder.
    
    Args:
        company_name: Name of the company
        filename: Name of the file (e.g., "companyinfo", "policy")
        
    Returns:
        Path object to the file in the company's knowledge base folder
        
    Raises:
        ValueError: If company_name is empty or invalid
    """
    if not company_name or not company_name.strip():
        raise ValueError("Company name cannot be empty")
    
    # Sanitize company name to prevent directory traversal
    company_name = company_name.strip()
    if "/" in company_name or "\\" in company_name or ".." in company_name:
        raise ValueError("Invalid company name")
    
    base_path = Path(KNOWLEDGE_BASE_DIR) / company_name
    base_path.mkdir(parents=True, exist_ok=True)
    return base_path / filename


def _extract_keywords(question: str) -> list[str]:
    """
    Extracts keywords from a question by removing stop words and extracting
    meaningful terms that might match company names.
    
    Args:
        question: The user's question
        
    Returns:
        List of extracted keywords
    """
    # Common stop words to filter out
    stop_words = {
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
        'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'should', 'could', 'can', 'may', 'might', 'must', 'this', 'that',
        'these', 'those', 'what', 'which', 'who', 'whom', 'whose', 'where',
        'when', 'why', 'how', 'about', 'tell', 'me', 'please', 'question',
        'info', 'information', 'company', 'companies'
    }
    
    # Convert to lowercase and split into words
    words = re.findall(r'\b[a-zA-Z]+\b', question.lower())
    
    # Filter out stop words and short words (less than 3 characters)
    keywords = [word for word in words if word not in stop_words and len(word) >= 3]
    
    # Also include the full question for matching
    keywords.append(question.lower())
    
    return keywords


def _find_best_matching_company(question: str, companies: list[str]) -> Optional[Tuple[str, float]]:
    """
    Uses fuzzy matching to find the best matching company for a given question.
    
    Args:
        question: The user's question
        companies: List of available company names
        
    Returns:
        Tuple of (company_name, confidence_score) or None if no companies available
    """
    if not companies:
        return None
    
    # Extract keywords from the question
    keywords = _extract_keywords(question)
    
    best_match = None
    best_score = 0.0
    
    # Try matching against each company name using multiple strategies
    for company in companies:
        company_lower = company.lower()
        
        # Strategy 1: Direct fuzzy match with full question
        score1 = fuzz.partial_ratio(question.lower(), company_lower)
        
        # Strategy 2: Token sort ratio (handles word order differences)
        score2 = fuzz.token_sort_ratio(question.lower(), company_lower)
        
        # Strategy 3: Check if any keyword matches the company name
        keyword_scores = [fuzz.partial_ratio(keyword, company_lower) for keyword in keywords]
        score3 = max(keyword_scores) if keyword_scores else 0
        
        # Strategy 4: Extract company name from question if it's mentioned
        # Check if company name appears as words in the question
        company_words = company_lower.replace('_', ' ').split()
        if any(word in question.lower() for word in company_words if len(word) >= 4):
            score4 = 90.0  # High score if company name words are found
        else:
            score4 = 0
        
        # Take the maximum score from all strategies
        max_score = max(score1, score2, score3, score4)
        
        if max_score > best_score:
            best_score = max_score
            best_match = company
    
    # Return match if confidence is above threshold (50%)
    if best_match and best_score >= 50:
        return (best_match, best_score)
    
    # If no good match found but companies exist, return the first one as default
    # (or you could return None to indicate no match)
    if companies:
        return (companies[0], 0.0)  # Return first company with 0 confidence
    
    return None


def _get_company_context(company_name: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Loads both companyinfo and policy files for a given company.
    
    Args:
        company_name: Name of the company
        
    Returns:
        Tuple of (company_info_content, policy_content) or (None, None) if not found
    """
    try:
        company_info_path = _get_company_file_path(company_name, COMPANY_INFO_FILENAME)
        policy_path = _get_company_file_path(company_name, POLICY_FILENAME)
        
        company_info = None
        policy = None
        
        if company_info_path.exists():
            company_info = _read_file(str(company_info_path), encoding='utf-8')
        
        if policy_path.exists():
            policy = _read_file(str(policy_path), encoding='utf-8')
        
        return (company_info, policy)
    except Exception:
        return (None, None)

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
async def load_file(company: str = "NexusFlow") -> str:
    """
    Loads the policy file from the specified company's knowledge base folder and returns its content.
    This function enforces loading only from knowledge_base/{company}/policy.
    
    Args:
        company: Name of the company (defaults to "NexusFlow")
    """
    try:
        policy_path = _get_company_file_path(company, POLICY_FILENAME)
        content = _read_file(str(policy_path))
        return f"File loaded successfully from {policy_path}. Content:\n\n{content}"
    except FileNotFoundError:
        policy_path = _get_company_file_path(company, POLICY_FILENAME)
        return f"Error: The file '{policy_path}' was not found. It will be created when you save content."
    except Exception as e:
        return f"Error loading file: {str(e)}"


@mcp.tool()
async def save_file(content: str, company: str = "NexusFlow") -> str:
    """
    Saves content to the policy file in the specified company's knowledge base folder.
    This function enforces saving only to knowledge_base/{company}/policy.
    
    Args:
        content: The content to save to the policy file.
        company: Name of the company (defaults to "NexusFlow")
    """
    try:
        policy_path = _get_company_file_path(company, POLICY_FILENAME)
        with open(policy_path, "w", encoding='utf-8') as f:
            f.write(content)
        return f"File saved successfully to '{policy_path}'."
    except Exception as e:
        return f"Error saving file: {str(e)}"


@mcp.tool()
async def ask_chatgpt(question: str) -> str:
    """
    Answers questions by automatically detecting the most relevant company using fuzzy search,
    then using that company's 'companyinfo' and 'policy' files.
    
    The function:
    1. Extracts keywords from the question
    2. Finds the best matching company from available folders using fuzzy matching
    3. Loads the company's info and policy files
    4. Answers the question using the company info
    5. Sanitizes the response using the company's policy
    
    Args:
        question: The question to ask about the company
        
    Returns:
        Sanitized answer that complies with the privacy policy
    """
    # Get available companies
    companies = _get_available_companies()
    
    if not companies:
        return "Error: No companies found in the knowledge base. Please ensure company folders exist in the knowledge_base directory."
    
    # Find the best matching company using fuzzy search
    match_result = _find_best_matching_company(question, companies)
    
    if not match_result:
        return f"Error: Could not match question to any company. Available companies: {', '.join(companies)}"
    
    matched_company, confidence_score = match_result
    
    # Load company information and policy
    company_info, policy_content = _get_company_context(matched_company)
    
    if not company_info:
        return f"Error: Company information file not found for '{matched_company}'. Available companies: {', '.join(companies)}"
    
    # Get initial answer using the matched company's info
    try:
        initial_answer = _get_initial_answer(question, company_info)
        
        # Add a note about which company was matched if confidence is low
        if confidence_score < 70:
            initial_answer = f"[Note: Matched to company '{matched_company}' with {confidence_score:.1f}% confidence]\n\n{initial_answer}"
    except Exception as e:
        return f"OpenAI API Error (initial answer): {str(e)}"
    
    # If policy file doesn't exist, return unsanitized answer with warning
    if not policy_content:
        return f"{initial_answer}\n\n[Warning: Policy file not found for '{matched_company}', answer not sanitized]"
    
    # Sanitize the answer using the company's policy
    try:
        sanitized_answer = _sanitize_answer(initial_answer, policy_content)
        return sanitized_answer
    except Exception as e:
        return f"OpenAI API Error (sanitization): {str(e)}\n\nOriginal answer: {initial_answer}"

if __name__ == "__main__":
    mcp.run(transport="sse")
