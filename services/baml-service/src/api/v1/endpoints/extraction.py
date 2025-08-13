from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from typing import List
import time
import uuid
from src.schemas.extraction import (
    ExtractionRequest, 
    ExtractionResponse, 
    EmbeddingRequest, 
    EmbeddingResponse,
    ExtractedData,
    UsageStats
)
from src.services.extraction_service import ExtractionService
from src.api.dependencies import get_extraction_service
from src.core.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)

async def log_extraction_metrics(extraction_id: str, processing_time: int, success: bool, error: str = None):
    """Background task to log metrics"""
    logger.info(f"Extraction metrics: {extraction_id}, {processing_time}ms, success: {success}")
    if error:
        logger.error(f"Extraction error for {extraction_id}: {error}")

@router.post("/extract", response_model=ExtractionResponse)
async def extract_content(
    request: ExtractionRequest,
    background_tasks: BackgroundTasks,
    extraction_service: ExtractionService = Depends(get_extraction_service)
):
    """
    Extract structured data from HTML content
    
    This endpoint processes raw HTML and extracts:
    - Event information (title, description, date, location)
    - Speaker details (name, title, company, bio)
    - Company information (name, description, industry)
    - Topic categorization and relevance scores
    """
    start_time = time.time()
    extraction_id = str(uuid.uuid4())
    
    try:
        logger.info(f"Starting extraction {extraction_id} for URL: {request.url}")
        
        # Process extraction
        result = await extraction_service.extract_content(
            html_content=request.html_content,
            url=request.url,
            extraction_type=request.extraction_type,
            use_cache=request.use_cache,
            confidence_threshold=request.confidence_threshold
        )
        
        processing_time = int((time.time() - start_time) * 1000)
        
        # Schedule background tasks for analytics/monitoring
        background_tasks.add_task(
            log_extraction_metrics,
            extraction_id=extraction_id,
            processing_time=processing_time,
            success=True
        )
        
        # Convert usage stats if available
        usage_stats = None
        if result.usage_stats:
            usage_stats = UsageStats(
                prompt_tokens=result.usage_stats.get('prompt_tokens', 0),
                completion_tokens=result.usage_stats.get('completion_tokens', 0),
                total_tokens=result.usage_stats.get('total_tokens', 0),
                estimated_cost_usd=result.usage_stats.get('estimated_cost_usd')
            )
        
        return ExtractionResponse(
            success=True,
            extraction_id=extraction_id,
            source_url=request.url,
            extracted_data=ExtractedData(**result.extracted_data) if result.extracted_data else None,
            confidence_scores=result.confidence_scores,
            processing_time_ms=processing_time,
            cache_hit=result.cache_hit,
            model_used=result.model_used,
            usage_stats=usage_stats
        )
        
    except Exception as e:
        processing_time = int((time.time() - start_time) * 1000)
        
        # Log error and schedule background task
        logger.error(f"Extraction {extraction_id} failed: {str(e)}")
        background_tasks.add_task(
            log_extraction_metrics,
            extraction_id=extraction_id,
            processing_time=processing_time,
            success=False,
            error=str(e)
        )
        
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "extraction_id": extraction_id,
                "error": str(e),
                "processing_time_ms": processing_time
            }
        )

@router.post("/extract/batch")
async def extract_batch(
    requests: List[ExtractionRequest],
    extraction_service: ExtractionService = Depends(get_extraction_service)
):
    """Process multiple extractions in parallel"""
    if len(requests) > 10:  # Limit batch size
        raise HTTPException(status_code=400, detail="Batch size limited to 10 items")
    
    logger.info(f"Processing batch extraction with {len(requests)} requests")
    
    # Process in parallel using asyncio.gather
    results = await extraction_service.extract_batch([
        {
            'html_content': req.html_content,
            'url': req.url,
            'extraction_type': req.extraction_type,
            'confidence_threshold': req.confidence_threshold,
            'use_cache': req.use_cache
        }
        for req in requests
    ])
    
    return {"results": results, "processed_count": len(results)}

@router.post("/embeddings", response_model=EmbeddingResponse)
async def generate_embedding(
    request: EmbeddingRequest,
    extraction_service: ExtractionService = Depends(get_extraction_service)
):
    """Generate text embeddings for semantic search"""
    start_time = time.time()
    
    try:
        logger.info(f"Generating embedding for text of length: {len(request.text)}")
        
        embedding = await extraction_service.generate_embedding(
            text=request.text,
            model=request.model
        )
        
        processing_time = int((time.time() - start_time) * 1000)
        
        return EmbeddingResponse(
            embedding=embedding,
            model=request.model,
            dimensions=len(embedding),
            processing_time_ms=processing_time
        )
        
    except Exception as e:
        logger.error(f"Embedding generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))