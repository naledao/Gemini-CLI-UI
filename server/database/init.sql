-- Initialize authentication database
PRAGMA foreign_keys = ON;

-- Users table (single user system) - prefixed with geminicliui_ to avoid conflicts
CREATE TABLE IF NOT EXISTS geminicliui_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1
);

-- Application settings that must be available to the backend process.
CREATE TABLE IF NOT EXISTS geminicliui_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_geminicliui_users_username ON geminicliui_users(username);
CREATE INDEX IF NOT EXISTS idx_geminicliui_users_active ON geminicliui_users(is_active);