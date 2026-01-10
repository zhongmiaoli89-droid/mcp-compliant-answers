# MCP Company Knowledge Relay

A Model Context Protocol (MCP) server that provides tools for querying company information using AI and managing policy files. Includes a web-based UI for viewing and editing policy files.

## Features

- **MCP Server**: Provides tools for AI-powered company information queries and file management
- **Web UI**: Beautiful interface for reading and updating policy files
- **File Management**: Load and save policy files through MCP tools or web interface
- **AI Integration**: Uses OpenAI GPT-4o to answer questions based on company documentation

## Prerequisites

- Python 3.8 or higher
- OpenAI API key (set as environment variable `OPENAI_API_KEY`)

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd mcp
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Set up your OpenAI API key:
   ```bash
   export OPENAI_API_KEY="your-api-key-here"
   ```
   
   Or add it to your `.env` file (if using a package like python-dotenv).

## Startup Steps

### Starting the MCP Server

The MCP server provides tools for querying company information and managing policy files. It runs on port 8000 by default using SSE (Server-Sent Events) transport.

1. Open a terminal window
2. Navigate to the project directory
3. Start the MCP server:
   ```bash
   python server.py
   ```

   The server will start and be available at `http://localhost:8000/sse`

### Starting the Web UI

The web UI provides a user-friendly interface for viewing and editing the policy file.

1. Open a **new terminal window** (keep the MCP server running in the first terminal)
2. Navigate to the project directory
3. Start the Flask web server:
   ```bash
   python ui.py
   ```

   The web UI will be available at `http://localhost:5000`

4. Open your browser and navigate to:
   ```
   http://localhost:5000
   ```

## Usage

### Using the Web UI

1. Once the UI is running, open `http://localhost:5000` in your browser
2. The policy file will automatically load when the page opens
3. Click **"Load File"** to reload the policy file from disk
4. Edit the content in the text area
5. Click **"Save File"** to save your changes
6. Status messages will appear to confirm successful operations

### Using the MCP Tools

The MCP server provides the following tools:

#### `load_file()`
Loads the policy file and returns its content.

**Example usage (via MCP client):**
```python
result = await session.call_tool("load_file", arguments={})
```

#### `save_file(content: str)`
Saves content to the policy file.

**Parameters:**
- `content` (str): The content to save to the policy file

**Example usage (via MCP client):**
```python
result = await session.call_tool("save_file", arguments={"content": "Your policy content here"})
```

#### `ask_chatgpt(question: str)`
Answers questions using the 'companyinfo' file as the source of truth. Uses OpenAI GPT-4o to provide context-aware responses.

**Parameters:**
- `question` (str): The question to ask about the company

**Example usage (via MCP client):**
```python
result = await session.call_tool("ask_chatgpt", arguments={"question": "What is the company's revenue?"})
```

### Using the Command-Line Client

You can use the provided client to query the MCP server:

```bash
python client.py "What is the company's motto?"
```

## File Structure

```
mcp/
├── server.py          # MCP server with tools for file management and AI queries
├── client.py          # Command-line client for testing MCP tools
├── ui.py              # Flask web application for policy file management
├── requirements.txt   # Python dependencies
├── companyinfo        # Company information file (used by ask_chatgpt tool)
├── policy             # Policy file (managed by load_file/save_file tools)
└── templates/
    └── index.html     # Web UI template
```

## Configuration

- **Policy File**: Hardcoded as `policy` in the project root directory
- **Company File**: Hardcoded as `companyinfo` in the project root directory
- **MCP Server Port**: 8000 (default, configured in server.py)
- **Web UI Port**: 5000 (configured in ui.py)

## API Endpoints (Web UI)

- `GET /` - Main web interface
- `GET /api/policy` - Retrieve policy file content
- `POST /api/policy` - Save policy file content (expects JSON: `{"content": "..."}`)

## Troubleshooting

### MCP Server Issues

- **Port already in use**: Make sure port 8000 is available, or modify the port in `server.py`
- **OpenAI API errors**: Verify that `OPENAI_API_KEY` environment variable is set correctly
- **File not found**: The policy file will be created automatically when you first save content

### Web UI Issues

- **Port already in use**: Make sure port 5000 is available, or modify the port in `ui.py`
- **Template not found**: Ensure the `templates/` directory exists with `index.html`
- **File read errors**: Check file permissions for the policy file

## Dependencies

- `mcp` - Model Context Protocol implementation
- `openai` - OpenAI API client
- `flask` - Web framework for the UI

See `requirements.txt` for specific versions.

## Development

The project uses:
- FastMCP for the MCP server implementation
- Flask for the web interface
- OpenAI GPT-4o for AI-powered responses

## License

[Add your license here]

>>>>>>> 31f5c31 (Add new functions)
