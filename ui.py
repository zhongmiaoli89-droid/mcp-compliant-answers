from flask import Flask, render_template, request, jsonify, redirect, url_for
import os

app = Flask(__name__)

# Hardcoded policy file path
POLICY_FILE = "policy"

@app.route('/')
def index():
    """Main page to view and edit the policy file."""
    return render_template('index.html')

@app.route('/api/policy', methods=['GET'])
def get_policy():
    """API endpoint to get the policy file content."""
    try:
        if os.path.exists(POLICY_FILE):
            with open(POLICY_FILE, "r", encoding='utf-8') as f:
                content = f.read()
            return jsonify({"success": True, "content": content})
        else:
            return jsonify({"success": True, "content": ""})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/policy', methods=['POST'])
def save_policy():
    """API endpoint to save the policy file content."""
    try:
        data = request.get_json()
        content = data.get('content', '')
        
        with open(POLICY_FILE, "w", encoding='utf-8') as f:
            f.write(content)
        
        return jsonify({"success": True, "message": "Policy file saved successfully."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    # Create templates directory if it doesn't exist
    os.makedirs('templates', exist_ok=True)
    app.run(debug=True, port=5000)

