import os
import json
import logging
from typing import List, Dict, Optional

# Gemini
from google import genai
from google.genai import types

# Groq
try:
    from groq import Groq
except ImportError:
    Groq = None

logger = logging.getLogger(__name__)

# --- Configs ---
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini").lower()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

_gemini_client = None
_groq_client = None


def _get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        _gemini_client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
    return _gemini_client


def _get_groq_client():
    global _groq_client
    if _groq_client is None:
        _groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    return _groq_client


SYSTEM_PROMPT = """You are Intercom, an AI assistant that helps users understand and interact with web pages.

You have access to content from the current web page. Use this context to answer questions accurately.

When the user asks you to perform a browser action, respond with a JSON object:
{
  "answer": "Your text response to the user",
  "actions": [
    { "type": "action_type", "selector": "css_selector", "text": "value" }
  ]
}

If no action is needed, respond with:
{
  "answer": "Your text response to the user",
  "actions": []
}

Available actions:
- navigate: { "type": "navigate", "url": "https://example.com/page" }
- scroll_to: { "type": "scroll_to", "selector": "css selector string" }
- highlight: { "type": "highlight", "text": "text to find and highlight on page" }
- click: { "type": "click", "selector": "css selector string" }
- type_text: { "type": "type_text", "selector": "css selector string", "text": "text to type into input" }

IMPORTANT: Always respond with valid JSON in the format above. You can return multiple actions in the array to perform sequences (like typing into two fields then clicking a button). Nothing else outside the JSON."""


def chat(context_chunks: List[str], message: str, conversation_history: Optional[List[Dict]] = None) -> Dict:
    """Send a RAG-augmented message to the chosen LLM and parse the response."""
    # Build context from retrieved chunks
    context = "\n\n---\n\n".join(context_chunks) if context_chunks else "No page context available."

    user_message = f"""Here is the relevant content from the current web page:

{context}

---

User question: {message}"""

    if LLM_PROVIDER == "groq":
        if not Groq:
            raise RuntimeError("groq package is not installed. Run `pip install groq`")
        logger.info(f"Using Groq model: {GROQ_MODEL}")
        return _chat_groq(user_message, conversation_history)
    else:
        logger.info(f"Using Gemini model: {GEMINI_MODEL}")
        return _chat_gemini(user_message, conversation_history)


def _chat_gemini(user_message: str, conversation_history: Optional[List[Dict]] = None) -> Dict:
    """Gemini specific chat wrapper"""
    contents = []

    if conversation_history:
        for msg in conversation_history:
            role = "user" if msg["role"] == "user" else "model"
            contents.append(
                types.Content(role=role, parts=[types.Part(text=msg["content"])])
            )

    contents.append(
        types.Content(role="user", parts=[types.Part(text=user_message)])
    )

    response = _get_gemini_client().models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.7,
            response_mime_type="application/json",
        ),
    )

    return _parse_response(response.text)


def _chat_groq(user_message: str, conversation_history: Optional[List[Dict]] = None) -> Dict:
    """Groq specific chat wrapper"""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    if conversation_history:
        for msg in conversation_history:
            role = "user" if msg["role"] == "user" else "assistant"
            messages.append({"role": role, "content": msg["content"]})

    messages.append({"role": "user", "content": user_message})

    completion = _get_groq_client().chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=0.7,
        response_format={"type": "json_object"},
    )

    return _parse_response(completion.choices[0].message.content)


def _parse_response(response_text: str) -> Dict:
    """Safely extract JSON block from text."""
    if not response_text:
        return {"answer": "Error: Empty response from model.", "action": None}

    response_text = response_text.strip()
    import re
    try:
        # Find the first { and last } to extract pure JSON block
        json_match = re.search(r'(\{.*\})', response_text, re.DOTALL)
        if json_match:
            parsed = json.loads(json_match.group(1))
            return {
                "answer": parsed.get("answer", response_text),
                "actions": parsed.get("actions", []),
            }
        
        # Fallback if no {} block found
        parsed = json.loads(response_text)
        return {
            "answer": parsed.get("answer", response_text),
            "actions": parsed.get("actions", []),
        }
    except (json.JSONDecodeError, AttributeError):
        # If not JSON, treat entire response as plain answer
        return {
            "answer": response_text,
            "actions": [],
        }
