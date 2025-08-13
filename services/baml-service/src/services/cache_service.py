import hashlib
import json
import asyncio
from typing import Any, Optional, Dict
from abc import ABC, abstractmethod
from src.core.exceptions import CacheServiceError
from src.core.logging import get_logger

logger = get_logger(__name__)

class CacheBackend(ABC):
    @abstractmethod
    async def get(self, key: str) -> Optional[Any]:
        pass
    
    @abstractmethod
    async def set(self, key: str, value: Any, ttl: int = None) -> bool:
        pass
    
    @abstractmethod
    async def delete(self, key: str) -> bool:
        pass

class MemoryCache(CacheBackend):
    def __init__(self, max_size: int = 1000):
        self._cache = {}
        self._access_order = []
        self.max_size = max_size
        self._lock = asyncio.Lock()
    
    async def get(self, key: str) -> Optional[Any]:
        async with self._lock:
            if key in self._cache:
                # Check TTL
                cache_entry = self._cache[key]
                if cache_entry.get('ttl') and asyncio.get_event_loop().time() - cache_entry['created_at'] > cache_entry['ttl']:
                    # Expired
                    await self._remove_key(key)
                    return None
                
                # Update access order
                self._access_order.remove(key)
                self._access_order.append(key)
                return cache_entry['value']
        return None
    
    async def set(self, key: str, value: Any, ttl: int = None) -> bool:
        async with self._lock:
            # Evict if at capacity
            if len(self._cache) >= self.max_size and key not in self._cache:
                oldest_key = self._access_order.pop(0)
                del self._cache[oldest_key]
            
            self._cache[key] = {
                'value': value,
                'ttl': ttl,
                'created_at': asyncio.get_event_loop().time()
            }
            
            if key not in self._access_order:
                self._access_order.append(key)
            
            return True
    
    async def delete(self, key: str) -> bool:
        async with self._lock:
            return await self._remove_key(key)
    
    async def _remove_key(self, key: str) -> bool:
        if key in self._cache:
            del self._cache[key]
            if key in self._access_order:
                self._access_order.remove(key)
            return True
        return False

class RedisCache(CacheBackend):
    def __init__(self, redis_url: str):
        try:
            import redis.asyncio as redis
            self.redis = redis.from_url(redis_url)
        except ImportError:
            raise CacheServiceError("Redis not available. Install redis package.")
    
    async def get(self, key: str) -> Optional[Any]:
        try:
            value = await self.redis.get(key)
            if value:
                return json.loads(value)
            return None
        except Exception as e:
            logger.error(f"Redis get error: {e}")
            return None
    
    async def set(self, key: str, value: Any, ttl: int = None) -> bool:
        try:
            serialized = json.dumps(value, default=str)
            if ttl:
                await self.redis.setex(key, ttl, serialized)
            else:
                await self.redis.set(key, serialized)
            return True
        except Exception as e:
            logger.error(f"Redis set error: {e}")
            return False
    
    async def delete(self, key: str) -> bool:
        try:
            result = await self.redis.delete(key)
            return result > 0
        except Exception as e:
            logger.error(f"Redis delete error: {e}")
            return False

class CacheService:
    def __init__(self, backend: str = "memory", ttl: int = 3600, redis_url: str = None):
        if backend == "redis" and redis_url:
            self.backend = RedisCache(redis_url)
        else:
            self.backend = MemoryCache()
        
        self.ttl = ttl
        logger.info(f"Cache service initialized with {backend} backend")
    
    def generate_cache_key(self, html_content: str, extraction_type: str = "full") -> str:
        """Generate deterministic cache key from HTML content"""
        # Normalize HTML for consistent caching
        normalized_content = self._normalize_for_cache(html_content)
        
        # Create hash
        content_hash = hashlib.sha256(normalized_content.encode()).hexdigest()
        
        return f"extraction:{extraction_type}:{content_hash[:16]}"
    
    def _normalize_for_cache(self, html_content: str) -> str:
        """Normalize HTML content for consistent cache keys"""
        from bs4 import BeautifulSoup
        
        try:
            # Parse and normalize HTML
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Remove volatile elements that don't affect extraction
            for tag in soup(['script', 'style', 'meta']):
                tag.decompose()
            
            # Remove dynamic attributes
            for tag in soup.find_all():
                # Remove timestamp-based attributes
                volatile_attrs = ['data-timestamp', 'data-time', 'id']
                for attr in volatile_attrs:
                    if tag.has_attr(attr):
                        del tag[attr]
            
            # Normalize whitespace
            normalized = ' '.join(str(soup).split())
            return normalized
            
        except Exception as e:
            logger.warning(f"HTML normalization failed, using raw content: {e}")
            return ' '.join(html_content.split())
    
    async def get(self, key: str) -> Optional[Any]:
        """Get cached value"""
        try:
            result = await self.backend.get(key)
            if result:
                logger.info(f"Cache hit for key: {key[:20]}...")
            return result
        except Exception as e:
            logger.error(f"Cache get error for key {key}: {e}")
            return None
    
    async def set(self, key: str, value: Any, ttl: int = None) -> bool:
        """Set cached value"""
        try:
            result = await self.backend.set(key, value, ttl or self.ttl)
            if result:
                logger.info(f"Cache set for key: {key[:20]}...")
            return result
        except Exception as e:
            logger.error(f"Cache set error for key {key}: {e}")
            return False
    
    async def delete(self, key: str) -> bool:
        """Delete cached value"""
        try:
            result = await self.backend.delete(key)
            if result:
                logger.info(f"Cache deleted for key: {key[:20]}...")
            return result
        except Exception as e:
            logger.error(f"Cache delete error for key {key}: {e}")
            return False