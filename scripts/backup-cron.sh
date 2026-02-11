#!/bin/bash
# =============================================================================
# Waspread Backup Cron Wrapper
# =============================================================================
# Wrapper script for running backup via cron with proper logging and alerts
#
# Cron setup example (daily at 2 AM):
#   0 2 * * * /path/to/waspread/backend/scripts/backup-cron.sh
#
# Or add to crontab:
#   crontab -e
#   0 2 * * * /home/user/waspread/backend/scripts/backup-cron.sh >> /var/log/waspread-backup.log 2>&1
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${LOG_DIR:-$PROJECT_DIR/logs}"
LOG_FILE="$LOG_DIR/backup_$(date +%Y%m%d).log"

# Alert configuration (optional)
ALERT_EMAIL="${BACKUP_ALERT_EMAIL:-}"
ALERT_WEBHOOK="${BACKUP_ALERT_WEBHOOK:-}"

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

info() { log "INFO" "$@"; }
error() { log "ERROR" "$@"; }

send_alert() {
    local status="$1"
    local message="$2"

    # Email alert
    if [ -n "$ALERT_EMAIL" ] && command -v mail &> /dev/null; then
        echo "$message" | mail -s "Waspread Backup $status" "$ALERT_EMAIL"
    fi

    # Webhook alert (Slack, Discord, etc.)
    if [ -n "$ALERT_WEBHOOK" ] && command -v curl &> /dev/null; then
        local color="good"
        [ "$status" = "FAILED" ] && color="danger"

        curl -s -X POST "$ALERT_WEBHOOK" \
            -H 'Content-Type: application/json' \
            -d "{
                \"text\": \"Waspread Backup $status\",
                \"attachments\": [{
                    \"color\": \"$color\",
                    \"text\": \"$message\",
                    \"ts\": $(date +%s)
                }]
            }" > /dev/null 2>&1 || true
    fi
}

cleanup_old_logs() {
    # Keep logs for 30 days
    find "$LOG_DIR" -name "backup_*.log" -type f -mtime +30 -delete 2>/dev/null || true
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    mkdir -p "$LOG_DIR"

    info "=========================================="
    info "Cron Backup Started"
    info "=========================================="

    local start_time=$(date +%s)

    # Run the backup script
    local backup_output
    local backup_status=0

    if backup_output=$("$SCRIPT_DIR/backup.sh" 2>&1); then
        backup_status=0
    else
        backup_status=$?
    fi

    # Log output
    echo "$backup_output" >> "$LOG_FILE"

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ $backup_status -eq 0 ]; then
        info "Backup completed successfully in ${duration}s"

        # Get backup stats
        local daily_count=$(find "$PROJECT_DIR/backups/daily" -name "*.tar.gz" -type f 2>/dev/null | wc -l)
        local latest_backup=$(find "$PROJECT_DIR/backups/daily" -name "*.tar.gz" -type f -printf '%T+ %p\n' 2>/dev/null | sort -r | head -1 | cut -d' ' -f2-)
        local latest_size=""
        if [ -n "$latest_backup" ]; then
            latest_size=$(du -h "$latest_backup" 2>/dev/null | cut -f1)
        fi

        send_alert "SUCCESS" "Backup completed in ${duration}s. Daily backups: $daily_count. Latest: $latest_size"
    else
        error "Backup failed with exit code $backup_status"
        send_alert "FAILED" "Backup failed after ${duration}s. Check logs at $LOG_FILE"
    fi

    # Cleanup old logs
    cleanup_old_logs

    info "=========================================="
    info "Cron Backup Finished"
    info "=========================================="

    exit $backup_status
}

main "$@"
