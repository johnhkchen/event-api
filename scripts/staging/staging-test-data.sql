-- Staging Test Data for Event API
-- This script populates the staging database with test data for development and testing

-- Insert sample events
INSERT INTO events (id, title, description, start_date, end_date, location, url, created_at, updated_at) VALUES
('550e8400-e29b-41d4-a716-446655440001', 'AI Meetup SF', 'Monthly AI and Machine Learning meetup in San Francisco', '2024-01-15 18:00:00', '2024-01-15 21:00:00', 'San Francisco, CA', 'https://example.com/ai-meetup', NOW(), NOW()),
('550e8400-e29b-41d4-a716-446655440002', 'Tech Conference 2024', 'Annual technology conference covering latest trends', '2024-02-20 09:00:00', '2024-02-22 17:00:00', 'Austin, TX', 'https://example.com/tech-conf', NOW(), NOW()),
('550e8400-e29b-41d4-a716-446655440003', 'Startup Demo Day', 'Local startup pitch competition and networking', '2024-03-10 14:00:00', '2024-03-10 18:00:00', 'New York, NY', 'https://example.com/demo-day', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert sample speakers
INSERT INTO speakers (id, name, title, company, bio, created_at, updated_at) VALUES
('660f9511-f30c-52e5-b827-557766551001', 'Dr. Jane Smith', 'AI Research Director', 'TechCorp', 'Leading expert in machine learning and neural networks', NOW(), NOW()),
('660f9511-f30c-52e5-b827-557766551002', 'John Doe', 'Startup Founder', 'InnovateNow', 'Serial entrepreneur in the tech space', NOW(), NOW()),
('660f9511-f30c-52e5-b827-557766551003', 'Sarah Johnson', 'Product Manager', 'MegaTech', 'Product strategy and user experience specialist', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert sample companies
INSERT INTO companies (id, name, description, website, created_at, updated_at) VALUES
('770fa622-041d-63f6-c938-668877662001', 'TechCorp', 'Leading technology research company', 'https://techcorp.example', NOW(), NOW()),
('770fa622-041d-63f6-c938-668877662002', 'InnovateNow', 'Early-stage startup accelerator', 'https://innovatenow.example', NOW(), NOW()),
('770fa622-041d-63f6-c938-668877662003', 'MegaTech', 'Enterprise software solutions', 'https://megatech.example', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert sample topics  
INSERT INTO topics (id, name, description, created_at, updated_at) VALUES
('880fb733-152e-74g7-d049-779988773001', 'Artificial Intelligence', 'AI, machine learning, and neural networks', NOW(), NOW()),
('880fb733-152e-74g7-d049-779988773002', 'Startups', 'Entrepreneurship and startup ecosystem', NOW(), NOW()),
('880fb733-152e-74g7-d049-779988773003', 'Product Management', 'Product strategy and development', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Test data insertion complete
SELECT 'Staging test data inserted successfully' AS status;