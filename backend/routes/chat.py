from typing import Optional, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.embedder import embed_texts
from services.retriever import query
from services.llm import chat

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    url: str
    message: str
    conversation_history: List[ChatMessage] = []


class ChatResponse(BaseModel):
    answer: str
    actions: List[dict] = []


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    """RAG chat: embed query, retrieve relevant chunks, call Gemini."""
    if not request.message or not request.message.strip():
        raise HTTPException(status_code=400, detail="Empty message")

    # Embed the user message
    query_embedding = embed_texts([request.message])[0]

    # Retrieve relevant chunks from ChromaDB
    context_chunks = query(request.url, query_embedding, top_k=5)

    # Get LLM response
    history = [
        {"role": msg.role, "content": msg.content}
        for msg in request.conversation_history
    ]
    result = chat(context_chunks, request.message, history)

    return ChatResponse(answer=result["answer"], actions=result.get("actions", []))
