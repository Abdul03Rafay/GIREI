import os
import json
import requests
import re
import psutil
import subprocess
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

app = FastAPI()

# Enable CORS for Electron frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
OLLAMA_LOCAL_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "...."
# TODO: In a real app, this should be an env var.
OLLAMA_SEARCH_API_KEY = "...."
SEARCH_URL = "https://ollama.com/api/web_search"

from typing import List
from fastapi.responses import StreamingResponse

# Updated imports
from typing import List, Dict

class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    model: Optional[str] = "deepseek-r1:7b"
    # history field is deprecated/replaced by messages
    file_paths: Optional[List[str]] = []
    web_search: Optional[bool] = False
    temperature: Optional[float] = 0.7
    system_prompt: Optional[str] = None

class PullRequest(BaseModel):
    model: str

# ... (Previous Helper Functions like read_file_content remain same) ...

# Update query_ollama_stream to use /api/chat
def query_ollama_stream(messages: List[Dict[str, str]], model: str = MODEL_NAME):
    """Generator that yields chunks from Ollama Chat API."""
    try:
        url = "http://localhost:11434/api/chat"
        with requests.post(
            url,
            json={
                "model": model,
                "messages": messages,
                "stream": True,
                "options": {
                     "temperature": 0.7 
                }
            },
            stream=True,
            timeout=120
        ) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if line:
                    body = json.loads(line)
                    # /api/chat returns 'message': {'content': '...'}
                    if "message" in body:
                        content = body["message"].get("content", "")
                        if content:
                            yield content
                    # Fallback for old API just in case (though we changed endpoint)
                    elif "response" in body:
                        yield body["response"]
    except Exception as e:
        yield f"[Error: {str(e)}]"

async def chat_stream_generator(request: ChatRequest):
    current_model = request.model or MODEL_NAME
    input_messages = request.messages
    
    # Extract the last user message to append file context if needed
    last_user_msg = ""
    if input_messages and input_messages[-1]['role'] == 'user':
        last_user_msg = input_messages[-1]['content']
        # If we have file paths, append to the last user message content (in memory for this request)
        if request.file_paths:
            file_context = "\n\n[Attached Files Context]:\n"
            for path in request.file_paths:
                file_context += read_file_content(path)
            input_messages[-1]['content'] += file_context

    TODAY = "2025-12-21" # In real app use datetime.date.today()
    SYSTEM_INSTRUCTION = request.system_prompt if request.system_prompt else "You are an AI assistant."
    
    system_content = f"""{SYSTEM_INSTRUCTION}
Current Date: {TODAY}
"""

    if request.web_search:
        system_content += """
If the user asks about current events, news, prices, or weather, output:
SEARCH: <query>
Example:
User: "apple stock"
Response: SEARCH: apple stock price today
"""

    # Prepend System Message
    # Check if system message already exists? Usually client sends user/assistant.
    # We inject system message at 0.
    full_messages = [{"role": "system", "content": system_content}] + input_messages

    # 1. Stream First Response
    full_response_1 = ""
    for chunk in query_ollama_stream(full_messages, current_model):
        full_response_1 += chunk
        yield chunk

    # 2. Check for Search Command
    if request.web_search:
        cleaned_1 = clean_think_tags(full_response_1)
        search_match = re.search(r'SEARCH:\s*(.+?)(?:\n|$)', cleaned_1, re.IGNORECASE)
        
        if search_match:
            query = search_match.group(1).strip()
            yield f"\n\n🔍 **Searching for:** *{query}*...\n\n"
            search_results = perform_web_search(query)
            
            # Construct 2nd turn messages
            # We treat the first response (SEARCH: ...) as assistant output
            # Then we add a tool output or system message with results
            # Then ask model to answer.
            
            # Message history for turn 2:
            # 1. System
            # 2. History
            # 3. User (Last)
            # 4. Assistant (SEARCH: query)
            # 5. System (Results)
            
            messages_turn_2 = full_messages[:] # Copy
            messages_turn_2.append({"role": "assistant", "content": full_response_1})
            messages_turn_2.append({"role": "user", "content": f"Search Results: {search_results}\n\nAnswer the user query using these results."})
            
            yield "\n\n---\n\n"
            
            for chunk in query_ollama_stream(messages_turn_2, current_model):
                yield chunk

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    return StreamingResponse(chat_stream_generator(request), media_type="text/plain")

@app.get("/stats")
def get_stats():
    mem = psutil.virtual_memory()
    # Mocking Ollama memory for now as it's hard to isolate without process filtering
    # But we can try to find 'ollama_runner' processes
    ollama_mem_mb = 0
    for proc in psutil.process_iter(['name', 'memory_info']):
        try:
            if 'ollama' in proc.info['name'].lower():
                ollama_mem_mb += proc.info['memory_info'].rss / 1024 / 1024
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
            
    return {
        "system_memory_percent": mem.percent,
        "ollama_memory_mb": round(ollama_mem_mb, 2),
        "total_memory_gb": round(mem.total / (1024**3), 1)
    }

@app.post("/pull")
async def pull_model(request: PullRequest):
    # Stream the pull output
    def pull_generator():
        # TODO: Use subprocess to call 'ollama pull' or use requests if Ollama API supports streaming pull
        # Ollama API: POST /api/pull { "name": "..." }
        try:
            with requests.post(
                "http://localhost:11434/api/pull",
                json={"name": request.model},
                stream=True,
                timeout=None
            ) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    if line:
                        yield line + b"\n"
        except Exception as e:
            yield json.dumps({"error": str(e)}).encode() + b"\n"

    return StreamingResponse(pull_generator(), media_type="application/x-ndjson")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
