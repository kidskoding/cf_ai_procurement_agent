-- Migration: Add SupplierResponses table
CREATE TABLE IF NOT EXISTS SupplierResponses (
  id TEXT PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  supplier_email TEXT NOT NULL UNIQUE,
  price REAL,
  response_text TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_responses_email ON SupplierResponses(supplier_email);
CREATE INDEX IF NOT EXISTS idx_supplier_responses_date ON SupplierResponses(created_at);
