from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import uvicorn
import traceback
import uuid
from src.api.v1.api import api_router
from src.core.config import get_settings
from src.core.logging import setup_logging, get_logger
from src.core.exceptions import BAMLServiceError, ValidationError, RateLimitError

# Setup logging first
setup_logging()
logger = get_logger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("BAML Service starting up...")
    settings = get_settings()
    logger.info(f"Service configuration loaded. Debug mode: {settings.DEBUG}")
    
    # Validate OpenAI connection on startup
    try:
        from src.api.dependencies import get_openai_service
        openai_service = get_openai_service(settings)
        # Test connection
        models = await openai_service.client.models.list()
        logger.info(f"OpenAI connection verified. Available models: {len(models.data)}")
    except Exception as e:
        logger.warning(f"OpenAI connection check failed: {e}")
    
    yield
    
    # Shutdown
    logger.info("BAML Service shutting down...")

def create_application() -> FastAPI:
    """Application factory"""
    settings = get_settings()
    
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.VERSION,
        description="AI-powered HTML content extraction service for event data processing",
        debug=settings.DEBUG,
        lifespan=lifespan
    )
    
    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["*"],
    )
    
    # Global exception handlers
    @app.exception_handler(ValidationError)
    async def validation_error_handler(request: Request, exc: ValidationError):
        logger.error(f"Validation error: {exc.message}")
        return JSONResponse(
            status_code=422,
            content={
                'success': False,
                'error': exc.message,
                'error_code': exc.error_code,
                'details': exc.details
            }
        )
    
    @app.exception_handler(RateLimitError)
    async def rate_limit_error_handler(request: Request, exc: RateLimitError):
        logger.error(f"Rate limit error: {exc.message}")
        return JSONResponse(
            status_code=429,
            content={
                'success': False,
                'error': exc.message,
                'error_code': exc.error_code,
                'retry_after': exc.details.get('retry_after')
            },
            headers={'Retry-After': str(exc.details.get('retry_after', 60))}
        )
    
    @app.exception_handler(BAMLServiceError)
    async def baml_service_error_handler(request: Request, exc: BAMLServiceError):
        logger.error(f"BAML service error: {exc.message}")
        return JSONResponse(
            status_code=400,
            content={
                'success': False,
                'error': exc.message,
                'error_code': exc.error_code,
                'details': exc.details
            }
        )
    
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                'success': False,
                'error': exc.detail,
                'error_code': 'HTTP_ERROR'
            }
        )
    
    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        correlation_id = str(uuid.uuid4())
        logger.error(
            f"Unexpected error: {str(exc)}",
            extra={
                'correlation_id': correlation_id,
                'traceback': traceback.format_exc(),
                'path': str(request.url),
                'method': request.method
            }
        )
        
        return JSONResponse(
            status_code=500,
            content={
                'success': False,
                'error': 'Internal server error',
                'correlation_id': correlation_id
            }
        )
    
    # Include API routers
    app.include_router(api_router, prefix="/api/v1")
    
    # Root endpoint
    @app.get("/")
    async def root():
        return {
            "service": settings.APP_NAME,
            "version": settings.VERSION,
            "status": "running",
            "docs_url": "/docs",
            "health_url": "/api/v1/health"
        }
    
    return app

# Create app instance
app = create_application()

if __name__ == "__main__":
    settings = get_settings()
    
    logger.info(f"Starting BAML service on {settings.HOST}:{settings.PORT}")
    
    uvicorn.run(
        "src.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_config=None,  # We handle logging ourselves
        access_log=False
    )