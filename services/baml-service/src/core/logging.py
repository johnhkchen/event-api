import logging
import logging.config
import json
import sys
from datetime import datetime
from typing import Dict, Any
from pythonjsonlogger import jsonlogger
from src.core.config import get_settings

class CustomJSONFormatter(jsonlogger.JsonFormatter):
    def add_fields(self, log_record: Dict[str, Any], record: logging.LogRecord, message_dict: Dict[str, Any]):
        super().add_fields(log_record, record, message_dict)
        
        # Add custom fields
        log_record['timestamp'] = datetime.utcnow().isoformat()
        log_record['service'] = 'baml-service'
        log_record['level'] = record.levelname
        log_record['logger_name'] = record.name
        
        # Add correlation ID if available (from request context)
        if hasattr(record, 'correlation_id'):
            log_record['correlation_id'] = record.correlation_id

def setup_logging():
    """Configure logging for the application"""
    settings = get_settings()
    
    # Determine log level
    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    
    if settings.LOG_FORMAT.lower() == "json":
        # JSON logging for production
        logging_config = {
            'version': 1,
            'disable_existing_loggers': False,
            'formatters': {
                'json': {
                    '()': CustomJSONFormatter,
                    'format': '%(timestamp)s %(level)s %(name)s %(message)s'
                }
            },
            'handlers': {
                'console': {
                    'class': 'logging.StreamHandler',
                    'formatter': 'json',
                    'stream': sys.stdout
                }
            },
            'root': {
                'level': log_level,
                'handlers': ['console']
            }
        }
    else:
        # Text logging for development
        logging_config = {
            'version': 1,
            'disable_existing_loggers': False,
            'formatters': {
                'standard': {
                    'format': '%(asctime)s [%(levelname)s] %(name)s: %(message)s'
                }
            },
            'handlers': {
                'console': {
                    'class': 'logging.StreamHandler',
                    'formatter': 'standard',
                    'stream': sys.stdout
                }
            },
            'root': {
                'level': log_level,
                'handlers': ['console']
            }
        }
    
    logging.config.dictConfig(logging_config)
    
    # Set specific loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)

def get_logger(name: str) -> logging.Logger:
    """Get a logger instance"""
    return logging.getLogger(name)