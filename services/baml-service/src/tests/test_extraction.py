import pytest
from unittest.mock import Mock, AsyncMock
from src.services.extraction_service import ExtractionService, ExtractionResult
from src.services.openai_service import OpenAIService
from src.services.cache_service import CacheService
from src.core.config import Settings

@pytest.fixture
def mock_openai_service():
    service = Mock(spec=OpenAIService)
    service.extract_content = AsyncMock()
    service.generate_embedding = AsyncMock()
    return service

@pytest.fixture
def mock_cache_service():
    service = Mock(spec=CacheService)
    service.get = AsyncMock(return_value=None)
    service.set = AsyncMock(return_value=True)
    service.generate_cache_key = Mock(return_value="test_cache_key")
    return service

@pytest.fixture
def mock_settings():
    settings = Mock(spec=Settings)
    settings.CONFIDENCE_THRESHOLD = 0.7
    settings.MAX_HTML_SIZE = 1000000
    return settings

@pytest.fixture
def extraction_service(mock_openai_service, mock_cache_service, mock_settings):
    return ExtractionService(
        openai_service=mock_openai_service,
        cache_service=mock_cache_service,
        settings=mock_settings
    )

@pytest.mark.asyncio
async def test_extract_content_success(extraction_service, mock_openai_service):
    """Test successful content extraction"""
    
    # Mock OpenAI response
    mock_openai_service.extract_content.return_value = {
        "extracted_data": '{"events": [{"title": "Test Event", "date": "2024-01-01"}], "speakers": [], "companies": [], "topics": [], "metadata": {}}',
        "model": "gpt-4",
        "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}
    }
    
    # Test extraction
    html_content = "<html><h1>Test Event</h1><p>January 1, 2024</p></html>"
    url = "https://example.com/event"
    
    result = await extraction_service.extract_content(
        html_content=html_content,
        url=url
    )
    
    # Assertions
    assert isinstance(result, ExtractionResult)
    assert not result.cache_hit
    assert result.model_used == "gpt-4"
    assert len(result.extracted_data["events"]) == 1
    assert result.extracted_data["events"][0]["title"] == "Test Event"
    assert result.confidence_scores["overall"] > 0

def test_html_preprocessing(extraction_service):
    """Test HTML preprocessing functionality"""
    
    html_content = """
    <html>
        <head><title>Test Event</title></head>
        <body>
            <script>console.log('remove me');</script>
            <h1>Event Title</h1>
            <p>Event Description</p>
        </body>
    </html>
    """
    
    processed = extraction_service.preprocess_html(html_content)
    
    # Should remove script tags and normalize whitespace
    assert "console.log" not in processed
    assert "Event Title" in processed
    assert "Event Description" in processed

def test_confidence_scoring(extraction_service):
    """Test confidence scoring for extracted entities"""
    
    # Test event scoring
    event_data = {
        "title": "AI Conference 2024",
        "description": "A comprehensive conference about artificial intelligence",
        "date": "2024-06-15",
        "location": "San Francisco, CA"
    }
    
    confidence = extraction_service.confidence_scorer.score_event(event_data)
    assert confidence > 0.8  # Should be high confidence due to complete data
    
    # Test incomplete event
    incomplete_event = {"title": "Event"}
    confidence_incomplete = extraction_service.confidence_scorer.score_event(incomplete_event)
    assert confidence_incomplete < confidence  # Should be lower than complete event