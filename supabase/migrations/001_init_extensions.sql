-- 001_init_extensions.sql
-- Enable necessary extensions
create extension if not exists "pgcrypto" schema "extensions";
create extension if not exists "uuid-ossp" schema "extensions";
