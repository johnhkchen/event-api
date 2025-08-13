from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Dict, Any
import time
import psutil
import asyncio
from src.services.openai_service import OpenAIService
from src.services.cache_service import CacheService
from src.api.dependencies import get_openai_service, get_cache_service
from src.core.config import get_settings
from src.core.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)

class HealthResponse(BaseModel):
    status: str
    timestamp: str
    version: str
    uptime_seconds: int
    checks: Dict[str, Any] = {}

class ServiceCheck(BaseModel):
    status: str
    response_time_ms: int
    details: Dict[str, Any] = {}

start_time = time.time()

@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Basic health check"""
    settings = get_settings()
    return HealthResponse(
        status="healthy",
        timestamp=time.strftime("%Y-%m-%d %H:%M:%S UTC"),
        version=settings.VERSION,
        uptime_seconds=int(time.time() - start_time)
    )

@router.get("/health/detailed", response_model=HealthResponse)
async def detailed_health_check(
    openai_service: OpenAIService = Depends(get_openai_service),
    cache_service: CacheService = Depends(get_cache_service)
):
    """Detailed health check including dependencies"""
    
    settings = get_settings()
    checks = {}
    overall_status = "healthy"
    
    # System metrics
    try:
        checks["system"] = ServiceCheck(
            status="healthy",
            response_time_ms=0,
            details={
                "cpu_percent": psutil.cpu_percent(),
                "memory_percent": psutil.virtual_memory().percent,
                "disk_usage_percent": psutil.disk_usage('/').percent
            }
        ).dict()
    except Exception as e:
        logger.warning(f"System metrics unavailable: {e}")
        checks["system"] = ServiceCheck(
            status="degraded",
            response_time_ms=0,
            details={"error": "System metrics unavailable"}
        ).dict()
    
    # OpenAI API check
    openai_start = time.time()
    try:
        # Test with minimal request (list models)
        models_response = await openai_service.client.models.list()
        if models_response.data:
            openai_status = "healthy"
            openai_details = {"connection": "ok", "models_available": len(models_response.data)}
        else:
            openai_status = "degraded"
            openai_details = {"connection": "ok", "models_available": 0}
            overall_status = "degraded"
    except Exception as e:
        logger.error(f"OpenAI health check failed: {e}")
        openai_status = "unhealthy"
        openai_details = {"error": str(e)}
        overall_status = "degraded"
    
    checks["openai"] = ServiceCheck(
        status=openai_status,
        response_time_ms=int((time.time() - openai_start) * 1000),
        details=openai_details
    ).dict()
    
    # Cache service check
    cache_start = time.time()
    try:
        test_key = f"health_check_test_{int(time.time())}"
        await cache_service.set(test_key, "test_value", ttl=10)
        cached_value = await cache_service.get(test_key)
        await cache_service.delete(test_key)
        
        cache_status = "healthy" if cached_value == "test_value" else "degraded"
        cache_details = {"read_write": "ok"} if cached_value == "test_value" else {"read_write": "failed"}
        
        if cache_status == "degraded" and overall_status == "healthy":
            overall_status = "degraded"
            
    except Exception as e:
        logger.error(f"Cache health check failed: {e}")
        cache_status = "degraded"
        cache_details = {"error": str(e)}
        if overall_status == "healthy":
            overall_status = "degraded"
    
    checks["cache"] = ServiceCheck(
        status=cache_status,
        response_time_ms=int((time.time() - cache_start) * 1000),
        details=cache_details
    ).dict()
    
    return HealthResponse(
        status=overall_status,
        timestamp=time.strftime("%Y-%m-%d %H:%M:%S UTC"),
        version=settings.VERSION,
        uptime_seconds=int(time.time() - start_time),
        checks=checks
    )

@router.get("/health/ready")
async def readiness_check():
    """Kubernetes readiness probe"""
    # Simple check that service can handle requests
    return {"status": "ready"}

@router.get("/health/live") 
async def liveness_check():
    """Kubernetes liveness probe"""
    # Basic liveness check
    return {"status": "alive"}