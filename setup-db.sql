-- Database setup for Procurement AI Agent
-- This file contains the SQL to create the necessary tables

-- Create Parts table (catalog of available parts)
CREATE TABLE IF NOT EXISTS Parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_number TEXT NOT NULL UNIQUE,
    part_description TEXT NOT NULL
);

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
    order_number TEXT PRIMARY KEY,
    order_date TEXT NOT NULL,
    supplier_name TEXT NOT NULL,
    supplier_email TEXT NOT NULL,
    part_number TEXT NOT NULL,
    price REAL NOT NULL
);