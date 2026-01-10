from flask import Flask, render_template, request, jsonify, redirect, url_for
import os
from pathlib import Path

app = Flask(__name__)

# Configuration - matches server.py
COMPANY_NAME = "NexusFlow"
KNOWLEDGE_BASE_DIR = "knowledge_base"
POLICY_FILENAME = "policy"


def _get_company_file_path(filename: str) -> Path:
    """
    Gets the full path to a file in the company's knowledge base folder.
    This enforces that files are only loaded from the designated company folder.
    
    Args:
        filename: Name of the file (e.g., "policy")
        
    Returns:
        Path object to the file in the company's knowledge base folder
    """
    base_path = Path(KNOWLEDGE_BASE_DIR) / COMPANY_NAME
    base_path.mkdir(parents=True, exist_ok=True)
    return base_path / filename

@app.route('/')
def index():
    """Main page to view and edit the policy file."""
    return render_template('index.html')

@app.route('/api/policy', methods=['GET'])
def get_policy():
    """API endpoint to get the policy file content from the company's knowledge base folder."""
    try:
        policy_path = _get_company_file_path(POLICY_FILENAME)
        if policy_path.exists():
            with open(policy_path, "r", encoding='utf-8') as f:
                content = f.read()
            return jsonify({"success": True, "content": content})
        else:
            return jsonify({"success": True, "content": ""})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/policy', methods=['POST'])
def save_policy():
    """API endpoint to save the policy file content to the company's knowledge base folder."""
    try:
        data = request.get_json()
        content = data.get('content', '')
        
        policy_path = _get_company_file_path(POLICY_FILENAME)
        with open(policy_path, "w", encoding='utf-8') as f:
            f.write(content)
        
        return jsonify({"success": True, "message": f"Policy file saved successfully to {policy_path}."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    # Create templates directory if it doesn't exist
    os.makedirs('templates', exist_ok=True)
    app.run(debug=True, port=5000)

