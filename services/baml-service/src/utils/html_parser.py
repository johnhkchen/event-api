from bs4 import BeautifulSoup, Comment
from typing import Dict, Any
import re
import bleach
import json

class HTMLProcessor:
    def __init__(self):
        self.allowed_tags = [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'div', 'span', 'section', 'article',
            'ul', 'ol', 'li', 'strong', 'em', 'b', 'i',
            'a', 'img', 'time', 'address'
        ]
        self.allowed_attributes = {
            'a': ['href', 'title'],
            'img': ['src', 'alt'],
            'time': ['datetime'],
            '*': ['class', 'id', 'data-*']
        }
    
    def clean_html(self, html_content: str) -> str:
        """Clean HTML content while preserving semantic structure"""
        # Parse with BeautifulSoup
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Remove script and style tags completely
        for tag in soup(['script', 'style', 'nav', 'header', 'footer']):
            tag.decompose()
        
        # Remove comments
        for comment in soup.find_all(text=lambda text: isinstance(text, Comment)):
            comment.extract()
        
        # Clean with bleach to remove unwanted tags
        clean_html = bleach.clean(
            str(soup),
            tags=self.allowed_tags,
            attributes=self.allowed_attributes,
            strip=True
        )
        
        return self.normalize_whitespace(clean_html)
    
    def normalize_whitespace(self, text: str) -> str:
        """Normalize whitespace in HTML content"""
        # Replace multiple whitespace with single space
        text = re.sub(r'\s+', ' ', text)
        # Remove leading/trailing whitespace from lines
        text = '\n'.join(line.strip() for line in text.split('\n'))
        # Remove excessive newlines
        text = re.sub(r'\n{3,}', '\n\n', text)
        
        return text.strip()
    
    def extract_structured_data(self, html_content: str) -> Dict[str, Any]:
        """Extract structured data from HTML using semantic tags"""
        soup = BeautifulSoup(html_content, 'html.parser')
        
        structured_data = {}
        
        # Extract JSON-LD structured data
        json_ld_scripts = soup.find_all('script', type='application/ld+json')
        if json_ld_scripts:
            json_ld_data = []
            for script in json_ld_scripts:
                if script.string:
                    try:
                        data = json.loads(script.string)
                        json_ld_data.append(data)
                    except json.JSONDecodeError:
                        continue
            if json_ld_data:
                structured_data['json_ld'] = json_ld_data
        
        # Extract Open Graph meta tags
        og_tags = soup.find_all('meta', property=lambda x: x and x.startswith('og:'))
        if og_tags:
            structured_data['open_graph'] = {
                tag.get('property'): tag.get('content') 
                for tag in og_tags if tag.get('content')
            }
        
        # Extract microdata
        microdata_items = soup.find_all(attrs={'itemtype': True})
        if microdata_items:
            structured_data['microdata'] = [
                {
                    'type': item.get('itemtype'),
                    'properties': self.extract_microdata_properties(item)
                }
                for item in microdata_items
            ]
        
        return structured_data
    
    def extract_microdata_properties(self, item_element) -> Dict[str, str]:
        """Extract microdata properties from an element"""
        properties = {}
        
        for prop_element in item_element.find_all(attrs={'itemprop': True}):
            prop_name = prop_element.get('itemprop')
            
            # Get property value based on element type
            if prop_element.name == 'meta':
                prop_value = prop_element.get('content')
            elif prop_element.name in ['img', 'audio', 'embed', 'iframe', 'source', 'track', 'video']:
                prop_value = prop_element.get('src')
            elif prop_element.name in ['a', 'area', 'link']:
                prop_value = prop_element.get('href')
            elif prop_element.name in ['object']:
                prop_value = prop_element.get('data')
            elif prop_element.name == 'time':
                prop_value = prop_element.get('datetime') or prop_element.get_text(strip=True)
            else:
                prop_value = prop_element.get_text(strip=True)
            
            if prop_value:
                properties[prop_name] = prop_value
        
        return properties