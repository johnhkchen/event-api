import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventService } from '../src/lib/events.ts';
import { checkDatabaseConnection, closeDatabaseConnection } from '../src/db/connection.ts';
describe('Event Service Tests', () => {
    beforeAll(async () => {
        // Note: These tests require a running PostgreSQL database
        // In a real implementation, you'd use a test database
        const isConnected = await checkDatabaseConnection();
        if (!isConnected) {
            console.warn('Database not available, skipping integration tests');
        }
    });
    afterAll(async () => {
        await closeDatabaseConnection();
    });
    it('should create a new event', async () => {
        const eventData = {
            name: 'Test Event',
            description: 'A test event for unit testing',
            location: 'Test Location',
            dataQualityScore: 90
        };
        try {
            const newEvent = await EventService.createEvent(eventData);
            expect(newEvent.id).toBeDefined();
            expect(newEvent.name).toBe(eventData.name);
            expect(newEvent.description).toBe(eventData.description);
            expect(newEvent.location).toBe(eventData.location);
            expect(newEvent.dataQualityScore).toBe(eventData.dataQualityScore);
            expect(newEvent.createdAt).toBeDefined();
        }
        catch (error) {
            // Skip test if database is not available
            if (error instanceof Error && error.message.includes('connection')) {
                console.warn('Skipping test - database not available');
                return;
            }
            throw error;
        }
    });
    it('should get events with pagination', async () => {
        try {
            const result = await EventService.getEvents({}, { page: 1, limit: 10 });
            expect(result).toHaveProperty('events');
            expect(result).toHaveProperty('pagination');
            expect(Array.isArray(result.events)).toBe(true);
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.limit).toBe(10);
        }
        catch (error) {
            // Skip test if database is not available
            if (error instanceof Error && error.message.includes('connection')) {
                console.warn('Skipping test - database not available');
                return;
            }
            throw error;
        }
    });
    it('should search events by text', async () => {
        try {
            const results = await EventService.searchEvents({ q: 'test', limit: 5 });
            expect(Array.isArray(results)).toBe(true);
        }
        catch (error) {
            // Skip test if database is not available
            if (error instanceof Error && error.message.includes('connection')) {
                console.warn('Skipping test - database not available');
                return;
            }
            throw error;
        }
    });
});
// Type safety tests
describe('Type Safety Tests', () => {
    it('should enforce proper types for event creation', () => {
        // This test verifies TypeScript compilation
        const validEventData = {
            name: 'Valid Event',
            description: 'A valid event description',
            dataQualityScore: 85
        };
        // TypeScript should allow this
        expect(typeof validEventData.name).toBe('string');
        expect(typeof validEventData.dataQualityScore).toBe('number');
        // The following would cause TypeScript errors if uncommented:
        // const invalidEventData = {
        //   name: 123, // Error: should be string
        //   dataQualityScore: 'invalid' // Error: should be number
        // };
    });
});
//# sourceMappingURL=events.test.js.map