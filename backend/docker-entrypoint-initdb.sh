#!/bin/sh
# Entrypoint script to initialize database schema and seed data
set -e

echo "Waiting for PostgreSQL to be ready..."
until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do
  sleep 1
done

echo "Running schema initialization..."
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/01_schema.sql

echo "Running seed data..."
# Convert db-seed.js to run via node
node /docker-entrypoint-initdb.d/02_seed.js

echo "Database initialization complete!"