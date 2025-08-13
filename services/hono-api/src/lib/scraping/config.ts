export const SCRAPING_CONFIG = {
  // Rate limiting
  MAX_REQUESTS_PER_MINUTE: 10,
  MAX_REQUESTS_PER_HOUR: 100,
  
  // Retry configuration
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY: 1000, // 1 second
  MAX_RETRY_DELAY: 30000, // 30 seconds
  BACKOFF_MULTIPLIER: 2,
  
  // Browser configuration
  NAVIGATION_TIMEOUT: 30000, // 30 seconds
  WAIT_FOR_SELECTOR_TIMEOUT: 15000, // 15 seconds
  
  // Anti-detection measures
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
  ],
  
  // Random delays between actions (milliseconds)
  MIN_ACTION_DELAY: 500,
  MAX_ACTION_DELAY: 2000,
  
  // Request headers
  DEFAULT_HEADERS: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
  }
} as const;

export const LUMA_CONFIG = {
  BASE_URL: 'https://lu.ma',
  SELECTORS: {
    eventTitle: 'h1[data-testid="event-title"], h1.text-2xl, h1.font-bold',
    eventDescription: '[data-testid="event-description"], .description, .event-description',
    eventDate: '[data-testid="event-date"], .date, .event-date, time',
    eventLocation: '[data-testid="event-location"], .location, .event-location',
    speakers: '[data-testid="speakers"], .speakers, .speaker-list',
    speakerName: '.speaker-name, [data-testid="speaker-name"]',
    speakerTitle: '.speaker-title, [data-testid="speaker-title"]',
    speakerCompany: '.speaker-company, [data-testid="speaker-company"]',
    registrationButton: '[data-testid="register"], .register-button, button[class*="register"]',
    eventStatus: '[data-testid="event-status"], .status, .event-status'
  },
  WAIT_FOR_SELECTORS: [
    'h1',
    '.event-content',
    '[data-testid="event-title"]'
  ]
} as const;