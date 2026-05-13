-- ============================================
-- LeadChat — Test Seed Data
-- Realistic Indian business names (no lorem ipsum — global rule)
-- Run: docker exec -i leadchat-postgres psql -U leadchat -d leadchat < infra/db/002_seed_test_data.sql
-- ============================================

-- Clear existing test data
TRUNCATE users CASCADE;

-- ============================================
-- BUYERS — Businesses looking for service providers
-- ============================================

INSERT INTO users (firebase_uid, role, display_name, industry, phone, email, service_type, tagline, budget_min, budget_max, ai_score, verified, profile_complete, rating, total_chats, tier)
VALUES
  ('test-buyer-001', 'buyer', 'Vikram Mehta', 'technology', '+919876543210', 'vikram@mehtaindustries.in',
   NULL, 'Looking for a reliable tech partner for our ERP migration', 100000, 300000,
   72, true, true, 4.2, 15, 'free'),

  ('test-buyer-002', 'buyer', 'Priya Sharma', 'design', '+919876543211', 'priya@sharmaretail.in',
   NULL, 'Need complete brand identity redesign for our retail chain', 50000, 150000,
   65, true, true, 3.8, 8, 'free'),

  ('test-buyer-003', 'buyer', 'Arjun Kapoor', 'marketing', '+919876543212', 'arjun@kapoorfoods.in',
   NULL, 'Launching D2C brand — need performance marketing agency', 200000, 500000,
   55, true, false, 3.5, 3, 'free'),

  ('test-buyer-004', 'buyer', 'Neha Gupta', 'finance', '+919876543213', 'neha@guptaexports.in',
   NULL, 'Looking for CA firm to handle GST compliance and audit', 80000, 200000,
   80, true, true, 4.5, 22, 'premium'),

  ('test-buyer-005', 'buyer', 'Rajesh Patel', 'technology', '+919876543214', 'rajesh@pateltextiles.in',
   NULL, 'Need mobile app for our B2B textile marketplace', 300000, 800000,
   45, true, false, 0.0, 0, 'free');

-- ============================================
-- PROVIDERS — Service providers / Freelancers
-- ============================================

INSERT INTO users (firebase_uid, role, display_name, industry, phone, email, service_type, tagline, budget_min, budget_max, ai_score, verified, profile_complete, rating, total_chats, tier)
VALUES
  ('test-provider-001', 'provider', 'TechVault Solutions', 'technology', '+919876543220', 'hello@techvault.in',
   'Full-stack Development', 'We build scalable SaaS and enterprise apps — React, Node, AWS', 80000, 200000,
   88, true, true, 4.6, 45, 'premium'),

  ('test-provider-002', 'provider', 'Riya Designs Studio', 'design', '+919876543221', 'riya@riyadesigns.in',
   'UI/UX Design', 'Award-winning UI/UX studio — Figma, prototyping, design systems', 50000, 150000,
   75, true, true, 4.3, 28, 'free'),

  ('test-provider-003', 'provider', 'GreenLeaf Digital', 'marketing', '+919876543222', 'team@greenleaf.in',
   'Performance Marketing', 'Meta & Google Ads specialists — 200+ D2C brands scaled', 100000, 400000,
   82, true, true, 4.4, 35, 'premium'),

  ('test-provider-004', 'provider', 'Sharma & Associates', 'finance', '+919876543223', 'ca@sharmaassociates.in',
   'CA & Tax Advisory', 'Chartered accountants — GST, audit, ITR for SMEs since 2005', 60000, 180000,
   90, true, true, 4.8, 60, 'premium'),

  ('test-provider-005', 'provider', 'CodeCraft Labs', 'technology', '+919876543224', 'info@codecraft.dev',
   'Mobile App Development', 'React Native & Flutter experts — 50+ apps on Play Store', 150000, 500000,
   68, true, true, 4.0, 18, 'free');

-- Verify seed
SELECT id, role, display_name, industry, ai_score, rating FROM users ORDER BY role, industry;
