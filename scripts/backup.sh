#!/bin/bash
# =============================================================================
# Waspread Backup Script
# =============================================================================
# Backs up PostgreSQL database and WhatsApp sessions
# Supports retention policy and optional R2 upload
#
# Usage: ./scripts/backup.sh [options]
#   -d, --db-only      Only backup database
#   -s, --sessions-only Only backup WhatsApp sessions
#   -n, --no-compress  Skip compression
#   -r, --upload-r2    Upload to Cloudflare R2
#   -h, --help         Show this help
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_BASE_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
LOG_DIR="${LOG_DIR:-$PROJECT_DIR/logs}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE_ONLY=$(date +%Y%m%d)

# Docker container names (adjust if different)
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-waspread-postgres}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-waspread-backend}"

# Database credentials (from .env or environment)
DB_USER="${DB_USERNAME:-waspread}"
DB_NAME="${DB_DATABASE:-waspread}"

# Retention settings
DAILY_RETENTION=${DAILY_RETENTION:-7}
WEEKLY_RETENTION=${WEEKLY_RETENTION:-4}
MONTHLY_RETENTION=${MONTHLY_RETENTION:-3}

# R2 Configuration (optional)
R2_BUCKET="${R2_BUCKET:-}"
R2_ENDPOINT="${R2_ENDPOINT:-}"
R2_ACCESS_KEY="${R2_ACCESS_KEY_ID:-}"
R2_SECRET_KEY="${R2_SECRET_ACCESS_KEY:-}"

# -----------------------------------------------------------------------------
# Options
# -----------------------------------------------------------------------------
BACKUP_DB=true
BACKUP_SESSIONS=true
COMPRESS=true
UPLOAD_R2=false

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message"
}

info() { log "INFO" "$@"; }
warn() { log "WARN" "$@"; }
error() { log "ERROR" "$@"; }

show_help() {
    head -20 "$0" | tail -15
    exit 0
}

check_dependencies() {
    local missing=()

    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    fi

    if $UPLOAD_R2 && ! command -v aws &> /dev/null; then
        missing+=("aws-cli (for R2 upload)")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        error "Missing dependencies: ${missing[*]}"
        exit 1
    fi
}

check_containers() {
    if $BACKUP_DB; then
        if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
            error "PostgreSQL container '$POSTGRES_CONTAINER' is not running"
            exit 1
        fi
    fi
}

create_backup_dirs() {
    mkdir -p "$BACKUP_BASE_DIR/daily"
    mkdir -p "$BACKUP_BASE_DIR/weekly"
    mkdir -p "$BACKUP_BASE_DIR/monthly"
    mkdir -p "$LOG_DIR"
}

backup_database() {
    local backup_file="$1"
    info "Starting database backup..."

    # Use pg_dump with custom format (faster restore, compression built-in)
    if docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DB_USER" -Fc -d "$DB_NAME" > "$backup_file"; then
        local size=$(du -h "$backup_file" | cut -f1)
        info "Database backup complete: $backup_file ($size)"
        return 0
    else
        error "Database backup failed!"
        return 1
    fi
}

backup_sessions() {
    local backup_dir="$1"
    info "Starting WhatsApp sessions backup..."

    local sessions_dir="$backup_dir/baileys_auth"
    mkdir -p "$sessions_dir"

    # Check if backend container exists and has sessions
    if docker ps -a --format '{{.Names}}' | grep -q "^${BACKEND_CONTAINER}$"; then
        # Copy from container
        if docker cp "$BACKEND_CONTAINER:/usr/src/app/.baileys_auth/." "$sessions_dir/" 2>/dev/null; then
            local count=$(find "$sessions_dir" -type f 2>/dev/null | wc -l)
            info "WhatsApp sessions backup complete: $count files"
            return 0
        else
            warn "No WhatsApp sessions found in container or container not running"
            # Try local path as fallback
            if [ -d "$PROJECT_DIR/.baileys_auth" ]; then
                cp -r "$PROJECT_DIR/.baileys_auth/." "$sessions_dir/"
                info "WhatsApp sessions backup from local path complete"
                return 0
            fi
        fi
    elif [ -d "$PROJECT_DIR/.baileys_auth" ]; then
        # Copy from local path
        cp -r "$PROJECT_DIR/.baileys_auth/." "$sessions_dir/"
        local count=$(find "$sessions_dir" -type f 2>/dev/null | wc -l)
        info "WhatsApp sessions backup complete: $count files"
        return 0
    else
        warn "No WhatsApp sessions found"
        return 0
    fi
}

compress_backup() {
    local backup_dir="$1"
    local archive_name="$2"

    info "Compressing backup..."

    cd "$(dirname "$backup_dir")"
    local dir_name=$(basename "$backup_dir")

    if tar -czf "$archive_name" "$dir_name"; then
        local size=$(du -h "$archive_name" | cut -f1)
        info "Compression complete: $archive_name ($size)"
        rm -rf "$backup_dir"
        return 0
    else
        error "Compression failed!"
        return 1
    fi
}

upload_to_r2() {
    local file="$1"

    if [ -z "$R2_BUCKET" ] || [ -z "$R2_ENDPOINT" ]; then
        warn "R2 not configured, skipping upload"
        return 0
    fi

    info "Uploading to R2..."

    local filename=$(basename "$file")

    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" \
    AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
    aws s3 cp "$file" "s3://$R2_BUCKET/backups/$filename" \
        --endpoint-url "$R2_ENDPOINT" \
        --quiet

    if [ $? -eq 0 ]; then
        info "Upload complete: s3://$R2_BUCKET/backups/$filename"
        return 0
    else
        error "Upload to R2 failed!"
        return 1
    fi
}

apply_retention() {
    info "Applying retention policy..."

    # Daily backups - keep last N days
    local daily_count=$(find "$BACKUP_BASE_DIR/daily" -name "*.tar.gz" -type f 2>/dev/null | wc -l)
    if [ "$daily_count" -gt "$DAILY_RETENTION" ]; then
        local to_delete=$((daily_count - DAILY_RETENTION))
        find "$BACKUP_BASE_DIR/daily" -name "*.tar.gz" -type f -printf '%T+ %p\n' 2>/dev/null | \
            sort | head -n "$to_delete" | cut -d' ' -f2- | \
            xargs -r rm -f
        info "Deleted $to_delete old daily backups"
    fi

    # Weekly backups - keep last N weeks
    local weekly_count=$(find "$BACKUP_BASE_DIR/weekly" -name "*.tar.gz" -type f 2>/dev/null | wc -l)
    if [ "$weekly_count" -gt "$WEEKLY_RETENTION" ]; then
        local to_delete=$((weekly_count - WEEKLY_RETENTION))
        find "$BACKUP_BASE_DIR/weekly" -name "*.tar.gz" -type f -printf '%T+ %p\n' 2>/dev/null | \
            sort | head -n "$to_delete" | cut -d' ' -f2- | \
            xargs -r rm -f
        info "Deleted $to_delete old weekly backups"
    fi

    # Monthly backups - keep last N months
    local monthly_count=$(find "$BACKUP_BASE_DIR/monthly" -name "*.tar.gz" -type f 2>/dev/null | wc -l)
    if [ "$monthly_count" -gt "$MONTHLY_RETENTION" ]; then
        local to_delete=$((monthly_count - MONTHLY_RETENTION))
        find "$BACKUP_BASE_DIR/monthly" -name "*.tar.gz" -type f -printf '%T+ %p\n' 2>/dev/null | \
            sort | head -n "$to_delete" | cut -d' ' -f2- | \
            xargs -r rm -f
        info "Deleted $to_delete old monthly backups"
    fi
}

categorize_backup() {
    local archive="$1"
    local filename=$(basename "$archive")

    # Always copy to daily
    cp "$archive" "$BACKUP_BASE_DIR/daily/"
    info "Saved as daily backup"

    # Check if it's Sunday (weekly backup)
    local day_of_week=$(date +%u)
    if [ "$day_of_week" -eq 7 ]; then
        cp "$archive" "$BACKUP_BASE_DIR/weekly/"
        info "Saved as weekly backup (Sunday)"
    fi

    # Check if it's the 1st of the month (monthly backup)
    local day_of_month=$(date +%d)
    if [ "$day_of_month" -eq "01" ]; then
        cp "$archive" "$BACKUP_BASE_DIR/monthly/"
        info "Saved as monthly backup (1st of month)"
    fi

    # Remove temp archive
    rm -f "$archive"
}

# -----------------------------------------------------------------------------
# Parse Arguments
# -----------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--db-only)
            BACKUP_DB=true
            BACKUP_SESSIONS=false
            shift
            ;;
        -s|--sessions-only)
            BACKUP_DB=false
            BACKUP_SESSIONS=true
            shift
            ;;
        -n|--no-compress)
            COMPRESS=false
            shift
            ;;
        -r|--upload-r2)
            UPLOAD_R2=true
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            error "Unknown option: $1"
            show_help
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    info "=========================================="
    info "Waspread Backup Starting"
    info "=========================================="
    info "Timestamp: $TIMESTAMP"
    info "Backup directory: $BACKUP_BASE_DIR"

    # Load .env if exists
    if [ -f "$PROJECT_DIR/.env" ]; then
        set -a
        source "$PROJECT_DIR/.env"
        set +a
        # Re-read DB credentials after loading .env
        DB_USER="${DB_USERNAME:-waspread}"
        DB_NAME="${DB_DATABASE:-waspread}"
    fi

    check_dependencies
    create_backup_dirs

    local temp_backup_dir="$BACKUP_BASE_DIR/temp_$TIMESTAMP"
    mkdir -p "$temp_backup_dir"

    local success=true

    # Backup database
    if $BACKUP_DB; then
        check_containers
        if ! backup_database "$temp_backup_dir/database.dump"; then
            success=false
        fi
    fi

    # Backup WhatsApp sessions
    if $BACKUP_SESSIONS; then
        if ! backup_sessions "$temp_backup_dir"; then
            # Sessions backup failure is non-fatal
            warn "Sessions backup had issues but continuing..."
        fi
    fi

    if ! $success; then
        error "Backup failed!"
        rm -rf "$temp_backup_dir"
        exit 1
    fi

    # Compress
    local archive_name="$BACKUP_BASE_DIR/waspread_backup_$TIMESTAMP.tar.gz"
    if $COMPRESS; then
        if ! compress_backup "$temp_backup_dir" "$archive_name"; then
            exit 1
        fi
    else
        # Just rename the directory
        mv "$temp_backup_dir" "$BACKUP_BASE_DIR/waspread_backup_$TIMESTAMP"
        archive_name="$BACKUP_BASE_DIR/waspread_backup_$TIMESTAMP"
    fi

    # Upload to R2
    if $UPLOAD_R2 && $COMPRESS; then
        upload_to_r2 "$archive_name"
    fi

    # Categorize and apply retention
    if $COMPRESS; then
        categorize_backup "$archive_name"
    fi

    apply_retention

    info "=========================================="
    info "Backup Complete!"
    info "=========================================="

    # Show summary
    info "Daily backups: $(find "$BACKUP_BASE_DIR/daily" -name "*.tar.gz" -type f 2>/dev/null | wc -l)"
    info "Weekly backups: $(find "$BACKUP_BASE_DIR/weekly" -name "*.tar.gz" -type f 2>/dev/null | wc -l)"
    info "Monthly backups: $(find "$BACKUP_BASE_DIR/monthly" -name "*.tar.gz" -type f 2>/dev/null | wc -l)"
}

main "$@"
