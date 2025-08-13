import asyncio
import json
import time
import uuid
from typing import Dict, Any, List, Optional
from src.services.openai_service import OpenAIService
from src.services.cache_service import CacheService
from src.services.validation_service import ConfidenceScorer
from src.utils.html_parser import HTMLProcessor
from src.schemas.extraction import ExtractedData, UsageStats
from src.core.exceptions import ContentExtractionError
from src.core.logging import get_logger

logger = get_logger(__name__)

class ExtractionResult:
    def __init__(self, extracted_data: Dict[str, Any], confidence_scores: Dict[str, float], 
                 processing_time: float, cache_hit: bool, model_used: str, usage_stats: Dict[str, Any]):
        self.extracted_data = extracted_data
        self.confidence_scores = confidence_scores
        self.processing_time = processing_time
        self.cache_hit = cache_hit
        self.model_used = model_used
        self.usage_stats = usage_stats
    
    @classmethod
    def from_cache(cls, cached_data: Dict[str, Any], cache_hit: bool = True):
        return cls(
            extracted_data=cached_data.get('extracted_data', {}),
            confidence_scores=cached_data.get('confidence_scores', {}),
            processing_time=cached_data.get('processing_time', 0),
            cache_hit=cache_hit,
            model_used=cached_data.get('model_used', 'cached'),
            usage_stats=cached_data.get('usage_stats', {})
        )
    
    def to_cache_format(self) -> Dict[str, Any]:
        return {
            'extracted_data': self.extracted_data,
            'confidence_scores': self.confidence_scores,
            'processing_time': self.processing_time,
            'model_used': self.model_used,
            'usage_stats': self.usage_stats
        }

class ExtractionService:
    def __init__(self, openai_service: OpenAIService, cache_service: CacheService, settings):
        self.openai_service = openai_service
        self.cache_service = cache_service
        self.settings = settings
        self.html_processor = HTMLProcessor()
        self.confidence_scorer = ConfidenceScorer()
        
    def get_extraction_prompt(self, extraction_type: str = "full") -> str:
        """Generate extraction prompt based on type"""
        base_prompt = """
You are an expert at extracting structured event information from HTML content.

Extract the following information and return it as valid JSON:

{
  "events": [
    {
      "title": "Event name/title",
      "description": "Event description (clean text, no HTML)",
      "date": "YYYY-MM-DD format if found",
      "time": "HH:MM format if found", 
      "location": "Event location/venue",
      "event_type": "Type of event (conference, meetup, workshop, etc.)",
      "capacity": "Maximum attendees if specified",
      "price": "Ticket price if specified",
      "registration_url": "Registration/ticket URL if different from source"
    }
  ],
  "speakers": [
    {
      "name": "Full name",
      "title": "Job title/position", 
      "company": "Company name",
      "bio": "Speaker bio/description (clean text)",
      "linkedin_url": "LinkedIn profile URL if found",
      "twitter_url": "Twitter profile URL if found",
      "website_url": "Personal website URL if found"
    }
  ],
  "companies": [
    {
      "name": "Company name",
      "description": "Company description if available",
      "industry": "Industry/sector",
      "website_url": "Company website URL",
      "relationship_type": "sponsor|host|partner|venue"
    }
  ],
  "topics": [
    "AI", "Machine Learning", "Technology", "etc."
  ],
  "metadata": {
    "page_title": "HTML page title",
    "event_platform": "luma|eventbrite|meetup|custom",
    "extraction_quality": "high|medium|low"
  }
}

Instructions:
1. Extract information accurately from the HTML content
2. Clean up text by removing HTML tags and excessive whitespace  
3. Use null/empty values for missing information rather than making assumptions
4. Focus on factual information present in the content
5. Identify the event platform type from URL patterns and HTML structure
6. For dates, use YYYY-MM-DD format
7. For times, use HH:MM format (24-hour)
8. Keep descriptions concise but informative
"""

        if extraction_type == "events_only":
            return base_prompt.replace('"speakers": [', '"speakers": [], // Skipping speakers extraction').replace('"companies": [', '"companies": [], // Skipping companies extraction')
        elif extraction_type == "speakers_only":
            return base_prompt.replace('"events": [', '"events": [], // Skipping events extraction').replace('"companies": [', '"companies": [], // Skipping companies extraction')
            
        return base_prompt

    async def extract_content(
        self,
        html_content: str,
        url: str,
        extraction_type: str = "full",
        use_cache: bool = True,
        confidence_threshold: float = 0.7
    ) -> ExtractionResult:
        """Main content extraction logic"""
        
        extraction_id = str(uuid.uuid4())
        logger.info(f"Starting extraction {extraction_id} for URL: {url}")
        
        # Generate cache key
        cache_key = self.cache_service.generate_cache_key(html_content, extraction_type)
        
        # Check cache first
        if use_cache:
            cached_result = await self.cache_service.get(cache_key)
            if cached_result:
                logger.info(f"Cache hit for extraction {extraction_id}")
                return ExtractionResult.from_cache(cached_result, cache_hit=True)
        
        # Clean and preprocess HTML
        logger.info(f"Preprocessing HTML content for extraction {extraction_id}")
        cleaned_html = self.preprocess_html(html_content)
        
        # Get extraction prompt
        prompt = self.get_extraction_prompt(extraction_type)
        
        # Call OpenAI API
        start_time = time.time()
        try:
            openai_response = await self.openai_service.extract_content(
                html_content=cleaned_html,
                extraction_prompt=prompt,
                temperature=0.1  # Low temperature for consistent extraction
            )
        except Exception as e:
            logger.error(f"OpenAI API call failed for extraction {extraction_id}: {e}")
            raise ContentExtractionError(f"OpenAI API call failed: {str(e)}")
        
        # Parse and validate response
        try:
            extracted_data = self.parse_openai_response(openai_response['extracted_data'])
        except Exception as e:
            logger.error(f"Failed to parse OpenAI response for extraction {extraction_id}: {e}")
            raise ContentExtractionError(f"Failed to parse extraction response: {str(e)}")
        
        # Apply confidence filtering
        filtered_data = self.confidence_scorer.validate_and_filter(extracted_data, confidence_threshold)
        
        # Calculate confidence scores
        confidence_scores = {
            'overall': self.confidence_scorer.calculate_overall_confidence(filtered_data),
            'events_avg': self._calculate_avg_confidence(filtered_data.get('events', [])),
            'speakers_avg': self._calculate_avg_confidence(filtered_data.get('speakers', [])),
            'companies_avg': self._calculate_avg_confidence(filtered_data.get('companies', []))
        }
        
        processing_time = time.time() - start_time
        
        # Create result object
        result = ExtractionResult(
            extracted_data=filtered_data,
            confidence_scores=confidence_scores,
            processing_time=processing_time,
            cache_hit=False,
            model_used=openai_response.get('model', 'unknown'),
            usage_stats=openai_response.get('usage', {})
        )
        
        # Cache successful results
        if use_cache and result.extracted_data:
            await self.cache_service.set(cache_key, result.to_cache_format())
        
        logger.info(f"Completed extraction {extraction_id} in {processing_time:.2f}s with {confidence_scores['overall']:.2f} confidence")
        
        return result

    def preprocess_html(self, html_content: str) -> str:
        """Preprocess HTML before sending to OpenAI"""
        
        # Clean HTML
        cleaned_html = self.html_processor.clean_html(html_content)
        
        # Extract structured data first
        structured_data = self.html_processor.extract_structured_data(html_content)
        
        # Combine structured data hints with cleaned HTML
        if structured_data:
            structured_info = self.format_structured_data_hints(structured_data)
            cleaned_html = f"{structured_info}\n\n{cleaned_html}"
        
        # Truncate if too long (OpenAI token limits)
        if len(cleaned_html) > 50000:  # Rough character limit
            cleaned_html = cleaned_html[:50000] + "\n\n[Content truncated...]"
            logger.warning("HTML content truncated due to length")
        
        return cleaned_html
    
    def format_structured_data_hints(self, structured_data: Dict[str, Any]) -> str:
        """Format structured data as hints for the AI"""
        hints = ["=== STRUCTURED DATA HINTS ==="]
        
        if 'json_ld' in structured_data:
            hints.append("JSON-LD Data:")
            for json_ld in structured_data['json_ld']:
                hints.append(json.dumps(json_ld, indent=2))
        
        if 'open_graph' in structured_data:
            hints.append("Open Graph Data:")
            for prop, value in structured_data['open_graph'].items():
                hints.append(f"{prop}: {value}")
        
        if 'microdata' in structured_data:
            hints.append("Microdata:")
            for item in structured_data['microdata']:
                hints.append(f"Type: {item['type']}")
                for prop, value in item['properties'].items():
                    hints.append(f"  {prop}: {value}")
        
        hints.append("=== END STRUCTURED DATA ===")
        return "\n".join(hints)
    
    def parse_openai_response(self, response_content: str) -> Dict[str, Any]:
        """Parse and validate OpenAI response"""
        try:
            data = json.loads(response_content)
            
            # Validate structure
            required_keys = ['events', 'speakers', 'companies', 'topics', 'metadata']
            for key in required_keys:
                if key not in data:
                    data[key] = [] if key != 'metadata' else {}
            
            return data
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse OpenAI response as JSON: {e}")
            # Attempt to fix common JSON issues
            fixed_content = self.fix_json_response(response_content)
            try:
                return json.loads(fixed_content)
            except:
                # Return empty structure if parsing fails
                return {
                    'events': [],
                    'speakers': [],
                    'companies': [],
                    'topics': [],
                    'metadata': {'extraction_quality': 'failed'}
                }
    
    def fix_json_response(self, content: str) -> str:
        """Attempt to fix common JSON formatting issues"""
        import re
        
        # Remove markdown code blocks
        content = re.sub(r'```json\s*', '', content)
        content = re.sub(r'```\s*$', '', content)
        
        # Fix trailing commas
        content = re.sub(r',(\s*[}\]])', r'\1', content)
        
        # Ensure proper JSON structure
        content = content.strip()
        if not content.startswith('{'):
            content = '{' + content
        if not content.endswith('}'):
            content = content + '}'
        
        return content

    def _calculate_avg_confidence(self, entities: List[Dict[str, Any]]) -> float:
        """Calculate average confidence for a list of entities"""
        if not entities:
            return 0.0
        
        confidences = [entity.get('confidence_score', 0.0) for entity in entities]
        return sum(confidences) / len(confidences)

    async def generate_embedding(self, text: str, model: str = "text-embedding-3-small") -> List[float]:
        """Generate embedding for text"""
        return await self.openai_service.generate_embedding(text, model)

    async def extract_batch(self, requests: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Process multiple extractions in parallel"""
        
        logger.info(f"Starting batch extraction for {len(requests)} requests")
        
        # Create tasks for parallel processing
        tasks = []
        for req in requests:
            task = self.extract_content(
                html_content=req['html_content'],
                url=req['url'],
                extraction_type=req.get('extraction_type', 'full'),
                use_cache=req.get('use_cache', True),
                confidence_threshold=req.get('confidence_threshold', 0.7)
            )
            tasks.append(task)
        
        # Execute in parallel with error handling
        results = []
        completed_tasks = await asyncio.gather(*tasks, return_exceptions=True)
        
        for i, result in enumerate(completed_tasks):
            if isinstance(result, Exception):
                logger.error(f"Batch extraction failed for request {i}: {result}")
                results.append({
                    'success': False,
                    'error': str(result),
                    'url': requests[i]['url']
                })
            else:
                results.append({
                    'success': True,
                    'extraction_data': result.extracted_data,
                    'confidence_scores': result.confidence_scores,
                    'processing_time_ms': int(result.processing_time * 1000),
                    'cache_hit': result.cache_hit,
                    'url': requests[i]['url']
                })
        
        logger.info(f"Completed batch extraction: {len([r for r in results if r['success']])} successful")
        
        return results