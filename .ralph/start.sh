#!/usr/bin/env bash

# Ralph - AI Agent Orchestration Script
# Runs an AI coding agent in a loop until all tasks are complete

set -e

# =============================================================================
# Signal handling
# =============================================================================

# Cleanup function for graceful exit
cleanup() {
    echo ""
    echo -e "\033[0;33m[ralph]\033[0m Interrupted by user. Exiting..."
    # Log to file if logging is configured (RALPH_LOG_FILE is set after config load)
    if [[ -n "${RALPH_LOG_FILE:-}" ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WARN] Interrupted by user (Ctrl+C)" >> "$RALPH_LOG_FILE"
    fi
    exit 130
}

# Handle Ctrl+C (SIGINT) - clean exit
trap cleanup INT

# =============================================================================
# Script directory detection
# =============================================================================

# Resolve the directory where start.sh is located
# This allows config files to be found relative to the script, not the CWD
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# =============================================================================
# Load configuration
# =============================================================================

# Auto-source config file if it exists (environment variables take precedence)
RALPH_CONFIG_FILE="$SCRIPT_DIR/config"
if [[ -f "$RALPH_CONFIG_FILE" ]]; then
    source "$RALPH_CONFIG_FILE"
    RALPH_CONFIG_LOADED=true
fi

# =============================================================================
# Configuration defaults (if not set by config file or environment)
# =============================================================================

RALPH_AGENT_CMD="${RALPH_AGENT_CMD:-opencode run}"
RALPH_MODEL="${RALPH_MODEL:-anthropic/claude-opus-4-5}"
RALPH_PRD_FILE="${RALPH_PRD_FILE:-prd.json}"
RALPH_PROGRESS_FILE="${RALPH_PROGRESS_FILE:-progress.md}"
RALPH_PROMPT_FILE="${RALPH_PROMPT_FILE:-PROMPT.md}"
RALPH_SPEC_FILE="${RALPH_SPEC_FILE:-SPEC.md}"
RALPH_COMPLETE_SIGNAL="${RALPH_COMPLETE_SIGNAL:-RALPH_TASK_COMPLETE}"
RALPH_RATE_LIMIT_PATTERN="${RALPH_RATE_LIMIT_PATTERN:-rate.limit|429|quota.exceeded|too.many.requests}"
RALPH_RATE_LIMIT_COOLDOWN="${RALPH_RATE_LIMIT_COOLDOWN:-60}"
RALPH_LOG_FILE="${RALPH_LOG_FILE:-ralph.log}"

# Convert relative file paths to absolute (prepend SCRIPT_DIR if not already absolute)
[[ "$RALPH_PRD_FILE" = /* ]] || RALPH_PRD_FILE="$SCRIPT_DIR/$RALPH_PRD_FILE"
[[ "$RALPH_PROGRESS_FILE" = /* ]] || RALPH_PROGRESS_FILE="$SCRIPT_DIR/$RALPH_PROGRESS_FILE"
[[ "$RALPH_PROMPT_FILE" = /* ]] || RALPH_PROMPT_FILE="$SCRIPT_DIR/$RALPH_PROMPT_FILE"
[[ "$RALPH_SPEC_FILE" = /* ]] || RALPH_SPEC_FILE="$SCRIPT_DIR/$RALPH_SPEC_FILE"
[[ -z "$RALPH_LOG_FILE" ]] || [[ "$RALPH_LOG_FILE" = /* ]] || RALPH_LOG_FILE="$SCRIPT_DIR/$RALPH_LOG_FILE"

# =============================================================================
# Colors for output
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =============================================================================
# Logging setup
# =============================================================================

# Initialize logging - called once at script start
setup_logging() {
    if [[ -n "$RALPH_LOG_FILE" ]]; then
        # Create log file with header
        {
            echo "==============================================================================="
            echo "Ralph Session Started: $(date '+%Y-%m-%d %H:%M:%S')"
            echo "==============================================================================="
            echo ""
        } >> "$RALPH_LOG_FILE"
    fi
}

# Log a message to the log file with timestamp (no terminal output)
log_to_file() {
    if [[ -n "$RALPH_LOG_FILE" ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$RALPH_LOG_FILE"
    fi
}

# =============================================================================
# Helper functions
# =============================================================================

log_info() {
    local msg="${BLUE}[ralph]${NC} $1"
    echo -e "$msg"
    log_to_file "[INFO] $1"
}

log_success() {
    local msg="${GREEN}[ralph]${NC} $1"
    echo -e "$msg"
    log_to_file "[SUCCESS] $1"
}

log_warn() {
    local msg="${YELLOW}[ralph]${NC} $1"
    echo -e "$msg"
    log_to_file "[WARN] $1"
}

log_error() {
    local msg="${RED}[ralph]${NC} $1"
    echo -e "$msg"
    log_to_file "[ERROR] $1"
}

show_help() {
    cat << EOF
Ralph - AI Agent Orchestration Script

Usage: ./start.sh [OPTIONS]

Options:
    --max-loops N       Maximum number of iterations (default: unlimited)
    --dry-run           Show what would be executed without running
    --help              Show this help message

Configuration:
    Ralph automatically loads ./config if it exists. You can also set these
    as environment variables (which take precedence over config file values):

    RALPH_AGENT_CMD             Agent CLI command (default: opencode run)
    RALPH_MODEL                 Model in provider/model format (default: anthropic/claude-opus-4-20250514)
    RALPH_PRD_FILE              Task file path (default: prd.json)
    RALPH_PROGRESS_FILE         Progress log path (default: progress.md)
    RALPH_PROMPT_FILE           Prompt template path (default: PROMPT.md)
    RALPH_SPEC_FILE             Spec file path (default: SPEC.md)
    RALPH_COMPLETE_SIGNAL       Completion signal (default: RALPH_TASK_COMPLETE)
    RALPH_RATE_LIMIT_PATTERN    Regex for rate limit detection
    RALPH_RATE_LIMIT_COOLDOWN   Cooldown in seconds (default: 60)
    RALPH_LOG_FILE              Log file path (default: ralph.log, empty to disable)

Note:
    File paths in config can be relative (to start.sh directory) or absolute.
    This allows you to place all Ralph files in a subdirectory (e.g., ./ralph/)
    while the agent runs from your project root.

Examples:
    ./start.sh                    # Run until all tasks complete
    ./ralph/start.sh              # Run from project root with config in ./ralph/
    ./start.sh --max-loops 5      # Run at most 5 iterations
    ./start.sh --dry-run          # Show configuration without running

EOF
}

check_requirements() {
    local missing=0

    if [[ ! -f "$RALPH_PRD_FILE" ]]; then
        log_error "Task file not found: $RALPH_PRD_FILE"
        missing=1
    fi

    if [[ ! -f "$RALPH_PROMPT_FILE" ]]; then
        log_error "Prompt file not found: $RALPH_PROMPT_FILE"
        missing=1
    fi

    if [[ ! -f "$RALPH_SPEC_FILE" ]]; then
        log_error "Spec file not found: $RALPH_SPEC_FILE"
        missing=1
    fi

    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed."
        missing=1
    fi

    if [[ $missing -eq 1 ]]; then
        exit 1
    fi
}

get_pending_task_count() {
    jq '[.tasks[] | select(.passed == false)] | length' "$RALPH_PRD_FILE"
}

get_total_task_count() {
    jq '.tasks | length' "$RALPH_PRD_FILE"
}

all_tasks_complete() {
    local pending
    pending=$(get_pending_task_count)
    [[ "$pending" -eq 0 ]]
}

build_prompt() {
    cat "$RALPH_PROMPT_FILE"
}

run_agent() {
    local prompt="$1"
    local output_file
    output_file=$(mktemp)
    
    log_info "Starting agent..."
    
    # Build the full command with model flag if specified
    local agent_cmd="$RALPH_AGENT_CMD"
    if [[ -n "$RALPH_MODEL" ]]; then
        agent_cmd="$RALPH_AGENT_CMD -m $RALPH_MODEL"
    fi
    
    # Run agent and capture output, also display in real-time
    # The prompt is passed as the LAST argument to the agent command
    # Output goes to: terminal (real-time), temp file (for signal detection), and log file
    # OPENCODE_PERMISSION enables fully autonomous mode (auto-approve all permissions)
    if [[ -n "$RALPH_LOG_FILE" ]]; then
        OPENCODE_PERMISSION='{"*":"allow"}' $agent_cmd "$prompt" 2>&1 | tee "$output_file" | tee -a "$RALPH_LOG_FILE"
    else
        OPENCODE_PERMISSION='{"*":"allow"}' $agent_cmd "$prompt" 2>&1 | tee "$output_file"
    fi
    local agent_exit_code=${PIPESTATUS[0]}
    
    # Check for completion signal
    if grep -q "$RALPH_COMPLETE_SIGNAL" "$output_file"; then
        rm -f "$output_file"
        return 0
    fi
    
    # Check for rate limiting
    if grep -iE "$RALPH_RATE_LIMIT_PATTERN" "$output_file" > /dev/null 2>&1; then
        log_warn "Rate limit detected. Cooling down for ${RALPH_RATE_LIMIT_COOLDOWN}s..."
        rm -f "$output_file"
        sleep "$RALPH_RATE_LIMIT_COOLDOWN"
        return 2  # Special return code for rate limit
    fi
    
    rm -f "$output_file"
    return 1
}

show_dry_run() {
    echo ""
    log_info "=== DRY RUN MODE ==="
    echo ""
    echo "Configuration:"
    if [[ "$RALPH_CONFIG_LOADED" == true ]]; then
        echo "  Config File:        $RALPH_CONFIG_FILE (loaded)"
    else
        echo "  Config File:        (not found, using defaults)"
    fi
    echo "  Agent Command:      $RALPH_AGENT_CMD"
    if [[ -n "$RALPH_MODEL" ]]; then
        echo "  Model:              $RALPH_MODEL"
    else
        echo "  Model:              (using agent default)"
    fi
    echo "  Task File:          $RALPH_PRD_FILE"
    echo "  Progress File:      $RALPH_PROGRESS_FILE"
    echo "  Prompt File:        $RALPH_PROMPT_FILE"
    echo "  Spec File:          $RALPH_SPEC_FILE"
    echo "  Complete Signal:    $RALPH_COMPLETE_SIGNAL"
    echo "  Rate Limit Pattern: $RALPH_RATE_LIMIT_PATTERN"
    echo "  Rate Limit Cooldown: ${RALPH_RATE_LIMIT_COOLDOWN}s"
    if [[ -n "$RALPH_LOG_FILE" ]]; then
        echo "  Log File:           $RALPH_LOG_FILE"
    else
        echo "  Log File:           (disabled)"
    fi
    echo "  Max Loops:          ${MAX_LOOPS:-unlimited}"
    echo ""
    
    if [[ -f "$RALPH_PRD_FILE" ]]; then
        local total pending
        total=$(get_total_task_count)
        pending=$(get_pending_task_count)
        echo "Task Status:"
        echo "  Total Tasks:    $total"
        echo "  Pending Tasks:  $pending"
        echo "  Completed:      $((total - pending))"
        echo ""
    fi
    
    echo "Prompt Preview (first 20 lines):"
    echo "---"
    if [[ -f "$RALPH_PROMPT_FILE" ]]; then
        head -20 "$RALPH_PROMPT_FILE"
        echo "..."
    else
        echo "(prompt file not found)"
    fi
    echo "---"
    echo ""
    log_info "Dry run complete. No changes made."
}

# =============================================================================
# Main
# =============================================================================

main() {
    local max_loops=""
    local dry_run=false
    local loop_count=0

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --max-loops)
                max_loops="$2"
                shift 2
                ;;
            --dry-run)
                dry_run=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    MAX_LOOPS="$max_loops"

    # Dry run mode
    if [[ "$dry_run" == true ]]; then
        show_dry_run
        exit 0
    fi

    # Check requirements
    check_requirements

    # Create progress file if it doesn't exist
    if [[ ! -f "$RALPH_PROGRESS_FILE" ]]; then
        touch "$RALPH_PROGRESS_FILE"
    fi

    # Initialize logging
    setup_logging

    log_info "Starting Ralph orchestration loop"
    log_info "Agent: $RALPH_AGENT_CMD"
    log_info "Tasks: $(get_pending_task_count) pending / $(get_total_task_count) total"
    echo ""

    # Main loop
    while true; do
        # Check if all tasks are complete
        if all_tasks_complete; then
            echo ""
            log_success "All tasks complete!"
            log_info "Total iterations: $loop_count"
            exit 0
        fi

        # Check max loops
        if [[ -n "$max_loops" ]] && [[ $loop_count -ge $max_loops ]]; then
            echo ""
            log_warn "Max loops ($max_loops) reached"
            log_info "Pending tasks: $(get_pending_task_count)"
            exit 0
        fi

        loop_count=$((loop_count + 1))
        echo ""
        log_info "=== Iteration $loop_count ==="
        log_info "Pending tasks: $(get_pending_task_count)"

        # Build and run
        local prompt
        prompt=$(build_prompt)
        
        local result
        set +e
        run_agent "$prompt"
        result=$?
        set -e

        case $result in
            0)
                log_success "Task completed successfully"
                ;;
            2)
                log_warn "Rate limited, retrying..."
                loop_count=$((loop_count - 1))  # Don't count rate-limited iteration
                ;;
            *)
                log_error "Agent did not signal completion"
                log_info "Continuing to next iteration..."
                ;;
        esac
    done
}

main "$@"
