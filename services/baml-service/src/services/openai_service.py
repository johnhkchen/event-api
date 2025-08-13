import asyncio
import json
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import openai
from src.core.exceptions import OpenAIServiceError
from src.core.logging import get_logger

logger = get_logger(__name__)

# Retry configuration for OpenAI API calls
def get_openai_retry_config():
    return {
        "retry": retry_if_exception_type((
            openai.RateLimitError,
            openai.APITimeoutError,
            openai.APIConnectionError,
            openai.InternalServerError
        )),
        "stop": stop_after_attempt(3),
        "wait": wait_exponential(multiplier=1, min=4, max=10),
        "reraise": True
    }

class OpenAIService:
    def __init__(self, api_key: str, model: str = "gpt-4", max_retries: int = 3):
        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model
        self.max_retries = max_retries
        
    @retry(**get_openai_retry_config())
    async def extract_content(
        self, 
        html_content: str, 
        extraction_prompt: str,
        temperature: float = 0.1
    ) -> Dict[str, Any]:
        """Extract structured content from HTML using OpenAI Chat Completion"""
        try:
            logger.info(f"Starting OpenAI extraction with model: {self.model}")
            
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": extraction_prompt
                    },
                    {
                        "role": "user", 
                        "content": f"Extract structured data from this HTML:\n\n{html_content}"
                    }
                ],
                temperature=temperature,
                response_format={"type": "json_object"}
            )
            
            result = {
                "extracted_data": response.choices[0].message.content,
                "model": response.model,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                }
            }
            
            logger.info(f"OpenAI extraction completed. Tokens used: {result['usage']['total_tokens']}")
            return result
            
        except Exception as e:
            logger.error(f"OpenAI extraction failed: {str(e)}")
            raise OpenAIServiceError(f"Content extraction failed: {str(e)}")
    
    @retry(**get_openai_retry_config())
    async def generate_embedding(self, text: str, model: str = "text-embedding-3-small") -> List[float]:
        """Generate embeddings for semantic search"""
        try:
            logger.info(f"Generating embedding with model: {model}")
            
            response = await self.client.embeddings.create(
                model=model,
                input=text
            )
            
            embedding = response.data[0].embedding
            logger.info(f"Generated embedding with {len(embedding)} dimensions")
            
            return embedding
            
        except Exception as e:
            logger.error(f"Embedding generation failed: {str(e)}")
            raise OpenAIServiceError(f"Embedding generation failed: {str(e)}")
    
    async def batch_generate_embeddings(
        self, 
        texts: List[str], 
        model: str = "text-embedding-3-small",
        batch_size: int = 100
    ) -> List[List[float]]:
        """Generate embeddings in batches for efficiency"""
        embeddings = []
        
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i+batch_size]
            
            try:
                logger.info(f"Processing embedding batch {i//batch_size + 1}, size: {len(batch)}")
                
                response = await self.client.embeddings.create(
                    model=model,
                    input=batch
                )
                
                batch_embeddings = [data.embedding for data in response.data]
                embeddings.extend(batch_embeddings)
                
                # Rate limiting - avoid overwhelming the API
                if i + batch_size < len(texts):
                    await asyncio.sleep(0.1)
                    
            except Exception as e:
                logger.error(f"Batch embedding generation failed at batch {i//batch_size + 1}: {str(e)}")
                raise OpenAIServiceError(f"Batch embedding generation failed: {str(e)}")
        
        logger.info(f"Completed batch embedding generation for {len(texts)} texts")
        return embeddings