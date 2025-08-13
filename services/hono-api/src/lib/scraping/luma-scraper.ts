import { Page } from 'playwright';
import { browserManager } from './browser.js';
import { RetryManager, CircuitBreaker } from './retry.js';
import { HTMLSanitizer, ContentValidator } from './sanitizer.js';
import { SCRAPING_CONFIG, LUMA_CONFIG } from './config.js';
import { v4 as uuidv4 } from 'uuid';

export interface ScrapedEventData {
  name: string;
  description?: string;
  date?: string;
  location?: string;
  lumaUrl: string;
  rawHtml: string;
  extractedData: Record<string, any>;
  speakers?: SpeakerData[];
  dataQualityScore: number;
}

export interface SpeakerData {
  name: string;
  title?: string;
  company?: string;
  bio?: string;
  avatarUrl?: string;
}

export interface ScrapeOptions {
  timeout?: number;
  waitForSelector?: string;
  includeRawHtml?: boolean;
  maxRetries?: number;
}

export class LumaScraper {
  private circuitBreaker: CircuitBreaker;
  private sessionId: string;

  constructor() {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      timeout: 60000,
      resetTimeout: 300000 // 5 minutes
    });
    this.sessionId = uuidv4();
  }

  async scrapeEvent(url: string, options: ScrapeOptions = {}): Promise<ScrapedEventData> {
    return await this.circuitBreaker.execute(async () => {
      return await RetryManager.withRetry(
        () => this.performScrape(url, options),
        { maxRetries: options.maxRetries }
      );
    });
  }

  async scrapeMultipleEvents(urls: string[], options: ScrapeOptions = {}): Promise<ScrapedEventData[]> {
    const results: ScrapedEventData[] = [];
    const errors: { url: string; error: string }[] = [];

    // Process URLs in batches to avoid overwhelming the target site
    const batchSize = 3;
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (url) => {
        try {
          return await this.scrapeEvent(url, options);
        } catch (error) {
          errors.push({ url, error: error instanceof Error ? error.message : String(error) });
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(result => result !== null) as ScrapedEventData[]);

      // Add delay between batches
      if (i + batchSize < urls.length) {
        await this.delay(2000);
      }
    }

    if (errors.length > 0) {
      console.warn('Some URLs failed to scrape:', errors);
    }

    return results;
  }

  private async performScrape(url: string, options: ScrapeOptions): Promise<ScrapedEventData> {
    if (!this.isValidLumaUrl(url)) {
      throw new Error('Invalid Luma URL provided');
    }

    let page: Page | null = null;
    
    try {
      page = await browserManager.createPage(this.sessionId);
      
      // Configure timeouts
      const timeout = options.timeout || SCRAPING_CONFIG.NAVIGATION_TIMEOUT;
      page.setDefaultTimeout(timeout);

      // Navigate to the page
      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout 
      });

      // Wait for content to load
      await this.waitForContent(page, options.waitForSelector);

      // Extract data
      const eventData = await this.extractEventData(page, url);
      
      // Get raw HTML if requested
      if (options.includeRawHtml !== false) {
        eventData.rawHtml = await page.content();
        eventData.rawHtml = HTMLSanitizer.sanitizeForStorage(eventData.rawHtml);
      }

      // Validate the scraped data
      const validation = ContentValidator.validateEventData(eventData);
      if (!validation.isValid) {
        throw new Error(`Data validation failed: ${validation.errors.join(', ')}`);
      }

      if (validation.warnings.length > 0) {
        console.warn('Data validation warnings:', validation.warnings);
      }

      return eventData;

    } catch (error) {
      console.error(`Failed to scrape ${url}:`, error);
      throw error;
    } finally {
      if (page) {
        await browserManager.closePage(page);
      }
    }
  }

  private async waitForContent(page: Page, customSelector?: string): Promise<void> {
    const selectors = customSelector ? [customSelector] : LUMA_CONFIG.WAIT_FOR_SELECTORS;
    
    try {
      // Wait for any of the expected selectors
      await Promise.race(
        selectors.map(selector => 
          page.waitForSelector(selector, { 
            timeout: SCRAPING_CONFIG.WAIT_FOR_SELECTOR_TIMEOUT 
          })
        )
      );
    } catch (error) {
      console.warn('Content selectors not found, proceeding anyway');
    }

    // Additional wait for dynamic content
    await this.delay(2000);
  }

  private async extractEventData(page: Page, url: string): Promise<ScrapedEventData> {
    const extractedData: Record<string, any> = {};
    
    // Extract basic event information
    const name = await this.extractText(page, LUMA_CONFIG.SELECTORS.eventTitle);
    const description = await this.extractText(page, LUMA_CONFIG.SELECTORS.eventDescription);
    const date = await this.extractDate(page);
    const location = await this.extractText(page, LUMA_CONFIG.SELECTORS.eventLocation);

    // Extract speakers
    const speakers = await this.extractSpeakers(page);

    // Extract additional metadata
    const metadata = await this.extractMetadata(page);
    extractedData.metadata = metadata;

    // Calculate data quality score
    const dataQualityScore = this.calculateDataQualityScore({
      name,
      description,
      date,
      location,
      speakers,
      metadata
    });

    return {
      name: name || 'Unknown Event',
      description: description || undefined,
      date: date || undefined,
      location: location || undefined,
      lumaUrl: url,
      rawHtml: '',
      extractedData,
      speakers: speakers.length > 0 ? speakers : undefined,
      dataQualityScore
    };
  }

  private async extractText(page: Page, selectors: string): Promise<string | null> {
    try {
      const selectorArray = selectors.split(', ');
      
      for (const selector of selectorArray) {
        try {
          const element = await page.$(selector.trim());
          if (element) {
            const text = await element.textContent();
            if (text && text.trim()) {
              return HTMLSanitizer.extractText(text.trim());
            }
          }
        } catch (error) {
          // Continue to next selector
        }
      }
      
      return null;
    } catch (error) {
      console.warn(`Failed to extract text with selectors "${selectors}":`, error);
      return null;
    }
  }

  private async extractDate(page: Page): Promise<string | null> {
    try {
      // Try multiple date selectors
      const dateSelectors = LUMA_CONFIG.SELECTORS.eventDate.split(', ');
      
      for (const selector of dateSelectors) {
        try {
          const element = await page.$(selector.trim());
          if (element) {
            // Try to get datetime attribute first
            const datetime = await element.getAttribute('datetime');
            if (datetime) {
              return datetime;
            }
            
            // Fall back to text content
            const text = await element.textContent();
            if (text && text.trim()) {
              return text.trim();
            }
          }
        } catch (error) {
          // Continue to next selector
        }
      }

      return null;
    } catch (error) {
      console.warn('Failed to extract date:', error);
      return null;
    }
  }

  private async extractSpeakers(page: Page): Promise<SpeakerData[]> {
    try {
      const speakers: SpeakerData[] = [];
      
      // Look for speaker containers
      const speakerElements = await page.$$(LUMA_CONFIG.SELECTORS.speakers);
      
      for (const container of speakerElements) {
        try {
          const name = await this.extractTextFromElement(container, LUMA_CONFIG.SELECTORS.speakerName);
          const title = await this.extractTextFromElement(container, LUMA_CONFIG.SELECTORS.speakerTitle);
          const company = await this.extractTextFromElement(container, LUMA_CONFIG.SELECTORS.speakerCompany);
          
          if (name) {
            speakers.push({
              name,
              title: title || undefined,
              company: company || undefined
            });
          }
        } catch (error) {
          console.warn('Error extracting speaker data:', error);
        }
      }

      return speakers;
    } catch (error) {
      console.warn('Failed to extract speakers:', error);
      return [];
    }
  }

  private async extractTextFromElement(parent: any, selector: string): Promise<string | null> {
    try {
      const element = await parent.$(selector);
      if (element) {
        const text = await element.textContent();
        return text ? text.trim() : null;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private async extractMetadata(page: Page): Promise<Record<string, any>> {
    try {
      const metadata = await page.evaluate(() => {
        const meta: Record<string, string> = {};
        
        // Extract meta tags
        document.querySelectorAll('meta').forEach(tag => {
          const name = tag.getAttribute('name') || tag.getAttribute('property');
          const content = tag.getAttribute('content');
          
          if (name && content) {
            meta[name] = content;
          }
        });

        return meta;
      });

      return metadata;
    } catch (error) {
      console.warn('Failed to extract metadata:', error);
      return {};
    }
  }

  private calculateDataQualityScore(data: any): number {
    let score = 0;
    let maxScore = 100;

    // Basic information (40 points)
    if (data.name && data.name.length > 0) score += 20;
    if (data.description && data.description.length > 50) score += 20;

    // Event details (30 points)
    if (data.date) score += 15;
    if (data.location && data.location.length > 0) score += 15;

    // Speakers (20 points)
    if (data.speakers && data.speakers.length > 0) score += 20;

    // Metadata (10 points)
    if (data.metadata && Object.keys(data.metadata).length > 0) score += 10;

    return Math.round((score / maxScore) * 100);
  }

  private isValidLumaUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'lu.ma' || parsed.hostname.endsWith('.lu.ma');
    } catch {
      return false;
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup(): Promise<void> {
    await browserManager.closeContext(this.sessionId);
  }
}