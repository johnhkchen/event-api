from functools import lru_cache
from fastapi import Depends
from src.services.openai_service import OpenAIService
from src.services.extraction_service import ExtractionService
from src.services.cache_service import CacheService
from src.core.config import get_settings, Settings

@lru_cache()
def get_settings() -> Settings:
    return get_settings()

def get_openai_service(settings: Settings = Depends(get_settings)) -> OpenAIService:
    return OpenAIService(
        api_key=settings.OPENAI_API_KEY,
        model=settings.OPENAI_MODEL,
        max_retries=settings.OPENAI_MAX_RETRIES
    )

def get_cache_service(settings: Settings = Depends(get_settings)) -> CacheService:
    return CacheService(
        backend=settings.CACHE_BACKEND,
        ttl=settings.CACHE_TTL,
        redis_url=settings.REDIS_URL if settings.CACHE_BACKEND == "redis" else None
    )

def get_extraction_service(
    openai_service: OpenAIService = Depends(get_openai_service),
    cache_service: CacheService = Depends(get_cache_service),
    settings: Settings = Depends(get_settings)
) -> ExtractionService:
    return ExtractionService(
        openai_service=openai_service,
        cache_service=cache_service,
        settings=settings
    )