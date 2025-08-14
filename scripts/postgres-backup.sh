#!/bin/bash

# Event API - PostgreSQL Backup Script for Coolify Deployment
# Automated backup solution with S3 support and retention management
# Designed to work with Coolify's container environment

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration from environment or defaults
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-event_api_production}"
POSTGRES_USER="${POSTGRES_USER:-event_api_prod}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
DATABASE_URL="${DATABASE_URL:-}"

# Backup configuration
BACKUP_DIR="${BACKUP_DIR:-/app/backups/postgres}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_PREFIX="${BACKUP_PREFIX:-event-api-db}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# S3 Configuration (optional)
AWS_S3_BUCKET="${AWS_S3_BUCKET:-}"
AWS_S3_REGION="${AWS_S3_REGION:-us-east-1}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"

# Logging configuration
LOG_DIR="${PROJECT_ROOT}/logs"
LOG_FILE="${LOG_DIR}/postgres-backup.log"

# Create necessary directories
mkdir -p "$BACKUP_DIR" "$LOG_DIR"

# Logging functions
log() {
    local level="$1"
    shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*" | tee -a "$LOG_FILE"
}

info() { log "INFO" "$@"; }
success() { log "SUCCESS" "$@"; }
warning() { log "WARNING" "$@"; }
error() { log "ERROR" "$@"; }

# Color output for terminal
info_color() { echo -e "\033[36m[INFO]\033[0m $*" | tee -a "$LOG_FILE"; }
success_color() { echo -e "\033[32m[SUCCESS]\033[0m $*" | tee -a "$LOG_FILE"; }
warning_color() { echo -e "\033[33m[WARNING]\033[0m $*" | tee -a "$LOG_FILE"; }
error_color() { echo -e "\033[31m[ERROR]\033[0m $*" | tee -a "$LOG_FILE"; }

# Function to validate configuration
validate_config() {
    info "Validating backup configuration..."
    
    local errors=0
    
    # Check PostgreSQL configuration
    if [ -z "$POSTGRES_PASSWORD" ] && [ -z "$DATABASE_URL" ]; then
        error "Neither POSTGRES_PASSWORD nor DATABASE_URL is set"
        ((errors++))
    fi
    
    # Check backup directory permissions
    if [ ! -w "$(dirname "$BACKUP_DIR")" ]; then
        error "Cannot write to backup directory: $(dirname "$BACKUP_DIR")"
        ((errors++))
    fi
    
    # Check required commands
    local required_cmds=("pg_dump" "gzip" "find")
    for cmd in "${required_cmds[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            error "Required command not found: $cmd"
            ((errors++))
        fi
    done
    
    # Validate S3 configuration if enabled
    if [ -n "$AWS_S3_BUCKET" ]; then
        if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
            error "S3 backup enabled but AWS credentials not provided"
            ((errors++))
        fi
        
        if ! command -v "aws" >/dev/null 2>&1; then
            warning "AWS CLI not found, S3 backup will be skipped"
        fi
    fi
    
    if [ $errors -gt 0 ]; then
        error "Configuration validation failed with $errors errors"
        return 1
    fi
    
    success "Configuration validation passed"
    return 0
}

# Function to test database connectivity
test_database_connection() {
    info "Testing database connectivity..."
    
    local connection_string
    if [ -n "$DATABASE_URL" ]; then
        connection_string="$DATABASE_URL"
    else
        connection_string="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
    fi
    
    # Test connection with a simple query
    if psql "$connection_string" -c "SELECT version();" >/dev/null 2>&1; then
        success "Database connection successful"
        return 0
    else
        error "Database connection failed"
        return 1
    fi
}

# Function to create database backup
create_database_backup() {
    info "Creating database backup..."
    
    local backup_filename="${BACKUP_PREFIX}_${TIMESTAMP}.sql"
    local backup_path="${BACKUP_DIR}/${backup_filename}"
    local compressed_backup_path="${backup_path}.gz"
    
    # Prepare connection string
    local connection_string
    if [ -n "$DATABASE_URL" ]; then
        connection_string="$DATABASE_URL"
    else
        connection_string="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
    fi
    
    # Create the backup
    info "Backing up database to: $backup_path"
    
    local pg_dump_options=(
        "--verbose"
        "--no-password"
        "--format=custom"
        "--compress=5"
        "--no-owner"
        "--no-privileges"
    )
    
    # Add schema-only or data-only options if specified
    if [ "${BACKUP_SCHEMA_ONLY:-false}" = "true" ]; then
        pg_dump_options+=("--schema-only")
    elif [ "${BACKUP_DATA_ONLY:-false}" = "true" ]; then
        pg_dump_options+=("--data-only")
    fi
    
    # Create backup with error handling
    if pg_dump "${pg_dump_options[@]}" "$connection_string" > "$backup_path" 2>>"$LOG_FILE"; then
        # Compress the backup
        if gzip "$backup_path"; then
            local backup_size
            backup_size=$(du -h "$compressed_backup_path" | cut -f1)
            success "Database backup created successfully: $compressed_backup_path ($backup_size)"
            echo "$compressed_backup_path"
            return 0
        else
            error "Failed to compress backup file"
            rm -f "$backup_path" 2>/dev/null
            return 1
        fi
    else
        error "Database backup failed"
        rm -f "$backup_path" 2>/dev/null
        return 1
    fi
}

# Function to create additional backups (pg_dumpall for globals)
create_globals_backup() {
    info "Creating PostgreSQL globals backup..."
    
    local globals_filename="${BACKUP_PREFIX}_globals_${TIMESTAMP}.sql.gz"
    local globals_path="${BACKUP_DIR}/${globals_filename}"
    
    # Prepare connection options
    local pg_options=()
    if [ -n "$DATABASE_URL" ]; then
        # Extract connection details from DATABASE_URL for pg_dumpall
        local url_pattern='postgresql://([^:]+):([^@]+)@([^:]+):([^/]+)/(.*)'
        if [[ $DATABASE_URL =~ $url_pattern ]]; then
            PGUSER="${BASH_REMATCH[1]}"
            PGPASSWORD="${BASH_REMATCH[2]}"
            PGHOST="${BASH_REMATCH[3]}"
            PGPORT="${BASH_REMATCH[4]}"
            export PGUSER PGPASSWORD PGHOST PGPORT
        fi
    else
        export PGUSER="$POSTGRES_USER"
        export PGPASSWORD="$POSTGRES_PASSWORD"
        export PGHOST="$POSTGRES_HOST"
        export PGPORT="$POSTGRES_PORT"
    fi
    
    # Create globals backup
    if pg_dumpall --globals-only --verbose 2>>"$LOG_FILE" | gzip > "$globals_path"; then
        local globals_size
        globals_size=$(du -h "$globals_path" | cut -f1)
        success "Globals backup created: $globals_path ($globals_size)"
        echo "$globals_path"
        return 0
    else
        error "Failed to create globals backup"
        rm -f "$globals_path" 2>/dev/null
        return 1
    fi
}

# Function to upload backup to S3
upload_to_s3() {
    local backup_file="$1"
    
    if [ -z "$AWS_S3_BUCKET" ] || ! command -v "aws" >/dev/null 2>&1; then
        info "S3 upload skipped (not configured or AWS CLI not available)"
        return 0
    fi
    
    info "Uploading backup to S3..."
    
    local s3_key="backups/postgres/$(basename "$backup_file")"
    local s3_uri="s3://$AWS_S3_BUCKET/$s3_key"
    
    # Configure AWS CLI
    export AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
    export AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
    export AWS_DEFAULT_REGION="$AWS_S3_REGION"
    
    # Upload with metadata
    if aws s3 cp "$backup_file" "$s3_uri" \
        --metadata "backup-date=$TIMESTAMP,database=$POSTGRES_DB,server=$(hostname)" \
        --storage-class "STANDARD_IA" \
        2>>"$LOG_FILE"; then
        success "Backup uploaded to S3: $s3_uri"
        return 0
    else
        error "Failed to upload backup to S3"
        return 1
    fi
}

# Function to clean up old backups
cleanup_old_backups() {
    info "Cleaning up old backups (retention: $BACKUP_RETENTION_DAYS days)..."
    
    # Clean up local backups
    local deleted_count=0
    
    # Find and remove old local backups
    while IFS= read -r -d '' old_backup; do
        info "Removing old backup: $(basename "$old_backup")"
        rm -f "$old_backup"
        ((deleted_count++))
    done < <(find "$BACKUP_DIR" -name "${BACKUP_PREFIX}_*.sql.gz" -type f -mtime +$BACKUP_RETENTION_DAYS -print0 2>/dev/null)
    
    # Clean up S3 backups if configured
    if [ -n "$AWS_S3_BUCKET" ] && command -v "aws" >/dev/null 2>&1; then
        local cutoff_date
        cutoff_date=$(date -d "$BACKUP_RETENTION_DAYS days ago" +%Y%m%d)
        
        # List and delete old S3 backups
        aws s3api list-objects-v2 \
            --bucket "$AWS_S3_BUCKET" \
            --prefix "backups/postgres/" \
            --query "Contents[?LastModified<=\`$(date -d "$BACKUP_RETENTION_DAYS days ago" --iso-8601)\`].Key" \
            --output text 2>/dev/null | while read -r s3_key; do
            if [ -n "$s3_key" ] && [[ $s3_key == *"${BACKUP_PREFIX}_"* ]]; then
                info "Removing old S3 backup: $s3_key"
                aws s3 rm "s3://$AWS_S3_BUCKET/$s3_key" 2>>"$LOG_FILE"
                ((deleted_count++))
            fi
        done
    fi
    
    if [ $deleted_count -gt 0 ]; then
        success "Cleaned up $deleted_count old backup(s)"
    else
        info "No old backups to clean up"
    fi
}

# Function to verify backup integrity
verify_backup() {
    local backup_file="$1"
    
    info "Verifying backup integrity..."
    
    # Check if file exists and is not empty
    if [ ! -s "$backup_file" ]; then
        error "Backup file is empty or does not exist: $backup_file"
        return 1
    fi
    
    # Test gzip integrity
    if ! gzip -t "$backup_file" 2>/dev/null; then
        error "Backup file is corrupted (gzip test failed): $backup_file"
        return 1
    fi
    
    # Test pg_restore with list option
    if ! pg_restore --list "$backup_file" >/dev/null 2>&1; then
        error "Backup file is corrupted (pg_restore test failed): $backup_file"
        return 1
    fi
    
    success "Backup integrity verification passed: $backup_file"
    return 0
}

# Function to create backup metadata
create_backup_metadata() {
    local backup_file="$1"
    local metadata_file="${backup_file%.gz}.metadata.json"
    
    info "Creating backup metadata..."
    
    # Get database information
    local db_version db_size
    db_version=$(psql "${DATABASE_URL:-postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB}" -t -c "SELECT version();" 2>/dev/null | xargs)
    db_size=$(psql "${DATABASE_URL:-postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB}" -t -c "SELECT pg_size_pretty(pg_database_size('$POSTGRES_DB'));" 2>/dev/null | xargs)
    
    # Create metadata JSON
    cat > "$metadata_file" << EOF
{
  "backup_info": {
    "timestamp": "$TIMESTAMP",
    "backup_file": "$(basename "$backup_file")",
    "backup_size": "$(du -h "$backup_file" | cut -f1)",
    "backup_type": "full"
  },
  "database_info": {
    "host": "$POSTGRES_HOST",
    "port": $POSTGRES_PORT,
    "database": "$POSTGRES_DB",
    "user": "$POSTGRES_USER",
    "version": "$db_version",
    "size": "$db_size"
  },
  "environment_info": {
    "hostname": "$(hostname)",
    "script_version": "1.0",
    "retention_days": $BACKUP_RETENTION_DAYS
  },
  "s3_info": {
    "enabled": $([ -n "$AWS_S3_BUCKET" ] && echo "true" || echo "false"),
    "bucket": "$AWS_S3_BUCKET",
    "region": "$AWS_S3_REGION"
  }
}
EOF
    
    success "Backup metadata created: $(basename "$metadata_file")"
}

# Function to send backup notification
send_notification() {
    local status="$1"
    local backup_file="$2"
    local message="$3"
    
    # Webhook notification
    if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
        local webhook_payload
        webhook_payload=$(cat << EOF
{
  "text": "Event API Database Backup $status",
  "attachments": [
    {
      "color": $([ "$status" = "SUCCESS" ] && echo "\"good\"" || echo "\"danger\""),
      "fields": [
        {
          "title": "Database",
          "value": "$POSTGRES_DB",
          "short": true
        },
        {
          "title": "Timestamp",
          "value": "$TIMESTAMP",
          "short": true
        },
        {
          "title": "Backup File",
          "value": "$(basename "$backup_file")",
          "short": true
        },
        {
          "title": "Message",
          "value": "$message",
          "short": false
        }
      ]
    }
  ]
}
EOF
        )
        
        curl -X POST -H "Content-Type: application/json" \
             -d "$webhook_payload" \
             "$ALERT_WEBHOOK_URL" \
             >/dev/null 2>&1 || warning "Failed to send webhook notification"
    fi
    
    # Email notification (if configured)
    if [ -n "${ALERT_EMAIL:-}" ] && command -v "mail" >/dev/null 2>&1; then
        local email_subject="Event API Database Backup $status - $TIMESTAMP"
        local email_body="Database backup $status at $TIMESTAMP\n\nDatabase: $POSTGRES_DB\nBackup File: $(basename "$backup_file")\nMessage: $message\n\nHostname: $(hostname)"
        
        echo -e "$email_body" | mail -s "$email_subject" "$ALERT_EMAIL" || \
            warning "Failed to send email notification"
    fi
}

# Main backup function
main() {
    info "Starting PostgreSQL backup for Event API"
    info "Database: $POSTGRES_DB"
    info "Backup directory: $BACKUP_DIR"
    info "Retention: $BACKUP_RETENTION_DAYS days"
    
    # Validate configuration
    if ! validate_config; then
        error "Configuration validation failed"
        exit 1
    fi
    
    # Test database connection
    if ! test_database_connection; then
        error "Database connection failed"
        send_notification "FAILED" "" "Database connection failed"
        exit 1
    fi
    
    # Create database backup
    local backup_file
    if backup_file=$(create_database_backup); then
        # Verify backup integrity
        if verify_backup "$backup_file"; then
            # Create metadata
            create_backup_metadata "$backup_file"
            
            # Create globals backup
            local globals_file
            globals_file=$(create_globals_backup) || warning "Globals backup failed"
            
            # Upload to S3 if configured
            upload_to_s3 "$backup_file"
            if [ -n "${globals_file:-}" ]; then
                upload_to_s3 "$globals_file"
            fi
            
            # Clean up old backups
            cleanup_old_backups
            
            # Send success notification
            send_notification "SUCCESS" "$backup_file" "Database backup completed successfully"
            
            success "Database backup completed successfully: $(basename "$backup_file")"
        else
            error "Backup verification failed"
            send_notification "FAILED" "$backup_file" "Backup verification failed"
            exit 1
        fi
    else
        error "Database backup failed"
        send_notification "FAILED" "" "Database backup creation failed"
        exit 1
    fi
}

# Script usage information
usage() {
    cat << EOF
Event API PostgreSQL Backup Script

Usage: $0 [OPTIONS]

Options:
  -h, --help              Show this help message
  -v, --verify FILE       Verify backup file integrity
  -r, --restore FILE      Restore from backup file
  -l, --list              List available backups
  -c, --cleanup           Clean up old backups only
  --schema-only          Backup schema only (no data)
  --data-only            Backup data only (no schema)

Environment Variables:
  POSTGRES_HOST           PostgreSQL host (default: postgres)
  POSTGRES_PORT           PostgreSQL port (default: 5432)
  POSTGRES_DB             Database name
  POSTGRES_USER           Database user
  POSTGRES_PASSWORD       Database password
  DATABASE_URL            Full connection string (overrides individual params)
  BACKUP_DIR              Backup directory (default: /app/backups/postgres)
  BACKUP_RETENTION_DAYS   Backup retention in days (default: 30)
  AWS_S3_BUCKET          S3 bucket for offsite backups
  AWS_ACCESS_KEY_ID      AWS access key
  AWS_SECRET_ACCESS_KEY  AWS secret key
  AWS_S3_REGION          AWS region (default: us-east-1)

Examples:
  $0                      Create backup with default settings
  $0 --schema-only        Create schema-only backup
  $0 --verify backup.sql.gz  Verify backup file integrity
  $0 --list               List available backups
EOF
}

# Command line argument processing
case "${1:-}" in
    -h|--help)
        usage
        exit 0
        ;;
    -v|--verify)
        if [ -n "${2:-}" ]; then
            verify_backup "$2"
            exit $?
        else
            error "Please provide backup file to verify"
            exit 1
        fi
        ;;
    -l|--list)
        info "Available backups in $BACKUP_DIR:"
        ls -lah "$BACKUP_DIR"/${BACKUP_PREFIX}_*.sql.gz 2>/dev/null || info "No backups found"
        exit 0
        ;;
    -c|--cleanup)
        cleanup_old_backups
        exit 0
        ;;
    --schema-only)
        export BACKUP_SCHEMA_ONLY=true
        ;;
    --data-only)
        export BACKUP_DATA_ONLY=true
        ;;
esac

# Run main function if script is executed directly
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi