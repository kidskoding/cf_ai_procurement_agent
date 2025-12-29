-- Database setup for SupplyScout AI Procurement Agent
-- This file contains the SQL to create the necessary tables

-- Create SupplierResponses table if it doesn't exist
CREATE TABLE IF NOT EXISTS SupplierResponses (
    id TEXT PRIMARY KEY,
    supplier_email TEXT NOT NULL UNIQUE,
    supplier_name TEXT NOT NULL,
    price REAL,
    response_text TEXT,
    created_at TEXT NOT NULL
);

-- Create PurchaseOrders table if it doesn't exist  
CREATE TABLE IF NOT EXISTS PurchaseOrders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name TEXT NOT NULL,
    supplier_email TEXT NOT NULL,
    part_number TEXT NOT NULL,
    order_date TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL
);