from pydantic import Field, field_validator
from pydantic_settings import BaseSettings
from typing import Optional, Literal, List
import os

class Settings(BaseSettings):
    # Application settings
    APP_NAME: str = "BAML Content Extraction Service"
    VERSION: str = "1.0.0"
    DEBUG: bool = Field(default=False, env="DEBUG")
    HOST: str = Field(default="0.0.0.0", env="HOST")
    PORT: int = Field(default=8080, env="PORT")
    
    # OpenAI configuration
    OPENAI_API_KEY: str = Field(..., env="OPENAI_API_KEY")
    OPENAI_MODEL: str = Field(default="gpt-4", env="OPENAI_MODEL")
    OPENAI_EMBEDDING_MODEL: str = Field(default="text-embedding-3-small", env="OPENAI_EMBEDDING_MODEL")
    OPENAI_MAX_RETRIES: int = Field(default=3, env="OPENAI_MAX_RETRIES")
    OPENAI_TIMEOUT: int = Field(default=30, env="OPENAI_TIMEOUT")
    
    # Cache configuration
    CACHE_BACKEND: Literal["memory", "redis"] = Field(default="memory", env="CACHE_BACKEND")
    CACHE_TTL: int = Field(default=3600, env="CACHE_TTL")  # 1 hour
    REDIS_URL: Optional[str] = Field(default=None, env="REDIS_URL")
    
    # Rate limiting
    RATE_LIMIT_ENABLED: bool = Field(default=True, env="RATE_LIMIT_ENABLED")
    RATE_LIMIT_REQUESTS: int = Field(default=30, env="RATE_LIMIT_REQUESTS")
    RATE_LIMIT_WINDOW: int = Field(default=60, env="RATE_LIMIT_WINDOW")  # seconds
    
    # Processing limits
    MAX_HTML_SIZE: int = Field(default=1_000_000, env="MAX_HTML_SIZE")  # 1MB
    MAX_BATCH_SIZE: int = Field(default=10, env="MAX_BATCH_SIZE")
    CONFIDENCE_THRESHOLD: float = Field(default=0.7, env="CONFIDENCE_THRESHOLD")
    
    # Logging
    LOG_LEVEL: str = Field(default="INFO", env="LOG_LEVEL")
    LOG_FORMAT: str = Field(default="json", env="LOG_FORMAT")  # json or text
    
    # Security
    ALLOWED_ORIGINS: str = Field(default="*", env="ALLOWED_ORIGINS")
    API_KEY_HEADER: str = Field(default="X-API-Key", env="API_KEY_HEADER")
    API_KEYS: Optional[str] = Field(default=None, env="API_KEYS")  # Comma-separated
    
    @field_validator('OPENAI_API_KEY')
    @classmethod
    def validate_openai_key(cls, v):
        if not v or not v.startswith('sk-'):
            raise ValueError('Invalid OpenAI API key format')
        return v
    
    @field_validator('API_KEYS')
    @classmethod
    def parse_api_keys(cls, v):
        if v:
            return [key.strip() for key in v.split(',')]
        return []
    
    @field_validator('ALLOWED_ORIGINS')
    @classmethod
    def parse_origins(cls, v):
        if v == "*":
            return ["*"]
        return [origin.strip() for origin in v.split(',')]
    
    model_config = {"env_file": ".env", "case_sensitive": True}

# Global settings instance
_settings = None

def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings