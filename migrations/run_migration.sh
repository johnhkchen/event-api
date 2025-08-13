#!/bin/bash
# Migration runner script for Event API
# Usage: ./run_migration.sh [forward|rollback] [migration_number]

set -e

# Default values
ACTION=${1:-"forward"}
MIGRATION=${2:-"001"}
DB_HOST=${DB_HOST:-"localhost"}
DB_PORT=${DB_PORT:-"5432"}
DB_NAME=${DB_NAME:-"event_api_dev"}
DB_USER=${DB_USER:-"event_api_user"}
DB_PASSWORD=${DB_PASSWORD:-"development_password"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Event API Migration Runner${NC}"
echo "Action: $ACTION"
echo "Migration: $MIGRATION"
echo "Database: $DB_NAME on $DB_HOST:$DB_PORT"
echo ""

# Check if migration file exists
if [ "$ACTION" = "forward" ]; then
    MIGRATION_FILE="${MIGRATION}_*.sql"
    FILES=$(ls ${MIGRATION}_*.sql 2>/dev/null | grep -v rollback | head -1)
elif [ "$ACTION" = "rollback" ]; then
    MIGRATION_FILE="${MIGRATION}_*_rollback.sql"
    FILES=$(ls ${MIGRATION}_*_rollback.sql 2>/dev/null | head -1)
else
    echo -e "${RED}Error: Action must be 'forward' or 'rollback'${NC}"
    exit 1
fi

if [ -z "$FILES" ]; then
    echo -e "${RED}Error: Migration file not found: $MIGRATION_FILE${NC}"
    exit 1
fi

MIGRATION_FILE=$FILES
echo "Using migration file: $MIGRATION_FILE"

# Check database connection
echo -e "${YELLOW}Testing database connection...${NC}"
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1;" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Database connection successful${NC}"
else
    echo -e "${RED}✗ Database connection failed${NC}"
    echo "Please check your database connection settings."
    exit 1
fi

# Run migration
echo -e "${YELLOW}Running migration: $MIGRATION_FILE${NC}"
echo ""

PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$MIGRATION_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Migration completed successfully${NC}"
    
    # Show table count after migration
    echo -e "${YELLOW}Database state:${NC}"
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
        SELECT 
            schemaname,
            tablename,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_tables 
        WHERE schemaname = 'public' 
        ORDER BY tablename;
    "
else
    echo ""
    echo -e "${RED}✗ Migration failed${NC}"
    exit 1
fi