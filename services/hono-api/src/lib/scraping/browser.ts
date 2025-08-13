import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { SCRAPING_CONFIG } from './config.js';

export class BrowserManager {
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      });
    }
    return this.browser;
  }

  async createContext(sessionId: string): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const userAgent = this.getRandomUserAgent();
    
    const context = await browser.newContext({
      userAgent,
      viewport: this.getRandomViewport(),
      extraHTTPHeaders: SCRAPING_CONFIG.DEFAULT_HEADERS,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true
    });

    // Add stealth measures
    await context.addInitScript(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Mock languages and plugins
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
    });

    this.contexts.set(sessionId, context);
    return context;
  }

  async createPage(sessionId: string): Promise<Page> {
    const context = this.contexts.get(sessionId) || await this.createContext(sessionId);
    const page = await context.newPage();

    // Set additional stealth measures on page level
    await page.setExtraHTTPHeaders(SCRAPING_CONFIG.DEFAULT_HEADERS);
    
    // Add random delays to make it look more human
    await this.addRandomDelay();

    return page;
  }

  async closePage(page: Page): Promise<void> {
    try {
      await page.close();
    } catch (error) {
      console.warn('Error closing page:', error);
    }
  }

  async closeContext(sessionId: string): Promise<void> {
    const context = this.contexts.get(sessionId);
    if (context) {
      try {
        await context.close();
        this.contexts.delete(sessionId);
      } catch (error) {
        console.warn('Error closing context:', error);
      }
    }
  }

  async closeAll(): Promise<void> {
    // Close all contexts
    for (const [sessionId] of this.contexts) {
      await this.closeContext(sessionId);
    }

    // Close browser
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
      } catch (error) {
        console.warn('Error closing browser:', error);
      }
    }
  }

  private getRandomUserAgent(): string {
    const userAgents = SCRAPING_CONFIG.USER_AGENTS;
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  private getRandomViewport() {
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1536, height: 864 },
      { width: 1280, height: 720 }
    ];
    return viewports[Math.floor(Math.random() * viewports.length)];
  }

  private async addRandomDelay(): Promise<void> {
    const delay = Math.floor(
      Math.random() * (SCRAPING_CONFIG.MAX_ACTION_DELAY - SCRAPING_CONFIG.MIN_ACTION_DELAY) 
      + SCRAPING_CONFIG.MIN_ACTION_DELAY
    );
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

// Singleton instance
export const browserManager = new BrowserManager();

// Graceful shutdown
process.on('exit', () => {
  browserManager.closeAll();
});

process.on('SIGINT', () => {
  browserManager.closeAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  browserManager.closeAll();
  process.exit(0);
});