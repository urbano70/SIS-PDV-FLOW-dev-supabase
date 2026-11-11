-- Migration: cash_register_reports
-- Stores a snapshot every time a cash register is opened or closed.
-- Run this in your Supabase SQL editor before deploying server.ts changes.

CREATE TABLE IF NOT EXISTS cash_register_reports (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       TEXT         NOT NULL,
  type            TEXT         NOT NULL CHECK (type IN ('open', 'close')),
  cash_register_name TEXT,
  shift_started_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  report_data     JSONB
);

CREATE INDEX IF NOT EXISTS idx_crr_tenant_created
  ON cash_register_reports (tenant_id, created_at DESC);
