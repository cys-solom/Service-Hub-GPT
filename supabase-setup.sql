-- Run this SQL in Supabase SQL Editor to create the activations table

CREATE TABLE IF NOT EXISTS activations (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    plan TEXT DEFAULT '',
    activation_type TEXT DEFAULT '',
    status TEXT DEFAULT 'success',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE activations ENABLE ROW LEVEL SECURITY;

-- Allow the anon key to insert and select (for our serverless functions)
CREATE POLICY "Allow insert" ON activations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow select" ON activations FOR SELECT USING (true);

-- Index for faster queries
CREATE INDEX idx_activations_created_at ON activations (created_at DESC);
