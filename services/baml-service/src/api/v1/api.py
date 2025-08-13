from fastapi import APIRouter
from src.api.v1.endpoints import extraction, health

api_router = APIRouter()

# Include endpoint routers
api_router.include_router(
    extraction.router,
    prefix="/extract",
    tags=["extraction"]
)

api_router.include_router(
    health.router,
    tags=["health"]
)