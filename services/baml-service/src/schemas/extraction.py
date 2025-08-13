from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, validator
from datetime import datetime

class ExtractionRequest(BaseModel):
    """Request schema for HTML content extraction"""
    html_content: str = Field(..., min_length=100, description="HTML content to extract data from")
    url: str = Field(..., description="Source URL of the content")
    extraction_type: str = Field(default="full", pattern="^(full|events_only|speakers_only)$")
    priority: int = Field(default=5, ge=1, le=10, description="Processing priority (1=highest, 10=lowest)")
    use_cache: bool = Field(default=True, description="Whether to use cached results")
    confidence_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    
    @validator('html_content')
    def validate_html_content(cls, v):
        if not v.strip():
            raise ValueError('HTML content cannot be empty')
        if len(v) > 1_000_000:  # 1MB limit
            raise ValueError('HTML content too large (max 1MB)')
        return v

class ExtractedEvent(BaseModel):
    """Extracted event information"""
    title: str
    description: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    location: Optional[str] = None
    event_type: Optional[str] = None
    capacity: Optional[str] = None
    price: Optional[str] = None
    registration_url: Optional[str] = None
    confidence_score: float = Field(ge=0.0, le=1.0)

class ExtractedSpeaker(BaseModel):
    """Extracted speaker information"""
    name: str
    title: Optional[str] = None
    company: Optional[str] = None
    bio: Optional[str] = None
    linkedin_url: Optional[str] = None
    twitter_url: Optional[str] = None
    website_url: Optional[str] = None
    confidence_score: float = Field(ge=0.0, le=1.0)

class ExtractedCompany(BaseModel):
    """Extracted company information"""
    name: str
    description: Optional[str] = None
    industry: Optional[str] = None
    website_url: Optional[str] = None
    relationship_type: Optional[str] = None
    confidence_score: float = Field(ge=0.0, le=1.0)

class ExtractedData(BaseModel):
    """Structured extracted data"""
    events: List[ExtractedEvent] = Field(default_factory=list)
    speakers: List[ExtractedSpeaker] = Field(default_factory=list)
    companies: List[ExtractedCompany] = Field(default_factory=list)
    topics: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

class UsageStats(BaseModel):
    """OpenAI API usage statistics"""
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    estimated_cost_usd: Optional[float] = None

class ExtractionResponse(BaseModel):
    """Response schema for extraction results"""
    success: bool
    extraction_id: str = Field(..., description="Unique identifier for this extraction")
    source_url: str
    extracted_data: Optional[ExtractedData] = None
    confidence_scores: Dict[str, float] = Field(default_factory=dict)
    processing_time_ms: int
    cache_hit: bool = False
    model_used: str
    usage_stats: Optional[UsageStats] = None
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)

class EmbeddingRequest(BaseModel):
    """Request schema for embedding generation"""
    text: str = Field(..., min_length=1, max_length=8000)
    model: str = Field(default="text-embedding-3-small")
    
class EmbeddingResponse(BaseModel):
    """Response schema for embedding generation"""
    embedding: List[float]
    model: str
    dimensions: int
    processing_time_ms: int