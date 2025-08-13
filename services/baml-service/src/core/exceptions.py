class BAMLServiceError(Exception):
    """Base exception for BAML service errors"""
    def __init__(self, message: str, error_code: str = None, details: dict = None):
        self.message = message
        self.error_code = error_code or "BAML_ERROR"
        self.details = details or {}
        super().__init__(self.message)

class ValidationError(BAMLServiceError):
    """Input validation errors"""
    def __init__(self, message: str, field: str = None, **kwargs):
        super().__init__(message, "VALIDATION_ERROR", {"field": field}, **kwargs)

class OpenAIServiceError(BAMLServiceError):
    """OpenAI API related errors"""
    def __init__(self, message: str, **kwargs):
        super().__init__(message, "OPENAI_ERROR", **kwargs)

class CacheServiceError(BAMLServiceError):
    """Cache service errors"""
    def __init__(self, message: str, **kwargs):
        super().__init__(message, "CACHE_ERROR", **kwargs)

class ContentExtractionError(BAMLServiceError):
    """Content extraction processing errors"""
    def __init__(self, message: str, **kwargs):
        super().__init__(message, "EXTRACTION_ERROR", **kwargs)

class RateLimitError(BAMLServiceError):
    """Rate limiting errors"""
    def __init__(self, message: str, retry_after: int = None, **kwargs):
        details = {"retry_after": retry_after} if retry_after else {}
        super().__init__(message, "RATE_LIMIT_ERROR", details, **kwargs)