import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { LumaScraper, ScrapedEventData } from '../../lib/scraping/luma-scraper.js';
import { EthicalScrapingValidator } from '../../middleware/scraping.js';
import { 
  scrapingRateLimit, 
  batchScrapingRateLimit, 
  validateScrapeRequest, 
  logScrapeRequest 
} from '../../middleware/scraping.js';
import { db } from '../../db/connection.js';
import { events } from '../../drizzle/schema.js';
import { eq } from 'drizzle-orm';

const scrapeRoutes = new Hono();

// Validation schemas
const singleScrapeSchema = z.object({
  url: z.string().url('Invalid URL format'),
  options: z.object({
    includeRawHtml: z.boolean().optional().default(true),
    timeout: z.number().min(5000).max(60000).optional(),
    waitForSelector: z.string().optional(),
    maxRetries: z.number().min(0).max(5).optional().default(3),
    saveToDatabase: z.boolean().optional().default(true)
  }).optional().default(() => ({
    includeRawHtml: true,
    maxRetries: 3,
    saveToDatabase: true
  }))
});

const batchScrapeSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(10, 'Maximum 10 URLs per batch'),
  options: z.object({
    includeRawHtml: z.boolean().optional().default(true),
    timeout: z.number().min(5000).max(60000).optional(),
    waitForSelector: z.string().optional(),
    maxRetries: z.number().min(0).max(5).optional().default(3),
    saveToDatabase: z.boolean().optional().default(true),
    continueOnError: z.boolean().optional().default(true)
  }).optional().default(() => ({
    includeRawHtml: true,
    maxRetries: 3,
    saveToDatabase: true,
    continueOnError: true
  }))
});

// Apply middleware to all scrape routes
scrapeRoutes.use('*', logScrapeRequest);
scrapeRoutes.use('/luma', async (c, next) => {
  const contentType = c.req.header('content-type');
  
  if (!contentType || !contentType.includes('application/json')) {
    return c.json({
      success: false,
      error: 'Invalid content type',
      message: 'Content-Type must be application/json'
    }, 400);
  }

  await next();
});

scrapeRoutes.use('/luma/batch', async (c, next) => {
  const contentType = c.req.header('content-type');
  
  if (!contentType || !contentType.includes('application/json')) {
    return c.json({
      success: false,
      error: 'Invalid content type',
      message: 'Content-Type must be application/json'
    }, 400);
  }

  await next();
});

// Single URL scraping endpoint
scrapeRoutes.post('/luma', scrapingRateLimit, zValidator('json', singleScrapeSchema), async (c) => {
  const { url, options } = c.req.valid('json');
  
  try {
    // Validate ethical scraping
    const ethicalCheck = await EthicalScrapingValidator.validateRequest(url, {
      respectRobotsTxt: true
    });
    
    if (!ethicalCheck.allowed) {
      return c.json({
        success: false,
        error: 'Scraping not allowed',
        reason: ethicalCheck.reason
      }, 403);
    }

    // Check if URL already exists in database
    if (options.saveToDatabase) {
      const existingEvent = await db
        .select()
        .from(events)
        .where(eq(events.lumaUrl, url))
        .limit(1);

      if (existingEvent.length > 0) {
        return c.json({
          success: true,
          message: 'Event already exists in database',
          data: {
            eventId: existingEvent[0].id,
            scrapedAt: existingEvent[0].scrapedAt,
            cached: true
          }
        });
      }
    }

    // Perform scraping
    const scraper = new LumaScraper();
    
    try {
      const scrapedData = await scraper.scrapeEvent(url, options);
      
      // Save to database if requested
      let savedEvent = null;
      if (options.saveToDatabase) {
        savedEvent = await saveEventToDatabase(scrapedData);
      }

      await scraper.cleanup();

      return c.json({
        success: true,
        message: 'Event scraped successfully',
        data: {
          eventId: savedEvent?.id,
          ...scrapedData,
          cached: false
        }
      });

    } catch (scrapeError) {
      await scraper.cleanup();
      throw scrapeError;
    }

  } catch (error) {
    console.error('Scraping error:', error);
    
    return c.json({
      success: false,
      error: 'Scraping failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
});

// Batch URL scraping endpoint
scrapeRoutes.post('/luma/batch', batchScrapingRateLimit, zValidator('json', batchScrapeSchema), async (c) => {
  const { urls, options } = c.req.valid('json');
  
  try {
    // Validate all URLs for ethical scraping
    const ethicalChecks = await Promise.all(
      urls.map(url => EthicalScrapingValidator.validateRequest(url, {
        respectRobotsTxt: true
      }))
    );

    const disallowedUrls = urls.filter((_, index) => !ethicalChecks[index].allowed);
    if (disallowedUrls.length > 0) {
      return c.json({
        success: false,
        error: 'Some URLs not allowed for scraping',
        disallowedUrls,
        reasons: ethicalChecks
          .filter(check => !check.allowed)
          .map(check => check.reason)
      }, 403);
    }

    // Filter out existing URLs if saving to database
    let urlsToScrape = urls;
    const existingEvents: any[] = [];

    if (options.saveToDatabase) {
      const existing = await db
        .select()
        .from(events)
        .where(eq(events.lumaUrl, urls[0])); // This is a simplified check, you might want to use IN clause
      
      // For proper implementation, you'd need a more sophisticated query
      // For now, we'll check each URL individually
      const existingUrls: string[] = [];
      for (const url of urls) {
        const existingEvent = await db
          .select()
          .from(events)
          .where(eq(events.lumaUrl, url))
          .limit(1);
        
        if (existingEvent.length > 0) {
          existingUrls.push(url);
          existingEvents.push({
            url,
            eventId: existingEvent[0].id,
            scrapedAt: existingEvent[0].scrapedAt,
            cached: true
          });
        }
      }

      urlsToScrape = urls.filter(url => !existingUrls.includes(url));
    }

    // Perform batch scraping
    const scraper = new LumaScraper();
    let scrapedResults: ScrapedEventData[] = [];
    const errors: { url: string; error: string }[] = [];

    try {
      if (urlsToScrape.length > 0) {
        scrapedResults = await scraper.scrapeMultipleEvents(urlsToScrape, options);
      }

      // Save scraped results to database
      const savedEvents = [];
      if (options.saveToDatabase) {
        for (const scrapedData of scrapedResults) {
          try {
            const savedEvent = await saveEventToDatabase(scrapedData);
            savedEvents.push({
              url: scrapedData.lumaUrl,
              eventId: savedEvent.id,
              ...scrapedData,
              cached: false
            });
          } catch (saveError) {
            console.error('Error saving event:', saveError);
            errors.push({
              url: scrapedData.lumaUrl,
              error: `Save failed: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`
            });
          }
        }
      } else {
        savedEvents.push(...scrapedResults.map(data => ({
          url: data.lumaUrl,
          eventId: null,
          ...data,
          cached: false
        })));
      }

      await scraper.cleanup();

      const allResults = [...existingEvents, ...savedEvents];

      return c.json({
        success: true,
        message: `Processed ${urls.length} URLs: ${scrapedResults.length} scraped, ${existingEvents.length} cached`,
        data: {
          total: urls.length,
          scraped: scrapedResults.length,
          cached: existingEvents.length,
          errors: errors.length,
          results: allResults,
          errorDetails: errors.length > 0 ? errors : undefined
        }
      });

    } catch (scrapeError) {
      await scraper.cleanup();
      throw scrapeError;
    }

  } catch (error) {
    console.error('Batch scraping error:', error);
    
    return c.json({
      success: false,
      error: 'Batch scraping failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
});

// Get scraping status/health endpoint
scrapeRoutes.get('/health', async (c) => {
  try {
    // Check if we can connect to the scraping service
    const scraper = new LumaScraper();
    
    // Basic health check - just verify we can create a scraper instance
    await scraper.cleanup();

    return c.json({
      success: true,
      status: 'healthy',
      message: 'Scraping service is operational',
      timestamp: new Date().toISOString(),
      features: {
        singleUrlScraping: true,
        batchScraping: true,
        rateLimiting: true,
        ethicalValidation: true,
        databaseIntegration: true
      }
    });
  } catch (error) {
    return c.json({
      success: false,
      status: 'unhealthy',
      message: 'Scraping service error',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, 503);
  }
});

// Helper function to save scraped event data to database
async function saveEventToDatabase(scrapedData: ScrapedEventData) {
  try {
    const [savedEvent] = await db
      .insert(events)
      .values({
        name: scrapedData.name,
        description: scrapedData.description,
        date: scrapedData.date ? new Date(scrapedData.date).toISOString().split('T')[0] : null,
        location: scrapedData.location,
        lumaUrl: scrapedData.lumaUrl,
        rawHtml: scrapedData.rawHtml,
        extractedData: scrapedData.extractedData,
        dataQualityScore: scrapedData.dataQualityScore,
        scrapedAt: new Date(),
        createdAt: new Date()
      })
      .returning();

    return savedEvent;
  } catch (error) {
    console.error('Database save error:', error);
    throw new Error(`Failed to save to database: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export default scrapeRoutes;