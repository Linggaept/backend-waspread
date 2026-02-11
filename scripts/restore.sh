#!/bin/bash
# =============================================================================
# Waspread Restore Script
# =============================================================================
# Restores PostgreSQL database and WhatsApp sessions from backup
#
# Usage: ./scripts/restore.sh [options] [backup_file]
#   -l, --list         List available backups
#   -d, --db-only      Only restore database
#   -s, --sessions-only Only restore WhatsApp sessions
#   -f, --force        Skip confirmation prompts
#   -h, --help         Show this help
#
# Examples:
#   ./scripts/restore.sh -l                    # List backups
#   ./scripts/restore.sh backup.tar.gz         # Restore from file
#   ./scripts/restore.sh -d backup.tar.gz      # Restore only database
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_BASE_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"

# Docker container names
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-waspread-postgres}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-waspread-backend}"

# Database credentials (from .env or environment)
DB_USER="${DB_USERNAME:-waspread}"
DB_NAME="${DB_DATABASE:-waspread}"

# -----------------------------------------------------------------------------
# Options
# -----------------------------------------------------------------------------
RESTORE_DB=true
RESTORE_SESSIONS=true
FORCE=false
LIST_BACKUPS=false
BACKUP_FILE=""

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
    head -25 "$0" | tail -20
    exit 0
}

list_backups() {
    echo ""
    echo "Available Backups:"
    echo "=================="
    echo ""

    echo "📅 Daily Backups (last $DAILY_RETENTION):"
    if [ -d "$BACKUP_BASE_DIR/daily" ]; then
        find "$BACKUP_BASE_DIR/daily" -name "*.tar.gz" -type f -printf '  %f (%s bytes, %Tc)\n' 2>/dev/null | sort -r | head -10
    else
        echo "  No daily backups found"
    fi
    echo ""

    echo "📆 Weekly Backups:"
    if [ -d "$BACKUP_BASE_DIR/weekly" ]; then
        find "$BACKUP_BASE_DIR/weekly" -name "*.tar.gz" -type f -printf '  %f (%s bytes, %Tc)\n' 2>/dev/null | sort -r | head -10
    else
        echo "  No weekly backups found"
    fi
    echo ""

    echo "📆 Monthly Backups:"
    if [ -d "$BACKUP_BASE_DIR/monthly" ]; then
        find "$BACKUP_BASE_DIR/monthly" -name "*.tar.gz" -type f -printf '  %f (%s bytes, %Tc)\n' 2>/dev/null | sort -r | head -10
    else
        echo "  No monthly backups found"
    fi
    echo ""

    echo "Usage: ./scripts/restore.sh <backup_file>"
    echo "Example: ./scripts/restore.sh backups/daily/waspread_backup_20240101_020000.tar.gz"
}

confirm() {
    local message="$1"
    if $FORCE; then
        return 0
    fi

    echo ""
    echo "⚠️  WARNING: $message"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " response
    case "$response" in
        [Yy][Ee][Ss])
            return 0
            ;;
        *)
            info "Restore cancelled by user"
            exit 0
            ;;
    esac
}

check_dependencies() {
    if ! command -v docker &> /dev/null; then
        error "Docker is required but not installed"
        exit 1
    fi
}

check_containers() {
    if $RESTORE_DB; then
        if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
            error "PostgreSQL container '$POSTGRES_CONTAINER' is not running"
            error "Start with: docker-compose up -d postgres"
            exit 1
        fi
    fi
}

extract_backup() {
    local backup_file="$1"
    local temp_dir="$2"

    info "Extracting backup..."

    if [[ "$backup_file" == *.tar.gz ]]; then
        tar -xzf "$backup_file" -C "$temp_dir"
    elif [[ "$backup_file" == *.dump ]]; then
        # Direct database dump file
        mkdir -p "$temp_dir/waspread_backup_direct"
        cp "$backup_file" "$temp_dir/waspread_backup_direct/database.dump"
    else
        error "Unsupported backup format: $backup_file"
        exit 1
    fi

    # Find the extracted directory
    local extracted_dir=$(find "$temp_dir" -maxdepth 1 -type d -name "waspread_backup*" | head -1)
    if [ -z "$extracted_dir" ]; then
        error "Invalid backup archive structure"
        exit 1
    fi

    echo "$extracted_dir"
}

restore_database() {
    local backup_dir="$1"
    local dump_file="$backup_dir/database.dump"

    if [ ! -f "$dump_file" ]; then
        warn "No database dump found in backup"
        return 0
    fi

    info "Restoring database..."

    # Check database dump format
    local dump_type=$(file "$dump_file" | head -1)
    info "Dump file type: $dump_type"

    # Drop existing connections
    info "Terminating existing database connections..."
    docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d postgres -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" \
        2>/dev/null || true

    # Restore based on format
    if echo "$dump_type" | grep -q "PostgreSQL custom database dump"; then
        # Custom format - use pg_restore
        info "Detected custom format dump, using pg_restore..."

        # Drop and recreate database
        docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
        docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

        # Restore
        cat "$dump_file" | docker exec -i "$POSTGRES_CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl 2>&1 | \
            grep -v "pg_restore: warning" || true

    else
        # Plain SQL format - use psql
        info "Detected SQL format dump, using psql..."

        # Drop and recreate database
        docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
        docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

        # Restore
        cat "$dump_file" | docker exec -i "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" 2>&1 | \
            grep -v "NOTICE" | grep -v "already exists" || true
    fi

    info "Database restore complete"
}

restore_sessions() {
    local backup_dir="$1"
    local sessions_dir="$backup_dir/baileys_auth"

    if [ ! -d "$sessions_dir" ]; then
        warn "No WhatsApp sessions found in backup"
        return 0
    fi

    local file_count=$(find "$sessions_dir" -type f 2>/dev/null | wc -l)
    if [ "$file_count" -eq 0 ]; then
        warn "WhatsApp sessions directory is empty"
        return 0
    fi

    info "Restoring WhatsApp sessions ($file_count files)..."

    # Check if backend container is running
    if docker ps --format '{{.Names}}' | grep -q "^${BACKEND_CONTAINER}$"; then
        # Stop backend to prevent session conflicts
        warn "Stopping backend container to prevent session conflicts..."
        docker stop "$BACKEND_CONTAINER" || true

        # Remove existing sessions
        docker exec "$BACKEND_CONTAINER" rm -rf /usr/src/app/.baileys_auth 2>/dev/null || true

        # Copy sessions to container
        docker cp "$sessions_dir" "$BACKEND_CONTAINER:/usr/src/app/.baileys_auth"

        # Start backend
        docker start "$BACKEND_CONTAINER"
        info "Backend container restarted"
    else
        # Copy to local directory
        local target_dir="$PROJECT_DIR/.baileys_auth"
        if [ -d "$target_dir" ]; then
            rm -rf "$target_dir"
        fi
        cp -r "$sessions_dir" "$target_dir"
        info "Sessions restored to local directory"
    fi

    info "WhatsApp sessions restore complete"
}

# -----------------------------------------------------------------------------
# Parse Arguments
# -----------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case $1 in
        -l|--list)
            LIST_BACKUPS=true
            shift
            ;;
        -d|--db-only)
            RESTORE_DB=true
            RESTORE_SESSIONS=false
            shift
            ;;
        -s|--sessions-only)
            RESTORE_DB=false
            RESTORE_SESSIONS=true
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -h|--help)
            show_help
            ;;
        -*)
            error "Unknown option: $1"
            show_help
            ;;
        *)
            BACKUP_FILE="$1"
            shift
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    # Load .env if exists
    if [ -f "$PROJECT_DIR/.env" ]; then
        set -a
        source "$PROJECT_DIR/.env"
        set +a
        DB_USER="${DB_USERNAME:-waspread}"
        DB_NAME="${DB_DATABASE:-waspread}"
    fi

    # List backups mode
    if $LIST_BACKUPS; then
        list_backups
        exit 0
    fi

    # Check backup file
    if [ -z "$BACKUP_FILE" ]; then
        error "No backup file specified"
        echo ""
        echo "Usage: ./scripts/restore.sh [options] <backup_file>"
        echo "       ./scripts/restore.sh -l  # List available backups"
        exit 1
    fi

    # Resolve backup file path
    if [[ ! "$BACKUP_FILE" = /* ]]; then
        # Relative path - check multiple locations
        if [ -f "$BACKUP_FILE" ]; then
            BACKUP_FILE="$(pwd)/$BACKUP_FILE"
        elif [ -f "$BACKUP_BASE_DIR/$BACKUP_FILE" ]; then
            BACKUP_FILE="$BACKUP_BASE_DIR/$BACKUP_FILE"
        elif [ -f "$BACKUP_BASE_DIR/daily/$BACKUP_FILE" ]; then
            BACKUP_FILE="$BACKUP_BASE_DIR/daily/$BACKUP_FILE"
        fi
    fi

    if [ ! -f "$BACKUP_FILE" ]; then
        error "Backup file not found: $BACKUP_FILE"
        exit 1
    fi

    info "=========================================="
    info "Waspread Restore Starting"
    info "=========================================="
    info "Backup file: $BACKUP_FILE"
    info "Restore database: $RESTORE_DB"
    info "Restore sessions: $RESTORE_SESSIONS"

    check_dependencies

    # Confirmation
    local warning_msg="This will overwrite existing data!"
    if $RESTORE_DB; then
        warning_msg="$warning_msg Database will be dropped and recreated."
    fi
    if $RESTORE_SESSIONS; then
        warning_msg="$warning_msg WhatsApp sessions will be replaced."
    fi
    confirm "$warning_msg"

    if $RESTORE_DB; then
        check_containers
    fi

    # Create temp directory
    local temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT

    # Extract backup
    local backup_content_dir
    backup_content_dir=$(extract_backup "$BACKUP_FILE" "$temp_dir")
    info "Extracted to: $backup_content_dir"

    # Restore database
    if $RESTORE_DB; then
        restore_database "$backup_content_dir"
    fi

    # Restore sessions
    if $RESTORE_SESSIONS; then
        restore_sessions "$backup_content_dir"
    fi

    info "=========================================="
    info "Restore Complete!"
    info "=========================================="
    info ""
    info "Next steps:"
    info "1. Verify application is working: docker-compose logs -f backend"
    info "2. Check database: docker exec -it $POSTGRES_CONTAINER psql -U $DB_USER -d $DB_NAME"
    info "3. Test WhatsApp connection via API"
}

main "$@"
