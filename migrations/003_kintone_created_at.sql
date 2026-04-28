-- Add kintone_created_at column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS kintone_created_at timestamptz DEFAULT NULL;
