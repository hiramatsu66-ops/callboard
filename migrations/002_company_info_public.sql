-- Add company_info_public column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_info_public boolean DEFAULT NULL;
