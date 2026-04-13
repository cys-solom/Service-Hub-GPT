-- Run this SQL in Supabase SQL Editor

-- 1. Create the activations table
CREATE TABLE IF NOT EXISTS activations (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    plan TEXT DEFAULT '',
    activation_type TEXT DEFAULT '',
    status TEXT DEFAULT 'success',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable Row Level Security
ALTER TABLE activations ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
-- Anyone can INSERT (for the serverless function using anon key)
CREATE POLICY "Allow public insert" ON activations
    FOR INSERT WITH CHECK (true);

-- Only authenticated users can SELECT (admin must login)
CREATE POLICY "Authenticated users can read" ON activations
    FOR SELECT USING (auth.role() = 'authenticated');

-- 4. Index for faster queries
CREATE INDEX IF NOT EXISTS idx_activations_created_at ON activations (created_at DESC);

-- 5. Create admin user (change email and password!)
-- Go to Supabase Dashboard → Authentication → Users → "Add User"
-- Email: your-admin@email.com
-- Password: your-secure-password
