from typing import Dict, List, Any
import re
from datetime import datetime
from urllib.parse import urlparse
from src.core.logging import get_logger

logger = get_logger(__name__)

class ConfidenceScorer:
    def __init__(self):
        self.email_pattern = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
        self.url_pattern = re.compile(r'https?://(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)')
        self.phone_pattern = re.compile(r'(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}')
    
    def score_event(self, event: Dict[str, Any]) -> float:
        """Calculate confidence score for an extracted event"""
        score = 0.0
        max_score = 0.0
        
        # Title presence and quality (30% weight)
        max_score += 30
        if event.get('title'):
            title = event['title'].strip()
            if len(title) > 5:
                score += 30
                # Bonus for meaningful titles
                if any(keyword in title.lower() for keyword in ['conference', 'meetup', 'workshop', 'summit', 'hackathon']):
                    score += 5
                    max_score += 5
        
        # Date validation (25% weight)
        max_score += 25
        if event.get('date'):
            try:
                datetime.strptime(event['date'], '%Y-%m-%d')
                score += 25
            except ValueError:
                score += 10  # Partial credit for date presence
        
        # Location presence (20% weight)  
        max_score += 20
        if event.get('location'):
            location = event['location'].strip()
            if len(location) > 3:
                score += 20
        
        # Description quality (15% weight)
        max_score += 15
        if event.get('description'):
            desc = event['description'].strip()
            if len(desc) > 50:
                score += 15
            elif len(desc) > 10:
                score += 8
        
        # Additional fields (10% weight)
        max_score += 10
        bonus_fields = ['time', 'event_type', 'registration_url', 'price']
        present_fields = sum(1 for field in bonus_fields if event.get(field))
        score += (present_fields / len(bonus_fields)) * 10
        
        return min(score / max_score, 1.0) if max_score > 0 else 0.0
    
    def score_speaker(self, speaker: Dict[str, Any]) -> float:
        """Calculate confidence score for an extracted speaker"""
        score = 0.0
        max_score = 100.0
        
        # Name presence and quality (35% weight)
        if speaker.get('name'):
            name = speaker['name'].strip()
            if len(name) > 3:
                score += 35
                # Bonus for full names (first + last)
                if len(name.split()) >= 2:
                    score += 5
                    max_score += 5
        
        # Title/position (25% weight)
        if speaker.get('title'):
            title = speaker['title'].strip()
            if len(title) > 3:
                score += 25
        
        # Company affiliation (20% weight)
        if speaker.get('company'):
            company = speaker['company'].strip()
            if len(company) > 2:
                score += 20
        
        # Bio/description (10% weight)
        if speaker.get('bio'):
            bio = speaker['bio'].strip()
            if len(bio) > 20:
                score += 10
            elif len(bio) > 5:
                score += 5
        
        # Social links validation (10% weight)
        social_score = 0
        social_links = ['linkedin_url', 'twitter_url', 'website_url']
        for link_field in social_links:
            if speaker.get(link_field):
                url = speaker[link_field]
                if self.url_pattern.match(url):
                    social_score += 3.33
        score += min(social_score, 10)
        
        return min(score / max_score, 1.0)
    
    def score_company(self, company: Dict[str, Any]) -> float:
        """Calculate confidence score for an extracted company"""
        score = 0.0
        max_score = 100.0
        
        # Company name (40% weight)
        if company.get('name'):
            name = company['name'].strip()
            if len(name) > 2:
                score += 40
        
        # Website URL validation (25% weight)
        if company.get('website_url'):
            url = company['website_url']
            if self.url_pattern.match(url):
                score += 25
        
        # Industry/description (20% weight)
        desc_score = 0
        if company.get('description'):
            desc_score += 10
        if company.get('industry'):
            desc_score += 10
        score += desc_score
        
        # Relationship type (15% weight)
        if company.get('relationship_type'):
            rel_type = company['relationship_type'].lower()
            if rel_type in ['sponsor', 'host', 'partner', 'venue']:
                score += 15
        
        return min(score / max_score, 1.0)
    
    def calculate_overall_confidence(self, extracted_data: Dict[str, Any]) -> float:
        """Calculate overall extraction confidence"""
        scores = []
        
        # Score each entity type
        for event in extracted_data.get('events', []):
            scores.append(self.score_event(event))
        
        for speaker in extracted_data.get('speakers', []):
            scores.append(self.score_speaker(speaker))
        
        for company in extracted_data.get('companies', []):
            scores.append(self.score_company(company))
        
        # Return average confidence if any entities found, else 0
        overall_score = sum(scores) / len(scores) if scores else 0.0
        logger.info(f"Calculated overall confidence: {overall_score:.2f} from {len(scores)} entities")
        
        return overall_score
    
    def validate_and_filter(self, extracted_data: Dict[str, Any], confidence_threshold: float = 0.7) -> Dict[str, Any]:
        """Filter extracted data based on confidence threshold"""
        filtered_data = {
            'events': [],
            'speakers': [],
            'companies': [],
            'topics': extracted_data.get('topics', []),
            'metadata': extracted_data.get('metadata', {})
        }
        
        # Filter events
        for event in extracted_data.get('events', []):
            confidence = self.score_event(event)
            if confidence >= confidence_threshold:
                event['confidence_score'] = confidence
                filtered_data['events'].append(event)
        
        # Filter speakers
        for speaker in extracted_data.get('speakers', []):
            confidence = self.score_speaker(speaker)
            if confidence >= confidence_threshold:
                speaker['confidence_score'] = confidence
                filtered_data['speakers'].append(speaker)
        
        # Filter companies
        for company in extracted_data.get('companies', []):
            confidence = self.score_company(company)
            if confidence >= confidence_threshold:
                company['confidence_score'] = confidence
                filtered_data['companies'].append(company)
        
        logger.info(f"Filtered data: {len(filtered_data['events'])} events, "
                   f"{len(filtered_data['speakers'])} speakers, "
                   f"{len(filtered_data['companies'])} companies "
                   f"(threshold: {confidence_threshold})")
        
        return filtered_data