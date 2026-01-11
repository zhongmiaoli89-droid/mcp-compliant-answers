from flask import Flask, render_template, request, jsonify, redirect, url_for
import os
from pathlib import Path

app = Flask(__name__)

# Configuration
KNOWLEDGE_BASE_DIR = "knowledge_base"
POLICY_FILENAME = "policy"
COMPANY_INFO_FILENAME = "companyinfo"


def _get_companies() -> list[str]:
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
        filename: Name of the file (e.g., "policy", "companyinfo")
        
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

@app.route('/')
def index():
    """Main page to view and edit the policy file."""
    return render_template('index.html')


@app.route('/api/companies', methods=['GET'])
def get_companies():
    """API endpoint to get the list of available companies."""
    try:
        companies = _get_companies()
        return jsonify({"success": True, "companies": companies})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/policy', methods=['GET'])
def get_policy():
    """API endpoint to get the policy file content from the specified company's knowledge base folder."""
    try:
        company_name = request.args.get('company')
        if not company_name:
            return jsonify({"success": False, "error": "Company name is required"}), 400
        
        policy_path = _get_company_file_path(company_name, POLICY_FILENAME)
        if policy_path.exists():
            with open(policy_path, "r", encoding='utf-8') as f:
                content = f.read()
            return jsonify({"success": True, "content": content, "company": company_name})
        else:
            return jsonify({"success": True, "content": "", "company": company_name})
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/policy', methods=['POST'])
def save_policy():
    """API endpoint to save the policy file content to the specified company's knowledge base folder."""
    try:
        data = request.get_json()
        company_name = data.get('company')
        content = data.get('content', '')
        
        if not company_name:
            return jsonify({"success": False, "error": "Company name is required"}), 400
        
        policy_path = _get_company_file_path(company_name, POLICY_FILENAME)
        with open(policy_path, "w", encoding='utf-8') as f:
            f.write(content)
        
        return jsonify({"success": True, "message": f"Policy file saved successfully to {policy_path}."})
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    # Create templates directory if it doesn't exist
    os.makedirs('templates', exist_ok=True)
    app.run(debug=True, port=5000)

